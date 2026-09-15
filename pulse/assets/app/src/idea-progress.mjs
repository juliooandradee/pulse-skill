export function createIdeaProgress({read,complete,reopen}){
 let alive=true,ready=false,loading=false,error='',revision=0;
 const rows=new Map(),busy=new Set(),listeners=new Set();
 const snapshot=()=>({ready,loading,error,rows:new Map(rows),busy:new Set(busy)});
 const emit=()=>{if(alive)for(const fn of listeners)fn(snapshot());};
 return {
  snapshot,
  subscribe(fn){listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);},
  async refresh(){
   if(!alive||loading||busy.size)return;
   loading=true;error='';const version=revision;emit();
   try{const result=await read();if(!alive||version!==revision)return;rows.clear();for(const row of result)rows.set(row.idea_id,row);ready=true;}
   catch{if(alive)error='Não foi possível conferir as propostas feitas. Tente atualizar os checks.';}
   finally{loading=false;emit();}
  },
  async setDone(id,done){
   if(!alive||!ready||loading||error||busy.has(id))return false;
   busy.add(id);error='';revision++;emit();
   try{
    const row=done?await complete(id):await reopen(id);
    if(!alive)return false;
    if(done){if(!row||row.idea_id!==id)throw new Error('Estado não confirmado');rows.set(id,row);}
    else rows.delete(id);
    return true;
   }catch{if(alive)error='Não foi possível confirmar o check. Atualize os checks para conferir antes de tentar novamente.';return false;}
   finally{busy.delete(id);emit();}
  },
  destroy(){alive=false;revision++;listeners.clear();rows.clear();busy.clear();}
 };
}
