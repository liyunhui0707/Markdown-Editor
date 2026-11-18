import {DocumentImage} from './document-image-node.mjs';
import {DocumentPreview} from './document-preview-node.mjs';
import {documentTableNodes} from './document-table-nodes.mjs';
import { Mark } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {CodeBlock} from '@tiptap/extension-code-block';
import {taskListItem} from './document-task-item.mjs';

// Links render editable source labels; the separate panel owns address edits.
// No href is rendered; no automatic linking, paste rules or click plugin runs.
const SourceLink = Mark.create({
  name: 'link', priority: 1000, inclusive: true,
  addAttributes() { return {
    href: { default: null, parseHTML: element => element.getAttribute('data-source-href') },
    title: { default: null, parseHTML: element => element.getAttribute('data-source-title') },
  }; },
  parseHTML() { return [{ tag: 'span[data-document-link]' }]; },
  renderHTML({ mark }) { return ['span', {
    'data-document-link': '', class: 'document-source-link',
    'data-source-href': mark.attrs.href, 'data-source-title': mark.attrs.title,
  }, 0]; },
});
// Keep StarterKit extension order (and therefore canonical mark ranks), while
// allowing source-proven code/emphasis/link combinations in this editor only.
const DocumentStarterKit=StarterKit.extend({addExtensions(){
  return this.parent().map(extension=>extension.name==='code'?extension.extend({excludes:''}):extension);
}});
const SourceCodeBlock=CodeBlock.extend({addAttributes(){return {...this.parent?.(),sourceEditable:{default:false,rendered:false}};}});
export function documentEditorExtensions(onTaskToggle, imageNodeView = null) {
  return [DocumentPreview,DocumentImage.configure({nodeView:imageNodeView}),...documentTableNodes, DocumentStarterKit.configure({ undoRedo: false, trailingNode: false, link: false, codeBlock: false, listItem: false }), SourceLink, SourceCodeBlock, taskListItem(onTaskToggle)];
}
