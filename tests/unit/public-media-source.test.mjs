import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePublicMediaSource} from '../../src/services/public-media-source.js';
const now=1800000000000;
const source={workId:'70',author:'author-sec',authorUid:'2',url:'https://v1.example.douyinvod.com/file?__vid=70',durationMs:8400,observedAt:now,expiresAt:now+300000};
test('浏览器下载描述在边界解析：只允许同作品、稳定身份、短期公开 CDN，附加字段不透传',()=>{
 const scope={workId:'70',author:'author-sec',subject:'uid:2',now};assert.deepEqual(parsePublicMediaSource(source,scope),source);
 for(const change of [{authorUid:'3'},{durationMs:Infinity},{expiresAt:now+300001},{observedAt:now+1},{token:'extra'},
  {url:'https://v1.douyinvod.com.evil.test/file?__vid=70'},{url:'https://127.0.0.1/file?__vid=70'},
  {url:'https://user:pass@v1.douyinvod.com/file?__vid=70'},{url:'https://v1.douyinvod.com/file?__vid=70&__vid=71'},
  {url:'https://v1.douyinvod.com/file?__vid=70&__vid='},{url:'https://v1.douyinvod.com:444/file?__vid=70'}])assert.equal(parsePublicMediaSource({...source,...change},scope),null,JSON.stringify(change));
 assert.equal(parsePublicMediaSource(source,{...scope,now:now+300000}),null);
 assert.equal(parsePublicMediaSource(source,{...scope,epoch:now+1}),null,'遗忘前取得的地址不承接新的画像版本');
});
