export const FANCLUB_FRAME_ORIGIN='https://lf-webcast-gr-sourcecdn.bytegecko.com';
export const FANCLUB_FRAME_PATH='/obj/byte-gurd-source-gr/webcast/mono/h5/fansclub_h5_douyin/pages/member_list/index.html';
export const fanclubId=value=>typeof value==='string' && /^\d{1,30}$/.test(value) ? value : '';
export const fanclubCount=value=>Number.isSafeInteger(value) && value>=0 ? String(value) : fanclubId(value) || null;
const fanclubText=(value,size=100)=>typeof value==='string' ? [...value].slice(0,size).join('') : '';
const fanclubLevel=value=>Number.isInteger(value) && value>=0 && value<=100 ? value : null;

export function fanclubFrameContext(href) {
  try {
    const url=new URL(href),params=url.searchParams;
    const anchorId=fanclubId(params.get('anchor_id_str') || params.get('anchor_id')),roomId=fanclubId(params.get('room_id'));
    if (url.origin!==FANCLUB_FRAME_ORIGIN || url.pathname!==FANCLUB_FRAME_PATH || !anchorId || !roomId) return null;
    const level=params.get('fans_level'),light=params.get('light_status');
    return {anchorId,roomId,clubId:fanclubId(params.get('fandom_id')),
      viewer:{userId:fanclubId(params.get('user_id')),level:level!==null && /^\d{1,3}$/.test(level) ? fanclubLevel(Number(level)) : null,lighted:light==='1' ? true : light==='0' ? false : null}};
  } catch {return null;}
}

export function cleanFanclubSnapshot(input) {
  if (!input || !fanclubId(input.anchorId) || !fanclubId(input.roomId) || !Number.isFinite(input.receivedAt) || input.receivedAt<=0) return null;
  const fansCount=fanclubCount(input.fansCount),lightedCount=fanclubCount(input.lightedCount);
  if (fansCount===null || lightedCount===null || !Array.isArray(input.members) || input.members.length>500) return null;
  const chunk=input.chunk ?? 0,chunks=input.chunks ?? 1,totalRows=input.totalRows ?? input.members.length;
  if (![chunk,chunks,totalRows].every(Number.isSafeInteger) || chunks<1 || chunks>50 || chunk<0 || chunk>=chunks || totalRows<0 || totalRows>500) return null;
  return {type:'anchor-fanclub',source:'native-fanclub',anchorId:input.anchorId,roomId:input.roomId,clubId:fanclubId(input.clubId),
    title:fanclubText(input.title),fansCount,lightedCount,receivedAt:input.receivedAt,
    snapshotId:fanclubText(input.snapshotId || input.id || String(input.receivedAt)),chunk,chunks,totalRows,
    hiddenInactive:input.hiddenInactive===true,truncated:input.truncated===true,
    viewer:input.viewer ? {userId:fanclubId(input.viewer.userId),level:fanclubLevel(input.viewer.level),lighted:typeof input.viewer.lighted==='boolean' ? input.viewer.lighted : null} : null,
    members:input.members.map((row,index)=>({position:Number.isInteger(row?.position) && row.position>0 && row.position<=500 ? row.position : index+1,
      name:fanclubText(row?.name,80),level:fanclubLevel(row?.level),badgeName:fanclubText(row?.badgeName,30),
      intimacy:fanclubCount(row?.intimacy),intimacyDisplay:fanclubText(row?.intimacyDisplay,40),intimacyApproximate:row?.intimacyApproximate===true}))};
}
