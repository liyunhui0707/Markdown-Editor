const defaultFs = require('fs');
const {
  validateReadSideVault,
  resolveRelativePath,
  toPosix
} = require('../vault-fs');
const fileIoDefault = require('../file-io');
const { ToolError } = require('../tool-error');

const schema = {
  name: 'append_to_note',
  description:
    'Append a block to an existing Markdown note, separated by a blank line. Requires expected_mtime and/or expected_sha256 as an optimistic-concurrency guard.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['vault_path', 'relative_path', 'block'],
    properties: {
      vault_path: { type: 'string' },
      relative_path: { type: 'string' },
      block: { type: 'string' },
      expected_mtime: { type: 'integer' },
      expected_sha256: { type: 'string' }
    },
    anyOf: [
      { required: ['expected_mtime'] },
      { required: ['expected_sha256'] }
    ]
  }
};

function createAppendToNoteHandler(deps = {}) {
  const fs = deps.fs || defaultFs;
  const atomicWrite = deps.atomicWriteFileSync || fileIoDefault.atomicWriteFileSync;
  const shaOfFile = deps.sha256OfFile || fileIoDefault.sha256OfFile;
  const shaOfBuffer = deps.sha256OfBuffer || fileIoDefault.sha256OfBuffer;

  return function handler(args) {
    const root = validateReadSideVault(args && args.vault_path);
    const relPath = args && args.relative_path;
    if (typeof relPath !== 'string' || relPath === '') {
      throw new ToolError('INVALID_PATH', 'relative_path is required');
    }
    if (!relPath.endsWith('.md')) {
      throw new ToolError('INVALID_PATH', 'not a markdown file');
    }
    if (typeof args.block !== 'string') {
      throw new ToolError('INVALID_ARGS', 'block must be a string');
    }
    if (args.expected_mtime == null && args.expected_sha256 == null) {
      throw new ToolError('GUARD_REQUIRED', 'expected_mtime or expected_sha256 required');
    }
    const abs = resolveRelativePath(root, relPath);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new ToolError('NOT_FOUND', 'note does not exist');
    }
    if (!stat.isFile()) {
      throw new ToolError('INVALID_PATH', 'not a file');
    }
    function verifyGuard(target, hint) {
      let cur;
      try {
        cur = fs.statSync(target);
      } catch {
        throw new ToolError('STALE_GUARD', `note disappeared during ${hint}`);
      }
      if (!cur.isFile()) {
        throw new ToolError('STALE_GUARD', `note replaced by non-file during ${hint}`);
      }
      if (args.expected_mtime != null) {
        if (Math.round(cur.mtimeMs) !== Math.round(args.expected_mtime)) {
          throw new ToolError('STALE_GUARD', `mtime mismatch during ${hint}`);
        }
      }
      if (args.expected_sha256 != null) {
        if (shaOfFile(target, { fs }) !== args.expected_sha256) {
          throw new ToolError('STALE_GUARD', `sha256 mismatch during ${hint}`);
        }
      }
    }
    verifyGuard(abs, 'pre-flight');

    const oldRaw = fs.readFileSync(abs, 'utf8');
    const oldLf = oldRaw.replace(/\r\n/g, '\n');
    const oldTrimmed = oldLf.replace(/\n+$/, '');
    const blockNormalized = args.block
      .replace(/\r\n/g, '\n')
      .replace(/^\n+/, '')
      .replace(/\n+$/, '');

    let newContent;
    if (blockNormalized === '') {
      // Empty effective block: write LF-normalized old content verbatim.
      // - If old was LF-normalized already, bytes are byte-identical (sha unchanged).
      // - If old was CRLF, write LF version (sha and bytes change).
      newContent = oldLf;
    } else if (oldTrimmed === '') {
      newContent = blockNormalized + '\n';
    } else {
      newContent = oldTrimmed + '\n\n' + blockNormalized + '\n';
    }
    const buf = Buffer.from(newContent, 'utf8');
    atomicWrite(abs, buf, {
      fs,
      verifyBeforeRename: (target) => verifyGuard(target, 'pre-rename')
    });
    const newStat = fs.statSync(abs);
    return {
      content: [{ type: 'text', text: 'appended' }],
      structuredContent: {
        relative_path: toPosix(relPath),
        written: true,
        new_sha256: shaOfBuffer(buf),
        new_mtime: Math.round(newStat.mtimeMs)
      }
    };
  };
}

module.exports = {
  schema,
  handler: createAppendToNoteHandler(),
  createAppendToNoteHandler
};
