const uid = value => typeof value === 'string' && /^[1-9]\d{0,19}$/u.test(value);
const boundary = /[\s，,：:。！？!?、;；()（）]/u;
export const normalizeChatText = text => String(text || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();

function indexTargets(targets) {
  const names = new Map();
  for (const target of targets) {
    if (typeof target?.name !== 'string' || !target.name) continue;
    const name=normalizeChatText(`@${target.name}`).slice(1);
    const ids = names.get(name) || new Set();
    ids.add(uid(target.id) ? target.id : null); names.set(name,ids);
  }
  return names;
}

// Resolve only complete observed nicknames. Explicit task targets retain the
// original identity when a lookup uses a shortened display name.
export function resolveChatMentions(text, users, targets = []) {
  if (!text.includes('@')) return [];
  const names = indexTargets(users);
  for (const [name,ids] of indexTargets(targets)) names.set(name,ids);
  const tokens = [...names].map(([name,ids])=>({token:`@${name}`,id:ids.size===1 ? [...ids][0] : null})).sort((a,b)=>b.token.length-a.token.length);
  const mentions = [];
  for (let start=0;start<text.length;start++) {
    if (text[start]!=='@' || start>0 && !boundary.test(text[start-1])) continue;
    const match = tokens.find(({token})=>text.startsWith(token,start) && (start+token.length===text.length || boundary.test(text[start+token.length])));
    if (!match) continue;
    if (match.id) mentions.push({id:match.id,start,length:match.token.length});
    start+=match.token.length-1;
  }
  return mentions;
}

// Native rtf_content offsets count UTF-16 code units, including the @ sign.
// Validate untrusted bridge data once before it reaches the page HTTP client.
export function encodeChatMentions(text, mentions = []) {
  if (!Array.isArray(mentions) || mentions.length>25) throw new Error('@观众参数无效');
  let end=0;
  const parts=mentions.map(mention=>{
    const {id,start,length}=mention || {};
    if (!uid(id) || !Number.isInteger(start) || !Number.isInteger(length) || start<end || length<2 || start+length>text.length || text[start]!=='@') throw new Error('@观众身份或范围无效');
    const token=text.slice(start,start+length);
    if (/[\uD800-\uDBFF]$/u.test(token)) throw new Error('@观众范围截断了表情');
    end=start+length;
    return {type:2,value:JSON.stringify({uid:id,webcast_uid:''}),start,length};
  });
  return parts.length ? JSON.stringify(parts) : '';
}

const mentionBoundary = /[\s\u200b:：,，。!！?？]/u;

// 有结构化被 @ 账号时以 UID 为准；纯文本必须完整匹配昵称，不能误回同名前缀。
export function addressedToSelf(event, self, configuredId = '') {
  const text = String(event.text || '').trim();
  const ids = new Set([configuredId || self?.id, self?.secUid].filter(Boolean).map(String));
  const mentions = Array.isArray(event.mentions) ? event.mentions.map(String) : [];
  const structured = mentions.length > 0;
  if (structured && !mentions.some(id => ids.has(id))) return null;
  const name = (!configuredId || !self?.id || String(self.id) === String(configuredId)) && self?.name;
  if (name) {
    const token = `@${name}`;
    let offset = text.indexOf(token);
    while (offset >= 0) {
      const end = offset + token.length;
      if ((!offset || mentionBoundary.test(text[offset - 1])) && (end === text.length || mentionBoundary.test(text[end]))) {
        return `${text.slice(0, offset)} ${text.slice(end)}`.trim().replace(/^[:：,，\s]+/u, '');
      }
      offset = text.indexOf(token, end);
    }
  }
  if (!structured) return null;
  // 手动 UID 也可使用结构化 @；页面未提供昵称时，移除开头的显示昵称。
  return text.replace(/^@[^\s\u200b]+(?:[\s\u200b]+|$)/u, '').trim();
}
