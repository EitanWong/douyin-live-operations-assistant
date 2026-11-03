import {createAIClient} from './ai.js';
// Cloud and local models use the same intent, search and citation rules.
export function createLocalReply({edge,search,onSearch}){
 const client=createAIClient({generate:(prompt,config)=>edge.reply(prompt,config),search,onSearch});
 return (prompt,config)=>client({...prompt,task:prompt.task || {kind:'ai'},canFollowup:undefined,reserveFollowup:prompt.reserveLocal},config);
}
