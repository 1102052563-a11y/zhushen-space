const fs=require('fs'),path=require('path');
const base=String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出`;
const re=/【细节层·|【补强·|【切入细目·|【情境扩写·/;
const need=[];
for(let b=741;b<=800;b++){
  const d=path.join(base,'批次'+b);
  if(!fs.existsSync(d)) continue;
  for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.md'))){
    const t=fs.readFileSync(path.join(d,f),'utf8');
    if(re.test(t)) need.push({b,f,len:t.length});
  }
}
console.log('need rewrite', need.length);
// group by batch
const g={};
for(const x of need){g[x.b]=(g[x.b]||0)+1}
console.log(Object.entries(g).filter(([b,n])=>n>=4).map(([b,n])=>b+':'+n).join(' '));
// famous ones in 771-800
for(const b of [771,772,773,774,780,781,793,800]){
  const d=path.join(base,'批次'+b);
  console.log('\n=='+b+'==');
  for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.md'))){
    const t=fs.readFileSync(path.join(d,f),'utf8');
    console.log((re.test(t)?'PAD':'OK '), f.slice(0,50), 'L'+t.length);
  }
}