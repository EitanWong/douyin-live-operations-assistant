export const isSilentCollection=config=>config?.mode==='collect';

// Capture is foundational. Reply and tool settings remain intact when modes change.
export function collectionPolicy(config){
 if(!config)return config;
 const ai=config.ai || {},assistant=ai.assistant || {};
 return {...config,incomeEnabled:true,ai:{...ai,search:{...ai.search,rememberKnowledge:true},accountCollection:{...ai.accountCollection,enabled:true,autoRefresh:true,autoResearch:true},assistant:{...assistant,memoryEnabled:true,research:{...assistant.research,enabled:true}}}};
}
