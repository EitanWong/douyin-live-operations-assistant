// Optimistic reads are a projection over confirmed storage, not rollback
// snapshots of other unconfirmed writes. All writes retain one serial owner.
export class StorageMirror {
  constructor(initial,send) {
    this.send=send;this.values=new Map(Object.entries(initial));
    this.confirmed=new Map([...this.values].map(([key,value])=>[key,{value}]));
    this.latest=new Map();this.writes=Promise.resolve();
  }
  project(key) {
    const record=this.confirmed.get(key);
    if(!record || record.remove){this.values.delete(key);this.confirmed.delete(key);}
    else this.values.set(key,record.value);
  }
  observe(changes) {
    for(const [key,change] of Object.entries(changes)){
      this.confirmed.set(key,{value:change.newValue,remove:change.newValue===undefined});
      if(!this.latest.has(key))this.project(key);
    }
  }
  write(key,value,remove=false) {
    const operation={value,remove},previous=this.writes;
    this.latest.set(key,operation);
    if(remove)this.values.delete(key);else this.values.set(key,value);
    const task=(async()=>{
      try {await previous;} catch {}
      const observed=this.confirmed.get(key);
      try {
        const result=await this.send({type:remove?'delete':'set',key,value});
        // A storage notification that arrived while awaiting the response is
        // newer evidence than this acknowledgement; never roll it back.
        if(this.confirmed.get(key)===observed)this.confirmed.set(key,operation);
        return result;
      } finally {
        if(this.latest.get(key)===operation){this.latest.delete(key);this.project(key);}
      }
    })();
    this.writes=task;void task.catch(()=>{});return task;
  }
}
