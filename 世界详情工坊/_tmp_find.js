const fs=require('fs');
const p='C:/Users/Administrator/Desktop/前端卡/files/世界书/世界详情库·休闲.json';
const raw=fs.readFileSync(p,'utf8');
const idx=raw.indexOf('天结神缘');
console.log('idx', idx);
if(idx>=0) console.log(raw.slice(Math.max(0,idx-100), idx+1200));
const idx2=raw.indexOf('天结');
console.log('idx2', idx2);
if(idx2>=0 && idx2!==idx) console.log(raw.slice(Math.max(0,idx2-50), idx2+400));
