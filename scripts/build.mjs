import { readFile, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SOLID_GLASS_CSS } from '../src/ui/solid-glass.js';
import { build } from 'esbuild';
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
// @version      0.1.1
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
const chartBundle = (await build({entryPoints:[`${root}src/ui/live-charts.js`],bundle:true,write:false,format:'iife',globalName:'LiveAssistantCharts',minify:true,legalComments:'inline',target:'chrome111'})).outputFiles[0].text + '\nconst { LiveCharts } = LiveAssistantCharts;\n';
const files = ['runtime/journal', 'runtime/delivery', 'runtime/inbox', 'runtime/live-metrics', 'runtime/health', 'data/interaction-questions', 'core/bot', 'core/phrases', 'core/audience', 'core/milestones', 'core/anchor-stats', 'pk/model', 'core/engine', 'browser/protocol', 'services/ai', 'browser/identity', 'browser/request-sender', 'browser/anchor-data', 'browser/adapter', 'ui/solid-glass', 'ui/theme', 'ui/live-charts', 'ui/stat-visuals', 'ui/anchor-view-model', 'ui/anchor-template', 'ui/anchor-styles', 'ui/anchor-dashboard', 'ui/panel', 'data/gifts', 'app'];
let body = '';
for (const name of files) {
  let source = name === 'ui/live-charts' ? chartBundle : await readFile(`${root}src/${name}.js`, 'utf8');
  source = source.replace(/^import\s+.*?;\s*$/gm, '').replace(/^export\s+/gm, '');
  body += `\n// --- ${name}.js ---\n${source}`;
}
await mkdir(dist, { recursive: true });
await build({entryPoints:[`${root}src/ui/live-charts.js`],bundle:true,format:'esm',minify:true,legalComments:'inline',target:'chrome111',outfile:`${dist}/live-charts.js`});
await writeFile(`${dist}/douyin-live-assistant.user.js`, `${header}\n(() => {\n'use strict';\n${body}\nboot();\n})();\n`);
console.log('Built dist/douyin-live-assistant.user.js (standalone; no runtime dependencies)');
const destination = `${dist}/chrome-extension`;
const ext = development ? `${dist}/.chrome-extension-next-${process.pid}` : destination;
await mkdir(ext, { recursive:true });
for (const name of ['manifest.json','popup.html','popup.css','popup.js','background.js','durable-storage.js']) await writeFile(`${ext}/${name}`,await readFile(`${root}extension/${name}`));
const glassLicense = await readFile(`${root}vendor/solid-glass/LICENSE`, 'utf8');
await writeFile(`${ext}/solid-glass.css`, `/* Solid Glass · https://github.com/deeplethe/solid-glass\n${glassLicense}\n*/\n${SOLID_GLASS_CSS}`);
await writeFile(`${ext}/theme.js`, await readFile(`${root}src/ui/theme.js`));
await writeFile(`${ext}/ai.js`,await readFile(`${root}src/services/ai.js`));
await writeFile(`${ext}/gifts.js`,await readFile(`${root}src/data/gifts.js`));
async function bundle(names, entry, async = false) {
  let code='';
  for (const name of names) code += (name === 'ui/live-charts' ? chartBundle : await readFile(`${root}src/${name}.js`,'utf8')).replace(/^import\s+.*?;\s*$/gm,'').replace(/^export\s+/gm,'') + '\n';
  return `(${async ? 'async ' : ''}() => {\n'use strict';\n${code}\n${await readFile(`${root}extension/${entry}.js`,'utf8')}\n})();\n`;
}
await writeFile(`${ext}/page.js`,await bundle(['runtime/delivery','runtime/live-metrics','data/interaction-questions', 'core/bot','core/phrases','core/audience','core/milestones','core/anchor-stats','pk/model','core/engine','browser/protocol','browser/request-sender','browser/anchor-data','browser/adapter'],'page'));
await writeFile(`${ext}/content.js`,await bundle(files,'content',true));
await mkdir(`${ext}/icons`,{recursive:true});
for (const size of [16,48,128]) await writeFile(`${ext}/icons/${size}.png`,await readFile(`${root}extension/icons/${size}.png`));
let chartLicenses='';
for(const name of ['echarts/LICENSE','echarts/NOTICE','echarts/licenses/LICENSE-d3','zrender/LICENSE','tslib/LICENSE.txt','tslib/CopyrightNotice.txt'])chartLicenses+=`${name}\n${await readFile(`${root}node_modules/${name}`,'utf8')}\n\n`;
await writeFile(`${ext}/THIRD_PARTY_LICENSES.txt`,chartLicenses);
await writeFile(`${dist}/THIRD_PARTY_LICENSES.txt`,chartLicenses);
console.log('Built dist/chrome-extension (Manifest V3)');
if (development) {
  const manifest = JSON.parse(await readFile(`${ext}/manifest.json`, 'utf8'));
  manifest.name += ' · 开发';
  manifest.minimum_chrome_version = '120';
  manifest.permissions.push('alarms');
  manifest.host_permissions.push(`http://127.0.0.1:${developmentPort}/*`);
  manifest.content_scripts.push({ matches:['https://live.douyin.com/*'], js:['development-content.js'], run_at:'document_start' });
  await writeFile(`${ext}/manifest.json`, JSON.stringify(manifest, null, 2));
  for (const name of ['development-reload.js', 'development-content.js']) await writeFile(`${ext}/${name}`, await readFile(`${root}extension/${name}`));
  const hash = createHash('sha256');
  for (const name of ['manifest.json','content.js','page.js','background.js','popup.js','popup.html','popup.css','solid-glass.css','theme.js','ai.js','gifts.js','durable-storage.js','development-reload.js','development-content.js']) hash.update(await readFile(`${ext}/${name}`));
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
