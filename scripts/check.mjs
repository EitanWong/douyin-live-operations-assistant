import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(process.env.DOUYIN_DIST_DIR || `${root}dist`);
for (const file of ['douyin-live-assistant.user.js', 'tool-runtime.js', 'chrome-extension/background.js', 'chrome-extension/popup.js', 'chrome-extension/content.js', 'chrome-extension/page.js', 'chrome-extension/indicator-frame.js']) {
  execFileSync(process.execPath, ['--check', resolve(dist, file)], {stdio:'inherit'});
}
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await checkDirectory(path);
    else if (/\.(?:mjs|js)$/.test(entry.name)) execFileSync(process.execPath, ['--check', path], {stdio:'inherit'});
  }
}
for (const directory of ['src', 'extension', 'scripts', 'tests']) await checkDirectory(resolve(root, directory));
console.log('Source and generated JavaScript syntax checks passed.');
