import { readFile, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SOLID_GLASS_CSS } from '../src/ui/solid-glass.js';
import { build } from 'esbuild';
import { bundleStandalone } from './standalone-build.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = process.env.DOUYIN_DIST_DIR || `${root}dist`;
const development = process.argv.includes('--dev');
const developmentPort = Number(process.env.DOUYIN_DEV_PORT || 4179);
if (!Number.isInteger(developmentPort) || developmentPort < 1024 || developmentPort > 65535) throw new Error('DOUYIN_DEV_PORT 必须为 1024–65535');
if (!development && !process.env.DOUYIN_DIST_DIR) {
  let owner;
  try { owner = Number(await readFile(`${dist}/development-watch.lock`, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (owner) {
    let active = false; try { process.kill(owner, 0); active = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (active) throw new Error('npm run dev 正在维护开发构建；请先停止监听再执行正式 build');
  }
}
const header = `// ==UserScript==
// @name         抖音直播运营助手
// @namespace    local.douyin-live-assistant
// @version      0.1.2
// @description  抖音直播互动场控助手，支持仅预览或自动发送；按需启用各模块。
// @match        https://live.douyin.com/*
// @run-at       document-start
// @sandbox      raw
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// @license      MIT
// ==/UserScript==
`;
const intentLicense=await readFile(`${root}node_modules/jsonrepair/LICENSE.md`,'utf8');
const cordisLicense=await readFile(`${root}vendor/cordis/LICENSE`,'utf8');
const cosmokitLicense=await readFile(`${root}node_modules/cosmokit/LICENSE`,'utf8');
const iconLicense=await readFile(`${root}vendor/lucide/LICENSE`,'utf8');
const toolNotice=`/*! Cordis · MIT\n${cordisLicense}\nCosmokit · MIT\n${cosmokitLicense}\n*/`;
const bundleNotice=`${toolNotice}\n/*! jsonrepair · ISC\n${intentLicense}\n*/\n/*! Lucide\n${iconLicense}\n*/\n/*! chinese-xinhua\n${await readFile(`${root}vendor/chinese-xinhua/LICENSE`,'utf8')}\nchinese-dictionary\n${await readFile(`${root}vendor/chinese-dictionary/LICENSE`,'utf8')}\n*/`;
const toolBuild={entryPoints:[`${root}src/tools/cordis-adapter.js`],bundle:true,platform:'browser',minify:true,legalComments:'inline',target:'chrome111',banner:{js:toolNotice}};
await mkdir(dist, { recursive: true });
await build({entryPoints:[`${root}src/ui/live-charts.js`],bundle:true,format:'esm',minify:true,legalComments:'inline',target:'chrome111',outfile:`${dist}/live-charts.js`});
await build({entryPoints:[`${root}src/services/intent.js`],bundle:true,format:'esm',minify:true,legalComments:'inline',banner:{js:`/*! jsonrepair · ISC\n${intentLicense}\n*/`},target:'chrome111',outfile:`${dist}/ai-intent.js`});
await build({...toolBuild,format:'esm',outfile:`${dist}/tool-runtime.js`});
await writeFile(`${dist}/douyin-live-assistant.user.js`,await bundleStandalone({entry:`${root}src/userscript.js`,banner:header+'\n'+bundleNotice,target:'chrome111'}));
console.log('Built dist/douyin-live-assistant.user.js (standalone; no runtime dependencies)');
const destination = `${dist}/chrome-extension`;
const ext = development ? `${dist}/.chrome-extension-next-${process.pid}` : destination;
await mkdir(ext, { recursive:true });
for (const name of ['manifest.json','popup.html','popup.css','popup.js','durable-storage.js','protocol-cache.js']) await writeFile(`${ext}/${name}`,await readFile(`${root}extension/${name}`));
const glassLicense = await readFile(`${root}vendor/solid-glass/LICENSE`, 'utf8');
await writeFile(`${ext}/solid-glass.css`, `/* Solid Glass · https://github.com/deeplethe/solid-glass\n${glassLicense}\n*/\n${SOLID_GLASS_CSS}`);
await writeFile(`${ext}/theme.js`, await readFile(`${root}src/ui/theme.js`));
// AI 模块的源码相对依赖不属于扩展目录，必须一起打包供后台加载。
await build({entryPoints:[`${root}src/services/ai.js`],bundle:true,format:'esm',target:'chrome120',banner:{js:`/*! jsonrepair · ISC\n${intentLicense}\n*/`},outfile:`${ext}/ai.js`});
await build({entryPoints:[`${root}src/services/search.js`],bundle:true,format:'esm',target:'chrome120',outfile:`${ext}/search.js`});
await writeFile(`${ext}/gifts.js`,await readFile(`${root}src/data/gifts.js`));
await build({entryPoints:[`${root}extension/collection-keeper.js`],bundle:true,format:'esm',target:'chrome120',outfile:`${ext}/collection-keeper.js`});
await build({entryPoints:[`${root}extension/background.js`],bundle:true,format:'esm',target:'chrome120',banner:{js:bundleNotice},outfile:`${ext}/background.js`});
await writeFile(`${ext}/page.js`,await bundleStandalone({entry:`${root}extension/page.js`,banner:bundleNotice}));
await writeFile(`${ext}/content.js`,await bundleStandalone({entry:`${root}extension/content.js`,banner:bundleNotice}));
await build({entryPoints:[`${root}extension/indicator-frame.js`],bundle:true,format:'iife',target:'chrome120',outfile:`${ext}/indicator-frame.js`});
await build({entryPoints:[`${root}extension/fanclub-frame.js`],bundle:true,format:'iife',target:'chrome120',outfile:`${ext}/fanclub-frame.js`});
await build({entryPoints:[`${root}src/data/fanclub.js`],bundle:true,format:'esm',target:'chrome120',outfile:`${ext}/fanclub-data.js`});
await mkdir(`${ext}/icons`,{recursive:true});
for (const size of [16,48,128]) await writeFile(`${ext}/icons/${size}.png`,await readFile(`${root}extension/icons/${size}.png`));
let chartLicenses='';
for(const name of ['echarts/LICENSE','echarts/NOTICE','echarts/licenses/LICENSE-d3','zrender/LICENSE','tslib/LICENSE.txt','tslib/CopyrightNotice.txt'])chartLicenses+=`${name}\n${await readFile(`${root}node_modules/${name}`,'utf8')}\n\n`;
chartLicenses += `chinese-dictionary (vendor/chinese-dictionary)\n${await readFile(`${root}vendor/chinese-dictionary/LICENSE`,'utf8')}\n`;
chartLicenses += `chinese-xinhua (vendor/chinese-xinhua)\n${await readFile(`${root}vendor/chinese-xinhua/LICENSE`,'utf8')}\n`;
chartLicenses += `Lucide icon subset (vendor/lucide)\n${iconLicense}\n`;
chartLicenses += `jsonrepair · ISC\n${intentLicense}\n`;
chartLicenses += `Cordis 4.0.0-rc.12 (vendor/cordis)\n${cordisLicense}\nCosmokit\n${cosmokitLicense}\n`;
await writeFile(`${ext}/THIRD_PARTY_LICENSES.txt`,chartLicenses);
await writeFile(`${dist}/THIRD_PARTY_LICENSES.txt`,chartLicenses);
console.log('Built dist/chrome-extension (Manifest V3)');
if (development) {
  const manifest = JSON.parse(await readFile(`${ext}/manifest.json`, 'utf8'));
  manifest.name += ' · 开发';
  manifest.minimum_chrome_version = '120';
  manifest.host_permissions.push(`http://127.0.0.1:${developmentPort}/*`);
  manifest.content_scripts.push({ matches:['https://live.douyin.com/*'], js:['development-content.js'], run_at:'document_start' });
  await writeFile(`${ext}/manifest.json`, JSON.stringify(manifest, null, 2));
  for (const name of ['development-reload.js', 'development-content.js']) await writeFile(`${ext}/${name}`, await readFile(`${root}extension/${name}`));
  const hash = createHash('sha256');
  for (const name of ['manifest.json','content.js','page.js','indicator-frame.js','fanclub-frame.js','fanclub-data.js','background.js','popup.js','popup.html','popup.css','solid-glass.css','theme.js','ai.js','search.js','gifts.js','durable-storage.js','protocol-cache.js','development-reload.js','development-content.js']) hash.update(await readFile(`${ext}/${name}`));
  const revision = hash.digest('hex');
  await writeFile(`${ext}/background.js`, `${await readFile(`${ext}/background.js`, 'utf8')}\nimport { installDevelopmentReload } from './development-reload.js';\ninstallDevelopmentReload({ chrome, revision:'${revision}', endpoint:'http://127.0.0.1:${developmentPort}/build', beforeReload:async()=>{ await storageReady; await giftStore.tail; } });\n`);
  // 最后发布构建标识；构建中或失败时，Chrome 不会读到半成品更新通知。
  const backup = `${dist}/.chrome-extension-previous-${process.pid}`;
  try { await rename(destination, backup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(ext, destination); }
  catch (error) { try { await rename(backup, destination); } catch {} throw error; }
  await rm(backup, {recursive:true,force:true});
  await writeFile(`${dist}/development-build.json`, JSON.stringify({ revision }));
  console.log('Development reload enabled');
}
