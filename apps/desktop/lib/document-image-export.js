'use strict';
// Uses the same pinned-directory exclusive writer for Markdown and raster sidecars.
const fs = require('node:fs'), path = require('node:path');
const {createHash} = require('node:crypto');
const {decodeAttachments,readImageFile} = require('./document-local-images');
const {inspectMacMetadata} = require('./document-save-policy');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function verifyAttachment(root, asset, directory, expected = null) {
  const filePath = path.join(root,asset.name);
  const native = inspectMacMetadata(filePath,{newlyCreatedFile:true});
  const read = readImageFile(filePath);
  const metadataHash = digest(native);
  const unchanged = () => { const s = fs.lstatSync(filePath,{bigint:true});
    return [s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':') === read.identity; };
  if (read.name !== asset.name || !read.bytes.equals(asset.bytes) || read.mode !== 0o600
      || read.uid !== directory.uid || read.gid !== directory.gid
      || digest(inspectMacMetadata(filePath,{newlyCreatedFile:true})) !== metadataHash
      || !unchanged()
      || (expected && (expected.name !== asset.name || expected.fileIdentity !== read.fileIdentity
        || expected.fileMetadataSha256 !== metadataHash || expected.sha256 !== read.sha256))) {
    throw Object.assign(Error(),{code:'image-attachment-changed'});
  }
  return {name:asset.name,filePath,sha256:read.sha256,byteLength:read.bytes.length,fileIdentity:read.fileIdentity,fileMetadataSha256:metadataHash};
}
function createWithAttachments({store,name,bytes,attachments = [],destination}, verify = verifyAttachment) {
  const proofs = [], attachmentPaths = []; let created = false, attempted = false;
  try {
    const assets = decodeAttachments(attachments), existing = new Map();
    // Refuse every collision before creating anything. Exact verified sidecars can be reused read-only.
    for (const a of assets) {
      attachmentPaths.push(path.join(destination.root,a.name));
      let present = false;
      try { fs.lstatSync(path.join(destination.root,a.name)); present = true; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (present) existing.set(a.name,verify(destination.root,a,destination.state.identity));
    }
    for (const a of assets) {
      if (existing.has(a.name)) { proofs.push({...existing.get(a.name),created:false}); continue; }
      attempted = true;
      const result = store.createImageCopy(a.name,a.bytes);
      if (!result.ok) return {...result,attachmentPaths,
        ...(created && result.created === false ? {created:true,state:'created-partial'} : {})};
      created = true; proofs.push({name:a.name,...result});
    }
    attempted = true;
    const result = store.createCopy(name,bytes);
    if (!result.ok) return {...result,attachmentPaths,
      ...(created && result.created === false ? {created:true,state:'created-partial'} : {})};
    created = true;
    for (let i=0;i<assets.length;i++) verify(destination.root,assets[i],destination.state.identity,proofs[i]);
    return {...result,attachments:proofs,attachmentPaths};
  } catch (cause) {
    return {ok:false,created:created ? true : attempted ? null : false,
      state:created ? 'created-unverified' : attempted ? 'create-outcome-unknown' : 'not-created',
      code:cause.code || 'image-export-unconfirmed',attachmentPaths};
  }
}
module.exports = {verifyAttachment,createWithAttachments};
