import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {nativeMessage} from '../helpers/native-message.mjs';

test('真实原生宿主接受公开视频能力探测并在 stdin 关闭后正常退出，不加载模型',async()=>{
 const value=await nativeMessage(fileURLToPath(new URL('../../native/host.py',import.meta.url)),[],{id:'capability',type:'public-media',action:'capabilities'});
 assert.deepEqual(value,{id:'capability',value:{publicMedia:2,modelLease:1}});
});
