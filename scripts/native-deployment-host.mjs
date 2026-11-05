import {readFile} from 'node:fs/promises';
import {nativePaths} from './lib/native-install.mjs';
import {createNativeDeployment} from './lib/native-deployment.mjs';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
if(process.argv[3]!==`chrome-extension://${config.args['--extension-id']}/`)process.exit(1);
const deployment=createNativeDeployment({...nativePaths(config),config});
let buffer=Buffer.alloc(0),used=false;
process.stdin.on('data',chunk=>{
 if(used)return;buffer=Buffer.concat([buffer,chunk]);
 if(buffer.length<4)return;const size=buffer.readUInt32LE();if(size<1 || size>1000){process.exit(1);return;}
 if(buffer.length<size+4)return;used=true;
 void (async()=>{try{const message=JSON.parse(buffer.subarray(4,4+size));if(!['start','status'].includes(message.action))throw new Error('INVALID');
  return {value:await (message.action==='start' ? deployment.start() : deployment.status({resume:true}))};
 }catch{return {error:'本地安装代理暂不可用，请检查安装入口'};}})().then(value=>{
  const data=Buffer.from(JSON.stringify(value)),header=Buffer.alloc(4);header.writeUInt32LE(data.length);process.stdout.write(Buffer.concat([header,data]),()=>process.exit(0));
 });
});
