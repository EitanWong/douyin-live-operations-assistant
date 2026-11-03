import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
if(!process.env.QWEN_API_KEY || !process.env.QWEN_WORKSPACE_ID){console.error('请通过环境变量设置 QWEN_API_KEY、QWEN_WORKSPACE_ID，密钥不要写入配置或报告。');process.exit(1);}
const output=resolve(process.env.AGENT_EVAL_OUTPUT || 'output/agent-evaluation');
await mkdir(output,{recursive:true});
await writeFile(`${output}/cases.jsonl`,'');
const args=['eval','-c',new URL('./promptfoo.config.mjs',import.meta.url).pathname,'--no-cache','--no-share','--no-write','--no-progress-bar','--no-table','--max-concurrency','1','-o',`${output}/results.json`,`${output}/results.html`,...process.argv.slice(2)];
const pinned=process.env.PROMPTFOO_BIN;
const child=spawn(pinned ? process.execPath : 'npm',pinned ? [pinned,...args] : ['exec','--yes','--package=promptfoo@0.125.1','--','promptfoo',...args],{
 stdio:'inherit',env:{...process.env,PROMPTFOO_DISABLE_TELEMETRY:'1',PROMPTFOO_CONFIG_DIR:`${output}/.promptfoo`,PROMPTFOO_DISABLE_UPDATE_CHECK:'1'}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code ?? 1;});
