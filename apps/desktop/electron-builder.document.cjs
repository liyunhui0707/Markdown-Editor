'use strict';
// Local development app only. Legacy code remains in Git, outside this artifact.
module.exports = {
  extends: null,
  appId: 'com.markdownvault.document.dev', productName: 'Markdown',
  extraMetadata: { main: 'document-app-main.js' },
  fileAssociations: [{ ext: 'md', name: 'Markdown document', role: 'Editor', rank: 'Alternate' }],
  extraResources: [{from: 'build/document-save', to: 'document-save'}],
  asar: true, npmRebuild: false,
  files: ['document-app-main.js', 'package.json', 'lib/document-*', 'lib/editor-path-policy.js',
    '!lib/document-demo-entry.js', '!lib/document-demo-main.js', '!**/.env{,.*}',
    '!**/{secrets,Inbox,.local,.codex,.claude,.workflow,e2e,test,test-results,tools,spike}{,/**/*}'],
  mac: { identity: null, target: 'dir', category: 'public.app-category.productivity',
    minimumSystemVersion: '12.0', icon: 'build/document.icns' },
};
