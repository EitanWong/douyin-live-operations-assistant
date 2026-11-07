import {execFileSync} from 'node:child_process';
import {mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Independent from stream perception: no FFmpeg, pip, model or API key required.
const root=fileURLToPath(new URL('../',import.meta.url));
const args=Object.fromEntries(process.argv.slice(2).filter(v=>v.includes('=')).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
if(!['darwin','linux'].includes(process.platform))throw Error('本地数据组件自动注册目前支持 macOS / Linux');
const folder=join(homedir(),'.local/share/douyin-live-assistant/data-host');
const manifests=process.platform==='darwin'?join(homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts'):join(homedir(),'.config/google-chrome/NativeMessagingHosts');
const manifest=join(manifests,'com.douyin_live_assistant.data.json');
if(process.argv.includes('--uninstall')){
 await rm(manifest,{force:true});await rm(folder,{recursive:true,force:true});
 console.log('本地数据组件已卸载，数据库保留在 ~/.local/share/douyin-live-assistant/data/');
}else{
 const id=args['--extension-id'];if(!/^[a-p]{32}$/.test(id || ''))throw Error('请传入 --extension-id=chrome://extensions 中的扩展ID');
 const python=execFileSync(args['--python'] || 'python3',['-c','import sys,sqlite3; assert sys.version_info >= (3,11); print(sys.executable)'],{encoding:'utf8'}).trim();
 await mkdir(folder,{recursive:true,mode:0o700});
 for(const name of ['data_host.py','data_store.py','data_models.py','data_location.py','knowledge_index.py','public_media_jobs.py','public_media_source.py','public_media_frames.py','media_process.py','protocol.py'])await copyFile(join(root,'native',name),join(folder,name));
 const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
 const launcher=join(folder,'launch');
 await writeFile(launcher,`#!/bin/sh\nexec ${quote(python)} ${quote(join(folder,'data_host.py'))}\n`,{mode:0o700});
 await mkdir(manifests,{recursive:true});
 await writeFile(manifest,JSON.stringify({name:'com.douyin_live_assistant.data',description:'Local live data warehouse',path:launcher,type:'stdio',allowed_origins:[`chrome-extension://${id}/`]},null,2),{mode:0o600});
 const host=join(folder,'data_host.py');
 if(args['--directory'])execFileSync(python,[host,'location','--directory',args['--directory']],{stdio:'inherit'});
 const state=JSON.parse(execFileSync(python,[host,'status'],{encoding:'utf8'}));
 console.log(`本地数据组件已注册。数据库：${state.database}\n在扩展图标菜单启用本地归档；不需要云服务。`);
}
