import {readFile,writeFile,rename,rm,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {INDEX_PATH,createIndex,serializeIndex,checkIndex,findSymbols,impact} from './lib/agent-index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),path=resolve(root,INDEX_PATH);
const [command,...args]=process.argv.slice(2);
try {
  if(command==='build'){
    const index=await createIndex(root),temporary=`${path}.${randomUUID()}.tmp`;
    await mkdir(dirname(path),{recursive:true});
    try {await writeFile(temporary,serializeIndex(index));await rename(temporary,path);}
    finally {await rm(temporary,{force:true});}
    console.log(`已生成 ${INDEX_PATH}：${index.files.length} 个模块，${index.files.reduce((sum,file)=>sum+file.symbols.length,0)} 个顶层符号/类成员。`);
  } else if(command==='check'){
    if(!await checkIndex(root))throw new Error('Agent 索引缺失或过期；运行 npm run agent:index 并提交生成差异。');
    console.log('Agent 索引与源码一致。');
  } else if(command==='find' || command==='impact'){
    if(!args.length)throw new Error(`${command} 需要关键词或项目内文件路径。`);
    // Query the saved snapshot without rebuilding: impact can inspect a just
    // deleted file. The check command is the explicit freshness gate.
    const index=JSON.parse(await readFile(path,'utf8'));
    if(index.schemaVersion!==1)throw new Error('索引版本不支持；运行 npm run agent:index。');
    if(command==='find'){
      const hits=findSymbols(index,args.join(' '));console.log(JSON.stringify({total:hits.length,hits:hits.slice(0,60),omitted:Math.max(0,hits.length-60)},null,2));
    } else {
      const paths=args.map(path=>relative(root,resolve(root,path)).split(sep).join('/'));
      console.log(JSON.stringify(impact(index,paths),null,2));
    }
  } else throw new Error('用法：npm run agent:index | agent:check | agent:find -- 关键词 | agent:impact -- 源文件 [源文件…]');
} catch(error){console.error(error.message);process.exitCode=1;}
