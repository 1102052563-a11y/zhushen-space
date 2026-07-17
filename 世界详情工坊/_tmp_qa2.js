const fs=require('fs'),path=require('path');
const base=String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出`;
const re=/【细节层·|【补强·|【切入细目·|【情境扩写·/;
const byBatch={};
for(let b=701;b<=800;b++){
  const d=path.join(base,'批次'+b);
  if(!fs.existsSync(d)) continue;
  let pad=0,n=0;
  for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.md'))){
    n++; const t=fs.readFileSync(path.join(d,f),'utf8');
    if(re.test(t)) pad++;
  }
  if(pad) byBatch[b]=pad+'/'+n;
}
console.log(Object.entries(byBatch).map(([b,v])=>b+':'+v).join(' | '));
// sample non-pad file from 730
const d730=path.join(base,'批次730');
const f=fs.readdirSync(d730).find(x=>x.endsWith('.md'));
const t=fs.readFileSync(path.join(d730,f),'utf8');
console.log('sample730', f, 'len', t.length, 'hasPad', re.test(t));
console.log(t.slice(0,400));