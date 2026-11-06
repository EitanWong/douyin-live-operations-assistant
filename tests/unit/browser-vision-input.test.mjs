import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Qwen2VLImageProcessor,RawImage} from '@huggingface/transformers';
import {configureBrowserVision} from '../../src/ai/vision-input.js';

test('Qwen浏览器视觉输入按模型均值归一化并限制采样像素预算',async()=>{
 const image_processor=new Qwen2VLImageProcessor({size:{shortest_edge:65536,longest_edge:16777216},patch_size:16,merge_size:2,temporal_patch_size:2,image_mean:[.5,.5,.5],image_std:[.5,.5,.5]});
 configureBrowserVision({image_processor});
 const result=await image_processor(new RawImage(new Uint8ClampedArray(1024*512*3),1024,512,3));
 assert.equal(result.pixel_values.data[0],-1,'黑色输入应归一化到-1，避免颜色偏粉');
 const [,height,width]=result.image_grid_thw.tolist()[0].map(Number);
 assert.ok(height*width*16*16<=262144,'实际缩放使用像素上限，不能只改size外观');
});
