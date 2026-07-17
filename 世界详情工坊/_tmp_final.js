const fs=require('fs'),path=require('path');
const base=String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出`;
const re=/【细节层·|【补强·剧情层|跨世界通用/;
let total=0, pad=0, okFamous=0;
const famous=['Kanon','AIR','Planetarian','月姫','STEINS;GATE','ひぐらしのなく頃に','WHITE ALBUM2','薄桜鬼','図書室ノ彼女'];
for(let b=701;b<=800;b++){
  const d=path.join(base,'批次'+b);
  if(!fs.existsSync(d)) continue;
  for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.md'))){
    total++;
    const t=fs.readFileSync(path.join(d,f),'utf8');
    if(re.test(t)) pad++;
    if(famous.some(x=>f.includes(x)||t.includes('# '+x))) {
      if(!re.test(t) && t.includes('## 来源')) okFamous++;
    }
  }
}
console.log(JSON.stringify({total,padStyle:pad,nonPad:total-pad,famousTouched:okFamous},null,0));