import { readFile, mkdir, writeFile, rm, rename, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SOLID_GLASS_CSS } from '../src/ui/solid-glass.js';
import { build } from 'esbuild';
import { bundleStandalone } from './standalone-build.mjs';
import { readPackageLicense } from './dependency-licenses.mjs';
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
// @version      0.1.3
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
let mediaLicense='';
for(const name of ['mpegts.js/LICENSE','hls.js/LICENSE','es6-promise/LICENSE','events/LICENSE'])mediaLicense+=`${name}\n${await readFile(`${root}node_modules/${name}`,'utf8')}\n`;
let productLicenses=`shuorenhua 2.6.1 · adapted response policy\n${await readFile(`${root}vendor/runtime-licenses/shuorenhua/LICENSE`,'utf8')}\n`;
// Include runtime UI and validation dependencies, including transitive MIT code.
const productPackages=['@langchain/langgraph','@langchain/core','@langchain/langgraph-checkpoint','langsmith','eventemitter3','p-finally','p-timeout','p-queue','@cfworker/json-schema','base64-js','js-tiktoken','mustache','motion','framer-motion','motion-dom','motion-utils','@radix-ui/colors','react','react-dom','scheduler','@mantine/core','@mantine/hooks','@tanstack/react-table','@tanstack/table-core','@tanstack/react-store','@tanstack/store','use-sync-external-store','@floating-ui/react','@floating-ui/react-dom','@floating-ui/dom','@floating-ui/core','@floating-ui/utils','clsx','react-number-format','react-remove-scroll','react-remove-scroll-bar','react-style-singleton','use-callback-ref','use-sidecar','get-nonce','detect-node-es','tabbable','zod','minisearch','dexie','xstate','eventsource-parser','lru-cache','linkedom','@mozilla/readability','css-select','cssomnom','html-escaper','htmlparser2','uhyphen','domhandler','domutils','domelementtype','entities','dom-serializer','css-what','nth-check','boolbase'];
for(const name of productPackages){
  const license=await readPackageLicense(root,name);
  if(!license)throw new Error(`Missing license for ${name}`);productLicenses+=`\n${name}\n${license}\n`;if(name==='dexie')productLicenses+=await readFile(`${root}node_modules/dexie/NOTICE`,'utf8');
}
const toolNotice=`/*! Cordis · MIT\n${cordisLicense}\nCosmokit · MIT\n${cosmokitLicense}\n*/`;
const bundleNotice=`/*! Product UI foundations
${productLicenses}
*/
/*! Live stream decoders\n${mediaLicense}\n*/\n${toolNotice}\n/*! jsonrepair · ISC\n${intentLicense}\n*/\n/*! Lucide\n${iconLicense}\n*/\n/*! chinese-xinhua\n${await readFile(`${root}vendor/chinese-xinhua/LICENSE`,'utf8')}\nchinese-dictionary\n${await readFile(`${root}vendor/chinese-dictionary/LICENSE`,'utf8')}\n*/`;
const toolBuild={entryPoints:[`${root}src/tools/cordis-adapter.js`],bundle:true,platform:'browser',minify:true,legalComments:'inline',target:'chrome111',banner:{js:toolNotice}};
await mkdir(dist, { recursive: true });
for(const [entry,name] of [['src/ai/audience-memory.js','audience-memory'],['src/ai/assistant-config.js','assistant-config'],['src/ai/skills.js','assistant-skills'],['src/ai/local-agent.js','local-agent'],['src/services/retrieval.js','knowledge-retrieval'],['src/browser/media-session.js','media-session'],['src/services/completion-stream.js','completion-stream']])await build({entryPoints:[`${root}${entry}`],bundle:true,format:'esm',minify:true,legalComments:'inline',target:'chrome111',outfile:`${dist}/${name}.js`});
await build({entryPoints:[`${root}src/demo-entry.js`],bundle:true,format:'esm',minify:true,loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline',banner:{js:bundleNotice},target:'chrome111',outfile:`${dist}/demo-app.js`});
await build({entryPoints:[`${root}src/ui/window-presence.js`],bundle:true,format:'esm',minify:true,define:{'process.env.NODE_ENV':'"production"'},target:'chrome111',outfile:`${dist}/window-presence.js`});
await build({entryPoints:[`${root}src/ui/theme-palette.js`],bundle:true,format:'esm',minify:true,target:'chrome111',outfile:`${dist}/theme-palettes.js`});
await build({entryPoints:[`${root}src/ui/product/runtime.js`],bundle:true,format:'esm',minify:true,loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline',target:'chrome111',outfile:`${dist}/product-ui.js`});
await build({entryPoints:[`${root}src/services/ai-pipeline.js`],bundle:true,format:'esm',minify:true,legalComments:'inline',target:'chrome111',outfile:`${dist}/ai-pipeline.js`});
await build({entryPoints:[`${root}src/ui/live-charts.js`],bundle:true,format:'esm',minify:true,legalComments:'inline',target:'chrome111',outfile:`${dist}/live-charts.js`});
await build({entryPoints:[`${root}src/services/intent.js`],bundle:true,format:'esm',minify:true,legalComments:'inline',banner:{js:`/*! jsonrepair · ISC\n${intentLicense}\n*/`},target:'chrome111',outfile:`${dist}/ai-intent.js`});
await build({entryPoints:[`${root}src/services/live-stream-codecs.js`],bundle:true,format:'esm',minify:true,legalComments:'inline',banner:{js:`/*! Live stream decoders\n${mediaLicense}\n*/`},target:'chrome120',outfile:`${dist}/live-stream-codecs.js`});
await build({...toolBuild,format:'esm',outfile:`${dist}/tool-runtime.js`});
await writeFile(`${dist}/douyin-live-assistant.user.js`,await bundleStandalone({entry:`${root}src/userscript.js`,banner:header+'\n'+bundleNotice,target:'chrome111'}));
console.log('Built dist/douyin-live-assistant.user.js (standalone; no runtime dependencies)');
const destination = `${dist}/chrome-extension`;
const ext = development ? `${dist}/.chrome-extension-next-${process.pid}` : destination;
await mkdir(ext, { recursive:true });
for (const name of ['manifest.json','popup.html','popup.css','popup.js','durable-storage.js','protocol-cache.js']) await writeFile(`${ext}/${name}`,await readFile(`${root}extension/${name}`));
const glassLicense = await readFile(`${root}vendor/solid-glass/LICENSE`, 'utf8');
const liquidGlassLicense = await readFile(`${root}vendor/liquid-glass-react/LICENSE`, 'utf8');
await writeFile(`${ext}/solid-glass.css`, `/* Solid Glass · https://github.com/deeplethe/solid-glass\n${glassLicense}\nLiquid Glass React · https://github.com/rdev/liquid-glass-react\n${liquidGlassLicense}\n*/\n${SOLID_GLASS_CSS}`);
await build({entryPoints:[`${root}extension/durable-storage.js`],bundle:true,format:'esm',target:'chrome120',banner:{js:bundleNotice},outfile:`${ext}/durable-storage.js`});
await build({entryPoints:[`${root}src/ui/theme.js`],bundle:true,format:'esm',target:'chrome120',outfile:`${ext}/theme.js`});
// AI 模块的源码相对依赖不属于扩展目录，必须一起打包供后台加载。
await build({entryPoints:[`${root}src/services/ai.js`],bundle:true,format:'esm',target:'chrome120',banner:{js:`/*! jsonrepair · ISC\n${intentLicense}\n*/`},outfile:`${ext}/ai.js`});
await build({entryPoints:[`${root}src/services/search.js`],bundle:true,format:'esm',target:'chrome120',outfile:`${ext}/search.js`});
await writeFile(`${ext}/gifts.js`,await readFile(`${root}src/data/gifts.js`));
await build({entryPoints:[`${root}extension/collection-keeper.js`],bundle:true,format:'esm',target:'chrome120',outfile:`${ext}/collection-keeper.js`});
// Runtime code and ORT executable assets stay inside MV3; only pinned model data is downloaded.
for(const name of ['edge-offscreen.html'])await copyFile(`${root}extension/${name}`,`${ext}/${name}`);
await copyFile(`${root}vendor/runtime-fixtures/asr-benchmark-zh.wav`,`${ext}/asr-benchmark-zh.wav`);
for(const name of ['edge-worker','edge-offscreen','account-page','speech-vad'])await build({entryPoints:[`${root}extension/${name}.js`],bundle:true,format:name==='account-page' ? 'iife' : 'esm',platform:'browser',target:'chrome120',outfile:`${ext}/${name}.js`});
await rm(`${ext}/vad`,{recursive:true,force:true});
await mkdir(`${ext}/vad/ort`,{recursive:true});
for(const name of ['vad.worklet.bundle.min.js','silero_vad_v5.onnx'])await copyFile(`${root}node_modules/@ricky0123/vad-web/dist/${name}`,`${ext}/vad/${name}`);
for(const name of await readdir(`${root}node_modules/@ricky0123/vad-web/node_modules/onnxruntime-web/dist`))if(/^ort-wasm-simd-threaded\.(wasm|mjs)$/u.test(name))await copyFile(`${root}node_modules/@ricky0123/vad-web/node_modules/onnxruntime-web/dist/${name}`,`${ext}/vad/ort/${name}`);
await rm(`${ext}/ort`,{recursive:true,force:true});
await mkdir(`${ext}/ort`,{recursive:true});
for(const name of await readdir(`${root}node_modules/onnxruntime-web/dist`))if(/^ort-wasm.*\.(wasm|mjs)$/u.test(name))await copyFile(`${root}node_modules/onnxruntime-web/dist/${name}`,`${ext}/ort/${name}`);
await build({entryPoints:[`${root}extension/background.js`],bundle:true,format:'esm',target:'chrome120',banner:{js:bundleNotice},outfile:`${ext}/background.js`});
await writeFile(`${ext}/page.js`,await bundleStandalone({entry:`${root}extension/page.js`,banner:bundleNotice}));
await writeFile(`${ext}/content.js`,await bundleStandalone({entry:`${root}extension/content.js`,banner:bundleNotice}));
await build({entryPoints:[`${root}extension/indicator-frame.js`],bundle:true,format:'iife',target:'chrome120',outfile:`${ext}/indicator-frame.js`});
await build({entryPoints:[`${root}extension/fanclub-frame.js`],bundle:true,format:'iife',target:'chrome120',outfile:`${ext}/fanclub-frame.js`});
await build({entryPoints:[`${root}src/data/fanclub.js`],bundle:true,format:'esm',target:'chrome120',outfile:`${ext}/fanclub-data.js`});
await mkdir(`${ext}/icons`,{recursive:true});
const iconPaths = Object.values(JSON.parse(await readFile(`${ext}/manifest.json`, 'utf8')).icons);
for (const name of iconPaths) await copyFile(`${root}extension/${name}`, `${ext}/${name}`);
let chartLicenses='';
for(const name of ['echarts/LICENSE','echarts/NOTICE','echarts/licenses/LICENSE-d3','zrender/LICENSE','tslib/LICENSE.txt','tslib/CopyrightNotice.txt'])chartLicenses+=`${name}\n${await readFile(`${root}node_modules/${name}`,'utf8')}\n\n`;
chartLicenses += `chinese-dictionary (vendor/chinese-dictionary)\n${await readFile(`${root}vendor/chinese-dictionary/LICENSE`,'utf8')}\n`;
chartLicenses += `chinese-xinhua (vendor/chinese-xinhua)\n${await readFile(`${root}vendor/chinese-xinhua/LICENSE`,'utf8')}\n`;
chartLicenses += `Lucide icon subset (vendor/lucide)\n${iconLicense}\n`;
chartLicenses += `jsonrepair · ISC\n${intentLicense}\n`;
chartLicenses += `Cordis 4.0.0-rc.12 (vendor/cordis)\n${cordisLicense}\nCosmokit\n${cosmokitLicense}\n`;
chartLicenses+=mediaLicense;
chartLicenses+=`\nSilero VAD v5 · MIT\n${await readFile(`${root}vendor/runtime-licenses/silero-vad/LICENSE`,'utf8')}\n`;
chartLicenses+=productLicenses;
chartLicenses+=await readFile(`${root}vendor/runtime-licenses/onnxruntime-web/ThirdPartyNotices.txt`,'utf8');
for(const name of ['@ricky0123/vad-web','@huggingface/transformers','onnxruntime-web','onnxruntime-common','@huggingface/jinja','@huggingface/tokenizers','cockatiel'])chartLicenses+=`\n${name}\n${await readPackageLicense(root,name)}\n`;
chartLicenses+=`\nModel weights are downloaded separately: Qwen2.5-0.5B-Instruct and Qwen2.5-1.5B-Instruct (Apache-2.0), Whisper tiny (MIT). See docs/ai-foundation.zh-CN.md.\n`;
chartLicenses+=`\nLiquid Glass React · https://github.com/rdev/liquid-glass-react\n${liquidGlassLicense}\n`;
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
  for (const name of ['manifest.json','content.js','page.js','indicator-frame.js','fanclub-frame.js','fanclub-data.js','background.js','popup.js','popup.html','popup.css','solid-glass.css','theme.js','ai.js','search.js','gifts.js','durable-storage.js','protocol-cache.js','development-reload.js','development-content.js',...iconPaths]) hash.update(await readFile(`${ext}/${name}`));
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
