// Shared allowlist for the UI and the privileged preference gateway.
export const THEME_KEY='douyin-live-assistant:theme';
export const PALETTE_KEY='douyin-live-assistant:palette';
export const MATERIAL_KEY='douyin-live-assistant:material';
export const PALETTES=[['original','原始配色 · Solid Glass'],['iris','鸢尾'],['indigo','靛青'],['blue','海蓝'],['cyan','青空'],['teal','海湾'],['jade','翡翠'],['green','苔绿'],['grass','草木'],['mint','薄荷'],['sky','晴空'],['lime','青柠'],['violet','罗兰'],['purple','紫晶'],['plum','梅紫'],['pink','樱粉'],['crimson','绯红'],['ruby','宝石红'],['red','经典红'],['tomato','番茄红'],['orange','落日'],['amber','琥珀'],['yellow','柠黄'],['brown','可可'],['bronze','铜色'],['gold','香槟'],['gray','石墨'],['mauve','雾紫'],['slate','石板'],['sage','鼠尾草'],['olive','橄榄'],['sand','沙色']];
export const MATERIALS=[['glass','原始玻璃 · Solid Glass'],['liquid','流光玻璃 · Liquid Glass'],['solid','简洁实色']];
export const APPEARANCE_PREFERENCES={theme:{key:THEME_KEY,values:['system','light','dark'],fallback:'system'},palette:{key:PALETTE_KEY,values:PALETTES.map(([key])=>key),fallback:'original'},material:{key:MATERIAL_KEY,values:MATERIALS.map(([key])=>key),fallback:'liquid'}};
export const normalizeAppearance=(kind,value)=>APPEARANCE_PREFERENCES[kind].values.includes(value) ? value : APPEARANCE_PREFERENCES[kind].fallback;
