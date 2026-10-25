import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';

// These standalone scripts remove ESM import statements. Include their local
// dependencies first, instead of relying on a second, manually maintained list.
export async function resolveBuildModules(names, sourceRoot) {
  const ordered = [], visited = new Set(), visiting = new Set();
  async function visit(name) {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`构建模块循环依赖：${name}`);
    visiting.add(name);
    const source = await readFile(new URL(`${name}.js`, sourceRoot), 'utf8');
    for (const match of source.matchAll(/^import\s+.*?\s+from\s+['"]([^'"]+)['"];\s*$/gm)) {
      if (!match[1].startsWith('.')) continue; // live-charts packages are bundled separately.
      const dependency = posix.normalize(posix.join(posix.dirname(name),match[1])).replace(/\.js$/, '');
      if (dependency.startsWith('../')) throw new Error(`构建依赖越出源码目录：${dependency}`);
      await visit(dependency);
    }
    visiting.delete(name); visited.add(name); ordered.push(name);
  }
  for (const name of names) await visit(name);
  return ordered;
}
