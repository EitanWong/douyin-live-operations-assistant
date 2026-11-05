import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMediaClient,MEDIA_DEFAULTS} from '../../src/services/media.js';

test('静态画面在有效期内不重复购买识别，心跳仍刷新，切换模型不复用旧缓存',async()=>{
 let now=1800000000000,calls=0;
 const client=createMediaClient({now:()=>now,getKey:()=> 'key',request:d=>{calls++;d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'蓝色杯子'}}]})});}});
 const config={...MEDIA_DEFAULTS,videoEnabled:true,visionModel:'vision'};
 const sample=()=>({kind:'video',data:'data:image/jpeg;base64,anBlZw==',at:now,endedAt:now});
 assert.equal((await client(sample(),config)).text,'蓝色杯子');
 now+=12000;assert.equal(await client(sample(),config),null);assert.equal(calls,1);
 now+=18000;assert.ok(await client(sample(),config));assert.equal(calls,2);
 assert.ok(await client(sample(),{...config,visionModel:'another'}));assert.equal(calls,3);
});

test('失败不缓存画面，重复画面不能伪造新时间，音频不按原文或字节去重',async()=>{
 let now=1800000000000,calls=0,fail=true;
 const client=createMediaClient({now:()=>now,getKey:()=> 'key',request:d=>{calls++;d.onload({status:fail ? 500 : 200,responseText:JSON.stringify({choices:[{message:{content:'原话'}}]})});}});
 const config={...MEDIA_DEFAULTS,videoEnabled:true,audioEnabled:true,visionModel:'vision',audioModel:'audio'};
 const image={kind:'video',data:'data:image/jpeg;base64,anBlZw==',at:now};
 await assert.rejects(client(image,config));fail=false;assert.ok(await client(image,config));
 now+=1000;assert.equal(await client({...image,at:now},config),null);
 const audio={kind:'audio',data:'UklGRiQAAABXQVZF',at:now};
 assert.ok(await client(audio,config));assert.ok(await client(audio,config));assert.equal(calls,4);
});
