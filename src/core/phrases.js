// 直播间默认话术。内容保持短、口语化，并覆盖不同语气，减少连续回复的机械感。
// 仅使用渲染器支持的变量，避免默认模板依赖未核实的数据。
export const DEFAULT_PHRASES = {
  gift: [
    '谢谢 {user} 送来的 {gift}，心意收到啦！',
    '{user} 的 {gift} 到啦，感谢支持，直播间因为你更热闹了～',
    '感谢 {user} 的 {gift}，祝你今天顺顺利利！',
    '{user} 送来 {gift} ×{count}，这份鼓励我们记住啦！',
    '礼物收到，感谢 {user} 对直播间的支持！',
    '谢谢 {user} 的 {gift}，和大家一起玩得开心呀！',
    '{user} 的心意已签收，感谢这份陪伴～',
    '感谢 {user} 送的 {gift}，主播继续把内容做好！',
    '{user} 这一波 {gift} 太暖了，感谢来到直播间！',
    '收到 {user} 的 {gift} 啦，感谢你一直在这里！',
    '谢谢 {user} 的支持，{gift} ×{count} 都记下啦！',
    '感谢 {user} 送礼，祝你今晚有好心情！',
    '这份 {gift} 收到啦，感谢 {user} 给的鼓励！',
    '感谢 {user} 的礼物，直播间一起把气氛拉起来～',
    '{user} 的 {gift} 来得刚刚好，感谢支持！',
    '礼物和心意都收到啦，谢谢 {user}！'
  ],
  welcome: [
    '欢迎 {user} 进直播间，先找个舒服的位置坐下～',
    '{user} 来啦，欢迎欢迎，今天一起聊点有趣的！',
    '欢迎 {user}，刚好赶上，直播马上继续精彩！',
    '欢迎来到直播间，{user} 晚上好呀！',
    '{user} 欢迎你，喜欢的话可以先逛一逛～',
    '看到 {user} 进来了，欢迎一起玩！',
    '欢迎 {user} 到来，评论区随时可以加入聊天！',
    '{user} 来得正好，欢迎来直播间坐坐！',
    '欢迎新朋友 {user}，希望今天能让你开心！',
    '{user} 晚上好，欢迎回来，最近过得怎么样？',
    '欢迎 {user}，这里可以轻松聊，不用拘谨～',
    '欢迎 {user} 加入，和大家打个招呼吧！'
  ],
  like: [
    '谢谢 {user} 点赞，直播间收到你的鼓励啦！',
    '{user} 的赞看到了，感谢你一直支持～',
    '感谢 {user} 点亮小红心，气氛慢慢起来啦！',
    '谢谢 {user} 的点赞，愿你今天也有好心情！',
    '{user} 点赞收到，和大家一起看得开心呀！',
    '感谢 {user} 给直播间加油，赞赞都记住啦！',
    '看到 {user} 的点赞啦，谢谢陪伴！',
    '谢谢 {user} 送来的赞，继续聊起来～',
    '{user} 的支持已收到，感谢来直播间玩！',
    '感谢点赞，{user} 也记得常来坐坐！',
    '谢谢 {user}，每一个赞都是很大的鼓励！',
    '{user} 点赞成功，直播间的热度靠大家啦！'
  ]
};

export function choosePhrase(rotation, key, templates) {
  const list = Array.isArray(templates) ? templates.filter(text => typeof text === 'string' && text.trim()) : [];
  if (!list.length) return '';
  const signature = list.join('\u0001');
  const previous = rotation.get(key);
  let cursor = previous?.signature === signature ? previous.cursor : 0;
  let index = cursor % list.length;
  if (list.length > 1 && previous?.last === list[index]) index = (index + 1) % list.length;
  rotation.set(key, { signature, cursor: index + 1, last: list[index] });
  return list[index];
}
