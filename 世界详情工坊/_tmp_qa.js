const fs=require('fs'),path=require('path');
const base=String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出`;
const badRe=/【(扩写|补密|加厚|再叙|补段|扩段|细目循环)/;
let bad=0, files=0;
for(let b=741;b<=800;b++){
  const d=path.join(base,'批次'+b);
  if(!fs.existsSync(d)) continue;
  for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.md'))){
    files++;
    const t=fs.readFileSync(path.join(d,f),'utf8');
    if(badRe.test(t) || (t.match(/【细节层·/g)||[]).length>15) bad++;
  }
}
console.log('files',files,'suspect_pad_style',bad);