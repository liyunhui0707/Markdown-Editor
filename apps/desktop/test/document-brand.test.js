const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('Markora branding preserves existing bundle identity, profile and document recovery paths',()=>{
 const main=fs.readFileSync(path.join(root,'lib/document-window-main.js'),'utf8'),html=fs.readFileSync(path.join(root,'lib/document-demo.html'),'utf8');
 assert.match(main,/app\.setName\('Markora'\)/);
 assert.match(main,/app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), 'Markdown Vault Document'\)\)/);
 assert.equal(require('../electron-builder.document.cjs').appId,'com.markdownvault.document.dev');
 assert.match(html,/<strong>Markora<\/strong>/);assert.doesNotMatch(html,/aria-hidden="true">m↓/);
});
