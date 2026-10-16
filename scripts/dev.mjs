import { watch } from 'node:fs';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.DOUYIN_DEV_PORT || 4179);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DOUYIN_DEV_PORT 必须为 1024–65535');
let building = false, dirty = false, stopped = false, timer, revision = null, activeChild;
const server = createServer((req, res) => {
  // 只暴露构建标识，不提供项目源码、凭据或文件系统访问。
  if (req.method !== 'GET' || req.url !== '/build' || req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(404); return res.end(); }
  res.writeHead(revision ? 200 : 503, {'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({revision}));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
await mkdir(`${root}dist`, {recursive:true});
const lockPath = `${root}dist/development-watch.lock`;
let previousOwner;
try { previousOwner = Number(await readFile(lockPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previousOwner) {
  let active = false; try { process.kill(previousOwner, 0); active = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (active) throw new Error('另一个 npm run dev 正在运行');
  await rm(lockPath, {force:true});
}
// 普通构建不会覆盖正在运行的开发产物。
await writeFile(lockPath, String(process.pid), {flag:'wx'});
async function build() {
  dirty = true;
  if (building || stopped) return;
  building = true;
  try {
    while (dirty && !stopped) {
      dirty = false; revision = null;
      const code = await new Promise((resolve, reject) => {
        const child = activeChild = spawn(process.execPath, ['scripts/build.mjs','--dev'], {cwd:root,stdio:'inherit'});
        child.once('error', reject); child.once('exit', code => { activeChild = null; resolve(code); });
      });
      if (code === 0) {
        revision = JSON.parse(await readFile(`${root}dist/development-build.json`, 'utf8')).revision;
        console.log('开发构建就绪；Chrome 将自动重载扩展并刷新直播页。');
      } else console.error('构建失败；修复源码后重试，本次不会通知 Chrome 更新。');
    }
  } finally { building = false; }
}
const watchers = ['src','extension','scripts'].map(name => watch(`${root}${name}`, {recursive:true}, (_type, file) => {
  if (file && /(?:^|\/)\./.test(String(file))) return;
  clearTimeout(timer); timer = setTimeout(() => { void build().catch(console.error); }, 180);
}));
async function stop() {
  if (stopped) return;
  stopped = true; clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  server.close();
  if (activeChild) {
    const child = activeChild;
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  }
  await rm(lockPath, {force:true});
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
try { await build(); } catch (error) { await stop(); throw error; }
console.log(`监听源码：${root}\n首次请在 chrome://extensions 重新加载 dist/chrome-extension；后续保存代码自动更新。\n本地更新服务：http://127.0.0.1:${port}/build（Ctrl+C 停止）`);
