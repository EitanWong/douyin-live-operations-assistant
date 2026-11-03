import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechSegments} from '../../src/browser/speech-segments.js';
test('Silero uses the provided live audio, submits final bounded segments and never requests microphone',async()=>{
 let options,destroyed=0,started=0;const rows=[],stream={id:'live-track'},c=new AbortController();
 const handle=await createSpeechSegments({stream,signal:c.signal,onSpeech:r=>rows.push(r),assets:'chrome-extension://test/vad/'},{VAD:{new:async o=>{options=o;return {start:async()=>started++,destroy:async()=>destroyed++,pause:async()=>{}};}}});
 assert.equal(await options.getStream(),stream);assert.equal(options.redemptionMs,450);assert.equal(started,1);
 options.onSpeechEnd(new Float32Array(16000));assert.equal(rows[0].samples.length,16000);assert.equal(rows[0].endedAt-rows[0].at,1000);
 c.abort();await handle.stop();assert.equal(destroyed,1);options.onSpeechEnd(new Float32Array(16000));assert.equal(rows.length,1);
});
