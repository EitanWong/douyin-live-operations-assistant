const liveSessionFormatter = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export const sessionTime = at => Number.isFinite(at) && at > 0 ? liveSessionFormatter.format(at) : '未采集';
export const sessionStart = session => !session ? '未采集' : `${sessionTime(session.startAt)}${session.startSource === 'first-observed' ? '（首次观测）' : ['dom-observed','platform-observed'].includes(session.startSource) ? '（状态识别）' : ''}`;
export const sessionEnd = session => !session ? '未采集' : !session.endAt ? '直播中 · 尚未下播' : `${sessionTime(session.endAt)}${['room-changed','next-observed'].includes(session.endSource) ? '（推定边界）' : ['dom','platform-observed'].includes(session.endSource) ? '（状态识别）' : ''}`;
export function sessionDuration(session, now = Date.now()) {
  if (!session?.startAt) return '未知';
  const minutes = Math.floor(Math.max(0, (session.endAt || now) - session.startAt) / 60000);
  const duration = minutes < 1 ? '不足 1 分钟' : `${minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ` : ''}${minutes % 60} 分钟`;
  const observed = session.startSource !== 'platform' || session.endAt && session.endSource !== 'platform';
  return `${duration}${observed ? '（观测）' : ''}`;
}
