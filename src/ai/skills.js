import {z} from 'zod';
const scenes=['ai','gift','welcome','idle','agent'];
const schema=z.strictObject({version:z.literal(1),id:z.string().regex(/^[a-z][a-z0-9-]{0,39}$/u),name:z.string().trim().min(1).max(40),scenes:z.array(z.enum(scenes)).min(1).max(5),instructions:z.string().trim().min(1).max(1800)});
export const BUILTIN_SKILLS=Object.freeze([
 {version:1,id:'natural-conversation',name:'自然短句交流',scenes:['ai','idle'],instructions:'像平常聊天一样接当前话题，一次只说一件事；不用客服套话、夸张赞美、连续追问。没有值得补充的内容就保持沉默；不假装是真人，不虚构线下经历。'},
 {version:1,id:'grounded-qa',name:'有依据的问答',scenes:['ai','agent'],instructions:'常识可直接简答；涉及近期政策、天气、赛事或不确定外部事实时使用已授权搜索并核对来源。主播实时数据、PK规则以提供的事实和有效规则为准，缺资料不编造。'},
 {version:1,id:'remembered-viewer',name:'记住观众互动',scenes:['ai','gift','welcome'],instructions:'可自然承接当前观众确实说过的话和已观察送礼，不复述无关历史，不播报消费画像。自述只作为未核实偏好，不推断人格、财富或敏感身份；大额礼物只让答谢更郑重，不施压消费。'}
]);
export function validateSkillPack(value){try{return schema.parse(value);}catch{throw new Error('技能包格式无效：仅支持 version、id、name、scenes、instructions，不执行脚本或安装依赖');}}
export function selectSkills(custom=[],scene='ai'){return [...BUILTIN_SKILLS,...custom.map(validateSkillPack)].filter(s=>s.scenes.includes(scene)).slice(-4).map(s=>({...s}));}
export function skillInstructions(custom,scene){return selectSkills(custom,scene).map(s=>({name:s.name,instructions:s.instructions}));}
