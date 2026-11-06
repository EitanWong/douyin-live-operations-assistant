// Adapted from MrGeDiao/shuorenhua 2.6.1 (MIT), pinned source and license in
// vendor/runtime-licenses/shuorenhua/. This is an output policy, not a detector.
export const PLAIN_REPLY_INSTRUCTION='直接回答，删无独有内容的客套、预告和重复，不机械替词或硬套模板。保留主语、数字、条件、范围、否定、可能性、完成状态、比较和来源归属；不把自述变成事实、“没查到”变成“不存在”，不补经历或结论。不能等义精简就保留原意。只交回答，不报自检或AI含量。';
export function withPlainReplyStyle(messages){return [{...messages[0],content:PLAIN_REPLY_INSTRUCTION+'\n'+messages[0].content},...messages.slice(1)];}
