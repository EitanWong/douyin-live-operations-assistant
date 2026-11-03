import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PALETTES} from '../../src/ui/appearance.js';
import {paletteScale,onAccent,componentTheme,textAccent} from '../../src/ui/theme-palette.js';
const luminance=hex=>{const v=hex.slice(1).match(/../gu).map(x=>parseInt(x,16)/255).map(x=>x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
test('每套色板均有完整亮暗色阶，文字及实色按钮达到普通文字对比度',()=>{
 assert.equal(new Set(PALETTES.map(([id])=>id)).size,PALETTES.length);
 for(const [id] of PALETTES)for(const dark of [false,true]){
  const scale=paletteScale(id,dark);assert.equal(scale.length,12);for(const color of scale)assert.match(color,/^#[0-9a-f]{6}$/iu);
  assert.ok(contrast(textAccent(id,dark),dark ? '#303138' : '#f3f4f6')>=4.5,`${id} ${dark} 文本对比度`);
  const theme=componentTheme(id,dark),fill=theme.colors.brand[theme.primaryShade];assert.ok(contrast(fill,onAccent(fill))>=4.5,`${id} ${dark} 按钮对比度`);
 }
});
