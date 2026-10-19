export function recognizeMilestone(text) {
  const value = String(text || '').replace(/[\u200b\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim();
  const name = '[\\p{L}\\p{N}_·-]{1,40}';
  const greeting = '(?:恭喜|感谢)';
  const contribution = new RegExp(`${greeting}[\\s\\S]*?(${name})\\s*成为\\s*(?:No\\.?\\s*(\\d+)\\s*本场?|本场\\s*No\\.?\\s*(\\d+))\\s*[、，,:：]?\\s*1000\\s*(?:票\\s*)?(?:贡献用户|票贡献用户|贡献榜用户)`, 'u');
  const match = value.match(contribution);
  if (match) return { kind: 'contribution', name: match[1], rank: Number(match[2] || match[3]) };
  const guardian = value.match(new RegExp(`${greeting}[\\s\\S]*?(${name})\\s*成为\\s*星守护`, 'u'));
  return guardian ? { kind: 'guardian', name: guardian[1] } : null;
}

export function milestoneThankYou(milestone) {
  if (milestone?.kind === 'guardian') return `感谢${milestone.name}开通星守护，欢迎加入！`;
  if (milestone?.kind === 'contribution' && Number.isSafeInteger(milestone.rank)) return `感谢${milestone.name}成为本场No.${milestone.rank}、1000票贡献用户！`;
  return '';
}
