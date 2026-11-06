import {z} from 'zod';
import {validateSkillPack} from './skills.js';
import {RESEARCH_DEFAULTS,researchSettingsSchema} from './continuous-research.js';
export const ASSISTANT_DEFAULTS=Object.freeze({memoryEnabled:true,skills:[],research:RESEARCH_DEFAULTS});
const schema=z.strictObject({memoryEnabled:z.boolean(),skills:z.array(z.unknown()).max(8),research:researchSettingsSchema.default(RESEARCH_DEFAULTS)});
export function validateAssistant(value){const parsed=schema.safeParse(value);if(!parsed.success)throw new Error('AI 记忆与技能设置无效');const skills=parsed.data.skills.map(validateSkillPack);if(new Set(skills.map(s=>s.id)).size!==skills.length)throw new Error('技能 ID 不能重复');return {...parsed.data,skills};}
