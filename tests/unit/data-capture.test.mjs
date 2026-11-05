import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDataCapture} from '../../extension/data-capture.js';

test('capture retains retry identity and full protocol chunks before MAIN acknowledgement',async()=>{
 const writes=[];let now=1000,fail=true;
 const archive=createDataCapture(async m=>{writes.push(structuredClone(m));if(fail)throw Error('disk full');},{now:()=>now});
 const raw='A'.repeat(640000),batch={batchId:1,priority:[{type:'pk-score',selfScore:3}],events:[{type:'chat',text:'观众原话'}],captures:[{rawBase64:raw,rawBytes:480000}],status:{connected:true,bridgeGaps:2}};
 await assert.rejects(archive(batch),/disk/);fail=false;now=2000;await archive(batch);
 assert.deepEqual(writes[0],writes[1]);
 const records=writes.slice(1).flatMap(m=>m.records),frames=records.filter(r=>r.kind==='protocol');
 assert.equal(frames.map(r=>r.payload.rawBase64).join(''),raw);
 assert.equal(records.find(r=>r.kind==='coverage').payload.gaps,2);
 assert.equal(records.filter(r=>r.kind==='event').length,2);
});

test('idle coverage pulses advance their identity while failed pulses retain it',async()=>{
 let now=10000,fail=false;const writes=[];
 const archive=createDataCapture(async m=>{writes.push(structuredClone(m));if(fail)throw Error('full');},{now:()=>now});
 await archive({batchId:null,status:{connected:true}});now+=6000;fail=true;
 await assert.rejects(archive({batchId:null,status:{connected:false}}));now+=6000;fail=false;
 await archive({batchId:null,status:{connected:false}});
 assert.notEqual(writes[0].records[0].id,writes[1].records[0].id);
 assert.deepEqual(writes[1],writes[2]);
});

test('a retried MAIN batch freezes its first coverage and payload instead of reusing an ID for changed status',async()=>{
 let fail=true;const writes=[];
 const archive=createDataCapture(async m=>{writes.push(structuredClone(m));if(fail)throw Error('lost response');},{now:()=>10000});
 const batch={batchId:1,events:[{type:'chat',text:'原话'}],status:{bridgeGaps:1}};
 await assert.rejects(archive(batch));batch.events[0].text='调用方后来修改';batch.status.bridgeGaps=2;fail=false;
 await archive(batch);assert.deepEqual(writes[0],writes[1]);
});
