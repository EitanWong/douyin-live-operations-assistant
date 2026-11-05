// These are scheduling hints, not speaker authentication or psychological labels.
export function speechTurn(moment){
 const text=moment.speech?.text || '';
 return moment.alignment==='overlapping' && /大家|你们|公屏|场控|朋友们|直播间的/u.test(text) && /[？?]|吗|呢|怎么|什么|哪|几|能不能|好不好|要不要/u.test(text) ? 'host-question' : 'speech';
}
export function conversationAtmosphere(chats,now){
 const rows=chats.filter(row=>now>=row.at && now-row.at<=30000);
 const concerns=rows.filter(row=>/别吵|不要吵|吵架|骂人|默哀|去世/u.test(row.text || '')).length;
 return {observedMessages:rows.length,pace:rows.length>=8 ? 'busy' : rows.length ? 'conversational' : 'quiet',caution:concerns>=2 ? 'sensitive' : 'ordinary',coverage:'关键词与采集数量只作调度线索；实际气氛结合原话判断，不推断主播心理'};
}
