import {z} from 'zod';

export const MINUTE=60000, DAY=86400000, MODEL_VERSION='local-probabilistic-v1';
export const LIMITS=Object.freeze({minuteDays:45,forecastDays:30,userDays:30,sessionDays:730,replayDays:7,reportMinutes:180,viewers:50});
export const localDate=at=>new Date(at+8*3600000).toISOString().slice(0,10);
const bounded=(max=1e12)=>z.number().finite().min(0).max(max);
const label=z.string().trim().max(160);
const month=z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/);
const rulesSchema=z.object({points:bounded(),promotionPoints:bounded().positive(),winPoints:bounded().positive(),lossPoints:bounded(),plannedBattles:z.number().int().min(1).max(1000),source:label.min(1)}).nullable();
const previousMonth=()=>{const d=new Date(Date.now()+8*3600000);return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)).toISOString().slice(0,7);};
const settingsSchema=z.object({enabled:z.boolean().default(true),viewerEnabled:z.boolean().default(true),plannedDays:z.number().int().min(1).max(31).default(22),hoursPerDay:z.number().finite().min(.25).max(16).default(3),remainingMinutes:z.number().int().min(1).max(720).default(60),yuanPerDiamond:bounded(1).default(.05),category:label.default(''),grade:label.default(''),historyMonth:month.default(previousMonth),historyHours:z.number().finite().positive().max(744).default(80),rankRules:rulesSchema.default(null)});
function parse(schema,value,message){const r=schema.safeParse(value);if(!r.success)throw new Error(message);return r.data;}
export const parseSettings=value=>parse(settingsSchema,value,'预测参数无效，请检查日期、范围和完整赛季规则');
const historyRow=z.object({month,hours:z.number().finite().positive().max(744),diamonds:bounded(),grade:label.default(''),category:label.default(''),source:label.min(1),kind:z.enum(['self','peer']).default('peer')});
export const parseHistory=value=>parse(z.array(historyRow).max(2400),value,'历史参考数据无效：需要有效月份、小时、非负钻石和来源');
const userSchema=z.object({id:z.string().regex(/^\d{1,30}$/).optional(),secUid:z.string().min(1).max(160).optional(),name:z.string().max(200).optional(),minor:z.boolean().optional()}).strip();
// Native protocol/identity readers use zero for an unavailable platform time.
// Keep it unknown; receivedAt remains the independently validated observation time.
const platformTime=z.number().finite().nonnegative().nullish().transform(value=>value || undefined);
const eventSchema=z.object({type:z.enum(['gift','chat','enter','room-audience','start','end']),id:z.string().max(240).optional(),groupId:z.union([z.string(),z.number()]).optional(),giftId:z.union([z.string(),z.number()]).optional(),giftName:z.string().max(100).optional(),count:z.number().int().positive().max(1e8).optional(),unitValue:bounded(1e9).nullable().optional(),text:z.string().max(10000).optional(),roomId:z.string().max(40).optional(),anchorId:z.string().max(40).optional(),receivedAt:z.number().finite().positive().optional(),at:platformTime,startAt:platformTime,user:userSchema.optional(),onlineCount:bounded(1e9).nullable().optional(),source:z.string().max(40).optional()}).strip();
export function parseEvent(value,now){
 const e=parse(eventSchema,value,'预测采集事件无效');
 const at=e.receivedAt ?? now;
 if(at>now || at<now-LIMITS.replayDays*DAY || [e.at,e.startAt].some(t=>t!=null && (t>now || t<=0)) || e.type==='gift' && e.count==null)throw new Error('预测采集事件时间或数量无效');
 return {...e,receivedAt:at};
}
const competitor=z.object({anchorId:label,isSelf:z.boolean(),name:label.optional(),score:bounded(),scoreObserved:z.boolean(),scoreAgeMs:bounded()});
const pkSchema=z.object({key:label,phase:z.enum(['active','ended']),remainingMs:bounded(24*3600000),competitors:z.array(competitor).max(8),dataQuality:z.object({stale:z.boolean()}).optional(),trend:z.array(z.object({at:bounded(Number.MAX_SAFE_INTEGER),selfScore:bounded().nullable().optional(),opponentScore:bounded().nullable().optional(),competitorScores:z.record(z.string(),bounded()).optional()})).max(120)}).nullable().optional();
export function parsePulse(value,now){const info=parse(z.object({connected:z.boolean(),gaps:bounded().default(0),roomId:z.string().max(40).optional(),pk:pkSchema,outcomes:z.array(z.object({battleKey:label,endedAt:bounded(Number.MAX_SAFE_INTEGER),scoreFinal:z.boolean(),outcome:z.enum(['win','loss','draw'])})).max(200).default([])}),value,'预测连接状态无效');if(info.pk?.trend.some(t=>t.at>now) || info.outcomes.some(r=>r.endedAt>now))throw new Error('预测状态包含未来数据');return info;}
export function scopeKey({room,anchor}){if(!/^(?:demo|\d{1,30})$/.test(String(room)) || !/^\d{1,30}$/.test(String(anchor)))throw new Error('请先识别主播与直播间后使用预测');return `${room}:${anchor}`;}
export const userKey=user=>user?.id ? `uid:${user.id}` : user?.secUid ? `sec:${user.secUid}` : '';
export function nextMonth(at){const d=new Date(at+8*3600000),y=d.getUTCFullYear(),m=d.getUTCMonth();return {start:localDate(Date.UTC(y,m+1,1)-8*3600000),end:localDate(Date.UTC(y,m+2,1)-8*3600000)};}
