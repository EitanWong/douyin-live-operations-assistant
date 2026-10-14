import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const header = `// ==UserScript==
// @name         抖音直播运营助手
// @namespace    local.douyin-live-assistant
// @version      0.1.1
// @description  抖音直播礼物感谢、观众欢迎、AI互动和定时消息助手，支持预览和人工审核。
// @match        https://live.douyin.com/*
// @run-at       document-start
// @sandbox      raw
// @noframes
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      *
// @license      MIT
// ==/UserScript==
`;
const files = ['core', 'protocol', 'ai', 'identity', 'adapter', 'ui', 'app'];
let body = '';
for (const name of files) {
  let source = await readFile(`${root}src/${name}.js`, 'utf8');
  source = source.replace(/^import\s+.*?;\s*$/gm, '').replace(/^export\s+/gm, '');
  body += `\n// --- ${name}.js ---\n${source}`;
}
await mkdir(`${root}dist`, { recursive: true });
await writeFile(`${root}dist/douyin-live-assistant.user.js`, `${header}\n(() => {\n'use strict';\n${body}\nboot();\n})();\n`);
console.log('Built dist/douyin-live-assistant.user.js (standalone; no runtime dependencies)');
const ext = `${root}dist/chrome-extension`;
await mkdir(ext, { recursive:true });
for (const name of ['manifest.json','popup.html','popup.css','popup.js','background.js']) await writeFile(`${ext}/${name}`,await readFile(`${root}extension/${name}`));
await writeFile(`${ext}/ai.js`,await readFile(`${root}src/ai.js`));
async function bundle(names, entry, async = false) {
  let code='';
  for (const name of names) code += (await readFile(`${root}src/${name}.js`,'utf8')).replace(/^import\s+.*?;\s*$/gm,'').replace(/^export\s+/gm,'') + '\n';
  return `(${async ? 'async ' : ''}() => {\n'use strict';\n${code}\n${await readFile(`${root}extension/${entry}.js`,'utf8')}\n})();\n`;
}
await writeFile(`${ext}/page.js`,await bundle(['core','protocol','adapter'],'page'));
await writeFile(`${ext}/content.js`,await bundle(files,'content',true));
await mkdir(`${ext}/icons`,{recursive:true});
for (const size of [16,48,128]) await writeFile(`${ext}/icons/${size}.png`,await readFile(`${root}extension/icons/${size}.png`));
console.log('Built dist/chrome-extension (Manifest V3)');
