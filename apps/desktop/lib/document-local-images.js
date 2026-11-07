'use strict';
// Bounded local raster attachments. No URL loading or renderer filesystem authority.
const fs = require('node:fs'), path = require('node:path');
const {createHash} = require('node:crypto');
const {MAX_IMAGE_BYTES:MAX_IMAGE,MAX_IMAGES,MAX_ATTACHMENT_BYTES,MAX_ATTACHMENT_PIXELS,
  MAX_SESSION_IMAGES,MAX_SESSION_IMAGE_BYTES,MAX_SESSION_IMAGE_PIXELS,base64Limit} = require('./document-capacity');
function budget(assets, session = false) {
  if (assets.length > (session ? MAX_SESSION_IMAGES : MAX_IMAGES)) fail(session ? 'image-session-capacity' : 'image-count-limit');
  if (assets.reduce((n,a)=>n+a.bytes.length,0) > (session ? MAX_SESSION_IMAGE_BYTES : MAX_ATTACHMENT_BYTES)) fail(session ? 'image-session-capacity' : 'image-total-size-limit');
  if (assets.reduce((n,a)=>n+a.width*a.height,0) > (session ? MAX_SESSION_IMAGE_PIXELS : MAX_ATTACHMENT_PIXELS)) fail(session ? 'image-session-capacity' : 'image-total-pixel-limit');
}
const managedName = /^markdown-image-([a-f0-9]{64})\.(png|jpg)$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(Error(code), {code}); };
const stamp = s => [s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
function imageAsset(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE) fail('image-size-limit');
  let ext, width, height;
  if (bytes.length >= 33 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
      && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii',12,16) === 'IHDR') {
    ext = 'png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    ext = 'jpg'; let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++]; if (marker === 218 || marker === 217) break;
      const len = bytes.readUInt16BE(p);
      if (len < 2 || p + len > bytes.length) break;
      if ([192,193,194].includes(marker) && len >= 8) { height = bytes.readUInt16BE(p+3); width = bytes.readUInt16BE(p+5); break; }
      p += len;
    }
  }
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16000000) fail('unsupported-image');
  const sha256 = hash(bytes), mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return {name:`markdown-image-${sha256}.${ext}`, sha256, mime, width, height, bytes:Buffer.from(bytes)};
}
function decodeAttachments(value = []) {
  if (!Array.isArray(value) || value.length > MAX_IMAGES) fail('image-count-limit');
  const seen = new Set(), assets = [];
  return value.map(item => {
    if (!item || Object.keys(item).sort().join(',') !== 'base64,name' || !managedName.test(item.name)
        || typeof item.base64 !== 'string' || item.base64.length > base64Limit(MAX_IMAGE) || seen.has(item.name)) fail('invalid-image-attachment');
    const a = imageAsset(Buffer.from(item.base64,'base64'));
    if (a.name !== item.name || a.bytes.toString('base64') !== item.base64) fail('invalid-image-attachment');
    assets.push(a); budget(assets); seen.add(a.name); return a;
  });
}
function readImageFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || !/\.(png|jpe?g)$/i.test(file)
      || file.split(path.sep).some(s => s.startsWith('.') || s === 'secrets')) fail('unsupported-image-path');
  const parent = path.dirname(file), directory = fs.lstatSync(parent,{bigint:true});
  if (!directory.isDirectory() || fs.realpathSync(parent) !== parent) fail('image-directory-changed');
  const before = fs.lstatSync(file,{bigint:true}); let fd;
  try {
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_IMAGE)) fail('unsupported-image-file');
    fd = fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    if (stamp(fs.fstatSync(fd,{bigint:true})) !== stamp(before)) fail('image-file-changed');
    const bytes = Buffer.alloc(Number(before.size)); let n = 0;
    while (n < bytes.length) { const read = fs.readSync(fd,bytes,n,bytes.length-n,n); if (!read) fail('image-file-changed'); n += read; }
    const after = fs.lstatSync(parent,{bigint:true});
    if (stamp(fs.fstatSync(fd,{bigint:true})) !== stamp(before) || stamp(fs.lstatSync(file,{bigint:true})) !== stamp(before)
        || after.dev !== directory.dev || after.ino !== directory.ino || fs.realpathSync(parent) !== parent) fail('image-file-changed');
    return {...imageAsset(bytes), identity:stamp(before), mode:Number(before.mode & 0o7777n), uid:Number(before.uid), gid:Number(before.gid), fileIdentity:`${before.dev}:${before.ino}`};
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function createLocalImages({projectSource, validateRaster}) {
  const documents = new WeakMap(), references = new WeakMap();
  // Preview requests for every image share one parse. Only immutable names are
  // cached; source-map projections used by edit validation remain independent.
  const refs = (document, source = document.text) => {
    const cached = references.get(document); if (cached?.source === source) return cached.names;
    const names = [...new Set(projectSource(source).blocks.filter(b=>b?.image && managedName.test(b.image.src)).map(b=>b.image.src))];
    references.set(document,{source,names}); return names;
  };
  const selected = (document,names) => names.map(name=>documents.get(document)?.get(name)).filter(Boolean);
  const verified = a => { if (typeof validateRaster !== 'function' || !validateRaster(a)) fail('unsupported-image'); return a; };
  function attach(document, source = null, recovery = null) {
    const assets = new Map();
    if (recovery) for (const a of decodeAttachments(recovery.attachments)) assets.set(a.name,verified(a));
    else if (source) for (const [name,a] of documents.get(source) || []) assets.set(name,a);
    documents.set(document,assets);
  }
  function open(document) {
    attach(document); const names = refs(document); if (names.length > MAX_IMAGES) return;
    for (const name of names) {
      try { const a = verified(readImageFile(path.join(path.dirname(document.filePath),name)));
        if (a.name === name) { budget([...documents.get(document).values(),a]); documents.get(document).set(name,a); }
      } catch { /* Missing/replaced attachments remain visible placeholders; never bless them. */ }
    }
  }
  function importFile(document,file) {
    const assets = documents.get(document); if (!assets) fail('image-session-unavailable');
    const a = verified(readImageFile(file));
    budget([...assets.values()].filter(value=>value.name!==a.name).concat(a),true); // Includes undo/cancel references.
    assets.set(a.name,a); return a.name;
  }
  function validateChange(document, source) {
    const before = refs(document), names = refs(document,source);
    if (names.length > MAX_IMAGES) fail('image-count-limit');
    if (names.some(name => !before.includes(name) && !documents.get(document)?.has(name))) fail('image-attachment-unavailable');
    budget(selected(document,names));
  }
  function attachments(document) {
    const names = refs(document); if (names.length > MAX_IMAGES) fail('image-count-limit');
    budget(selected(document,names));
    return names.map(name => {
      const a = documents.get(document)?.get(name); if (!a) fail('image-attachment-unavailable');
      return {name,base64:a.bytes.toString('base64')};
    });
  }
  function preview(document,name) {
    if (!refs(document).includes(name)) fail('image-preview-unavailable');
    const a = documents.get(document)?.get(name); if (!a) fail('image-preview-unavailable');
    return `data:${a.mime};base64,${a.bytes.toString('base64')}`;
  }
  return {attach,open,importFile,validateChange,attachments,preview};
}
module.exports = {MAX_IMAGE,MAX_IMAGES,managedName,imageAsset,decodeAttachments,readImageFile,createLocalImages};
