'use strict';
const { TextDecoder } = require('node:util');
const { record, failure, revisionError } = require('./document-contract');

// Main-process source model. No title/body/frontmatter split and no Markdown
// normalization. A rich editor must eventually provide verified source edits.
class DocumentModel {
  #filePath;
  #identity;
  #originalBytes;
  #text = null;
  #savedText = null;
  #bom = false;
  #revision = 0;
  #faults = {};
  #converting = false;

  constructor({ filePath, bytes, identity }, bindLifecycle) {
    this.#filePath = filePath;
    this.#identity = Object.freeze({ ...identity });
    this.#originalBytes = Buffer.from(bytes);
    this.#bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
    try {
      const source = this.#bom ? bytes.subarray(3) : bytes;
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
      if (text.includes('\0')) throw Error('Binary or unsupported encoding');
      this.#text = this.#savedText = text;
    } catch {
      this.#faults.encoding = 'unsupported-encoding';
    }
    // The service retains this closure; it is not reachable from the document.
    bindLifecycle((text, nextIdentity) => {
      this.#savedText = text;
      this.#identity = Object.freeze({ ...nextIdentity });
    });
    Object.freeze(this);
  }

  get filePath() { return this.#filePath; }
  get identity() { return this.#identity; }
  get originalBytes() { return Buffer.from(this.#originalBytes); }
  get text() { return this.#text; }
  get bom() { return this.#bom; }
  get encoding() { return this.#text === null ? null : 'utf-8'; }
  get dirty() { return this.#text !== this.#savedText; }
  get revision() { return this.#revision; }
  get blocked() { return this.#converting || Object.keys(this.#faults).length > 0; }
  get errors() { return Object.freeze({ ...this.#faults }); }
  get lineEndings() {
    const source = this.#text || '';
    const crlf = (source.match(/\r\n/g) || []).length;
    const lf = (source.match(/\n/g) || []).length - crlf;
    const cr = (source.match(/\r/g) || []).length - crlf;
    return Object.freeze({ crlf, lf, cr });
  }

  edit(change) {
    if (!record(change, ['from', 'to', 'insert', 'expectedRevision'])) return failure('invalid-source-edit');
    const { from, to, insert, expectedRevision } = change;
    const revision = revisionError(expectedRevision, this.#revision);
    if (revision) return failure(revision);
    const source = this.#text;
    const splitsSurrogate = index => index > 0 && index < source.length
      && /[\uD800-\uDBFF]/.test(source[index - 1]) && /[\uDC00-\uDFFF]/.test(source[index]);
    if (source === null || !Number.isInteger(from) || !Number.isInteger(to)
        || from < 0 || to < from || to > source.length || typeof insert !== 'string'
        || insert.includes('\0') || Buffer.from(insert, 'utf8').toString('utf8') !== insert
        || splitsSurrogate(from) || splitsSurrogate(to)) {
      return failure('invalid-source-edit');
    }
    const next = source.slice(0, from) + insert + source.slice(to);
    if (next !== source) { this.#text = next; this.#revision++; }
    return { ok: true, revision: this.#revision, dirty: this.dirty };
  }

  #conversion(kind, callback) {
    const fail = () => {
      const code = kind === 'parse' ? 'parse-failed' : 'serialization-failed';
      this.#faults[kind] = code;
      return { ok: false, status: 'blocked', code, error: 'Conversion blocked; complete source and edits retained.' };
    };
    if (this.#converting || this.#text === null || typeof callback !== 'function') return fail();
    const revision = this.#revision;
    this.#converting = true;
    try {
      const value = callback(this.#text);
      if (value && typeof value.then === 'function') {
        // Synchronous boundary: do not let a rejected async adapter become an
        // unhandled rejection or permit a Save before conversion completes.
        Promise.resolve(value).catch(() => {});
        return fail();
      }
      if (revision !== this.#revision) return fail();
      if (kind === 'parse' ? !value || typeof value !== 'object' : value !== this.#text) return fail();
      delete this.#faults[kind];
      return { ok: true, value };
    } catch { return fail(); }
    finally { this.#converting = false; }
  }

  parse(parser) { return this.#conversion('parse', parser); }
  verifySerialization(serializer) { return this.#conversion('serialize', serializer); }

  // Explicit caller acknowledgement: recover the retained complete raw source,
  // never the failed rich conversion. Unsupported encodings remain blocked.
  recoverSource() {
    delete this.#faults.parse;
    delete this.#faults.serialize;
    return { ok: !this.blocked };
  }

  bytesForSave() {
    if (this.blocked) throw Error('Document conversion is blocked');
    return Buffer.from((this.#bom ? '\uFEFF' : '') + this.#text, 'utf8');
  }

}

// Only the creator of a NEW model receives its lifecycle capability. There is
// no lookup that grants authority over an existing service-owned document.
function createDocumentModel(input) {
  let acceptSaved;
  const document = new DocumentModel(input, capability => { acceptSaved = capability; });
  return Object.freeze({ document, acceptSaved });
}
module.exports = { createDocumentModel };
