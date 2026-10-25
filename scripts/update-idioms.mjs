// Reproduce the pinned, reviewed dictionary without silently accepting upstream changes.
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const idiomSources = [
  {repo:'pwxcoo/chinese-xinhua', revision:'fe6d6c2e8baa82187f4c96bbe042e43f96c05666', path:'data/idiom.json', hash:'1d4b4f454ce1c416d6a1ab2369d6e66c0ff99e04390172eef70790499e21ce19'},
  {repo:'mapull/chinese-dictionary', revision:'e804ada333b68afddfdccbe8dcc938a72da157a7', path:'idiom/idiom.json', hash:'54f0cefb5b7d3ea9a3b357bcd7d53877f5a4c11d1c68ff1790f831800c000ace'}
];
const records = new Map();
for (const source of idiomSources) {
  const response = await fetch(`https://raw.githubusercontent.com/${source.repo}/${source.revision}/${source.path}`);
  if (!response.ok) throw new Error(`成语数据下载失败：${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== source.hash) throw new Error('成语数据校验失败，请检查固定版本');
  const before=records.size;
  for (const item of JSON.parse(bytes)) {
    const word = item.word.replace(/[，,、；;。！!？?·\s]/gu, '');
    const syllables = item.pinyin.toLowerCase().replace(/[üǖǘǚǜ]/gu, 'v').normalize('NFD').replace(/\p{M}/gu, '').split(/\s+/u);
    if (!/^[\u4e00-\u9fff]{4,16}$/u.test(word) || [...word].length !== syllables.length || syllables.some(value => !/^[a-zv]+$/u.test(value))) continue;
    if (!records.has(word)) records.set(word, [syllables[0], syllables.at(-1)]);
  }
  console.log(`${source.repo}: +${records.size-before} words`);
}
const corrections = {人才济济:['ren','ji'],济济一堂:['ji','tang'],大腹便便:['da','pian'],便宜行事:['bian','shi'],便宜从事:['bian','shi'],叶公好龙:['she','long'],一丘之貉:['yi','he'],心广体胖:['xin','pan'],图穷匕见:['tu','xian'],短兵相接:['duan','jie']};
for (const [word, readings] of Object.entries(corrections)) if (records.has(word)) records.set(word, readings);
const lines = [...records.keys()].sort().map(word => `${word} ${records.get(word).join(' ')}`).join('\n');
const header = '// Generated from chinese-xinhua (MIT © 2018 PWXCOO) and chinese-dictionary (MIT © 2021 码谱).\n// See vendor/chinese-xinhua and vendor/chinese-dictionary for provenance and licenses.\n';
await writeFile(new URL('../src/data/idioms.js', import.meta.url), header + 'export const IDIOM_DATA = `' + lines + '`;\n');
console.log(`Generated ${records.size} dictionary entries`);
