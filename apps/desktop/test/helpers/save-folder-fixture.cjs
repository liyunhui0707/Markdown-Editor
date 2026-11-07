'use strict';
// Test-only container for nested destination cases. Never scans/adopts old Home data.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict'), {createHash} = require('node:crypto');
const {createHomeFixture} = require('./home-fixture.cjs');
const {MAX_IMAGE_BYTES,MAX_DOCUMENT_BYTES}=require('../../lib/document-capacity');
const identity = s => [s.dev,s.ino,s.uid,s.gid,s.mode].join(':');
function createSaveFolderFixture(evidenceRoot = process.env.MARKDOWN_TEST_EVIDENCE_ROOT || fs.mkdtempSync(path.join(os.tmpdir(),'document-save-folders-evidence-'))) {
  const parent = fs.realpathSync(evidenceRoot), p = fs.lstatSync(parent);
  assert(p.isDirectory() && p.uid === process.getuid());
  const owned = createHomeFixture('Writing-synthetic-'), dir = owned.dir, initial = fs.lstatSync(dir);
  const target = path.join(parent,path.basename(dir));
  let archived = false;
  function inventory(at) {
    const entries = {}; let count = 0;
    function visit(file) {
      assert(++count < 1024); const s=fs.lstatSync(file), rel=path.relative(at,file);
      assert.equal(s.uid,initial.uid);
      const entry={identity:identity(s)};
      if(s.isSymbolicLink()) entry.link=fs.readlinkSync(file); // Preserve text, never follow.
      else if(s.isDirectory()) entry.directory=true;
      else {
        assert(s.isFile() && s.nlink===1 && s.size<=Math.max(MAX_IMAGE_BYTES,MAX_DOCUMENT_BYTES));
        const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
        try {assert.equal(identity(fs.fstatSync(fd)),identity(s));entry.sha256=createHash('sha256').update(fs.readFileSync(fd)).digest('hex');assert.equal(identity(fs.fstatSync(fd)),identity(s));}
        finally {fs.closeSync(fd);}
      }
      entries[rel]=entry;
      if(entry.directory) for(const name of fs.readdirSync(file).sort()) visit(path.join(file,name));
    }
    visit(at);return entries;
  }
  function archive({quiescent=false}={}) {
    assert(quiescent,'All test writers must exit before archiving');
    assert(!archived && !fs.existsSync(target));
    assert.equal(identity(fs.lstatSync(dir)),identity(initial));
    assert.equal(p.dev,initial.dev);assert.equal(identity(fs.lstatSync(parent)),identity(p));
    const before=inventory(dir),map=path.join(parent,path.basename(dir)+'.json');
    fs.writeFileSync(map,JSON.stringify({from:dir,to:target,state:'retained-test-output-not-save-success',inventory:before,
      restore:'With test processes stopped, rename this container back only if the old path is absent. Restore the whole container, including race pairs. Absolute symlink text is intentionally unchanged.'},null,2),{flag:'wx',mode:0o600});
    fs.renameSync(dir,target);assert.deepEqual(inventory(target),before);assert(!fs.existsSync(dir));archived=true;
    return {state:'archived',from:dir,to:target,manifest:map};
  }
  return {dir,archive};
}
module.exports={createSaveFolderFixture};
