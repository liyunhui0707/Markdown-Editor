import test from 'node:test';import assert from 'node:assert/strict';
import {filePresentation,linkedFileMessage,originalSaveNotice} from '../lib/document-file-presentation.mjs';
test('file status is based on current bound hash, not temporary dirty flag or export receipt',()=>{
 const c={temporary:true,dirty:true,copySha256:'saved',linkedFile:{filePath:'/synthetic/New.md',baselineSha256:'saved',checked:null},originalSave:{available:true}};
 assert.equal(filePresentation(c).label,'正文已保存');
 assert.equal(filePresentation(c,{pending:1,source:'new'}).label,'输入待确认');
 assert.equal(filePresentation({...c,copySha256:'new'}).label,'修改未保存');
 assert.equal(filePresentation({...c,linkedFile:null,confirmedCopy:{ok:true}}).label,'本地草稿');
 assert.equal(filePresentation({...c,originalSave:{stopped:true}}).label,'保存已暂停');
 assert.equal(filePresentation({...c,temporary:false}).label,'原文只读');
 assert.equal(filePresentation({...c,linkedFile:{...c.linkedFile,checked:{state:'changed'}}}).label,'磁盘文件已变化');
 assert.match(linkedFileMessage({...c.linkedFile,checked:{state:'changed'}},true),/撤销历史保留/);
 assert.match(linkedFileMessage({...c.linkedFile,checked:{state:'unchanged'}},true),/不会恢复写回/);
});

test('rechecking never hides a paused save or downgrades an uncertain replacement warning',()=>{
 const current={originalSave:{stopped:true},linkedFile:{checked:{state:'unchanged'}}};
 assert.match(originalSaveNotice(current),/保存仍暂停/);
 current.linkedFile.checked.state='changed';assert.match(originalSaveNotice(current),/保存已暂停/);
 current.originalSave.receipt={ok:false,committed:null};assert.match(originalSaveNotice(current),/保存未确认，原路径可能已经更新/);
});
