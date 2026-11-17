// Only presentation panels dismiss during native closure. Their existing close
// controls retain busy/management guards; editing dialogs are never included.
export function dismissPassivePanels(byId){
 let dismissed=false;
 for(const [id,button]of [['document-details-dialog','close-document-details-dialog'],['recent-dialog','close-recent-dialog'],
  ['reading-settings-dialog','close-reading-settings'],['draft-dialog','close-draft-dialog'],['file-comparison-dialog','close-file-comparison']]){
  const panel=byId(id),control=byId(button);
  if(panel.open&&!control.disabled){control.click();if(!panel.open)dismissed=true;}
 }
 return dismissed;
}
