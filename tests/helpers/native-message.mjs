import {spawn} from 'node:child_process';

export function nativeMessage(script,args,message){
 const child=spawn('python3',[script,...args]),stdout=[],stderr=[];
 const input=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(input.length);
 const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
 child.stdout.on('data',chunk=>stdout.push(chunk));child.stderr.on('data',chunk=>stderr.push(chunk));
 const result=new Promise((resolve,reject)=>{
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',code=>{clearTimeout(timer);if(code)return reject(Error(Buffer.concat(stderr).toString() || `Native host exited ${code}`));
   try{const output=Buffer.concat(stdout),size=output.readUInt32LE(0);if(size+4!==output.length)throw Error('Native response framing mismatch');resolve(JSON.parse(output.subarray(4).toString()));}catch(error){reject(error);}
  });
 });child.stdin.end(Buffer.concat([header,input]));return result;
}
