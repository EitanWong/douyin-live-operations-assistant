import {createAIClient} from './ai.js';
// Cloud and local models use the same intent, search and citation rules.
export function createLocalReply({edge,request,weather,search,research,knowledge,onSearch,onIntent}){
 const client=createAIClient({request,weather,generate:(prompt,config)=>edge.reply(prompt,config),search,research,knowledge,onSearch,onIntent});
 return (prompt,config)=>client({...prompt,task:prompt.task || {kind:'ai'},canFollowup:undefined,reserveFollowup:prompt.reserveLocal},config);
}
