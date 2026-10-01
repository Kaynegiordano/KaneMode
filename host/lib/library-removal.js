'use strict';
function canRemove(entry) {
  return !!entry && !!entry.id && !entry.id.startsWith('launcher:') && !entry.demo && entry.installed!==false && entry.source!=='kaneplay' && !entry.streamHost;
}
function update(state,entry,removed) {
  if(typeof removed!=='boolean')throw new Error('Choix de retrait invalide');
  if(!entry || (removed&&!canRemove(entry)) || entry.id.startsWith('launcher:')) throw new Error('Ce jeu ne peut pas être retiré de la bibliothèque');
  const overrides={...state.overrides}, row={...overrides[entry.id]};
  if(removed)row.removed=true;else delete row.removed;
  overrides[entry.id]=row;
  return {...state,overrides};
}
module.exports={canRemove,update};
