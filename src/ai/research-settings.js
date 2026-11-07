import {z} from 'zod';

// Zero means the user has not imposed a budget. Transport/data validation and
// per-room serialization remain separate from optional execution limits.
export const RESEARCH_DEFAULTS=Object.freeze({enabled:true,profileEnabled:true,intervalSec:0,maxPerHour:0,modelCalls:0,searches:0,reads:0,sources:0,modelCallsPerHour:0,searchesPerHour:0,requestTimeoutSec:0,timeoutSec:0,maxOutputTokens:0});
const limit=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const researchSettingsSchema=z.strictObject({enabled:z.boolean(),profileEnabled:z.boolean(),...Object.fromEntries(Object.keys(RESEARCH_DEFAULTS).filter(key=>!['enabled','profileEnabled'].includes(key)).map(key=>[key,limit.default(0)]))});
export const researchSettings=ai=>researchSettingsSchema.parse({...RESEARCH_DEFAULTS,...ai?.assistant?.research});
export const researchLimits=ai=>{const settings=researchSettings(ai);return Object.fromEntries(['modelCalls','searches','reads','sources'].map(key=>[key,settings[key]]));};
export const budgetReached=(used,limit)=>limit>0 && used>=limit;
export const researchTimeoutMs=ai=>researchSettings(ai).timeoutSec*1000 || Infinity;
