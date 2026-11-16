// Build an expected full document for one-block edits. Only the edited subtree
// is mutable here; untouched blocks are borrowed read-only for full comparison.
export function copyEditedBlock(doc,index) {
  if(!Array.isArray(doc?.content)||!Number.isInteger(index)||index<0||index>=doc.content.length)
    throw new TypeError('Invalid edited block');
  const content=doc.content.slice();content[index]=structuredClone(content[index]);
  return {...doc,content};
}
