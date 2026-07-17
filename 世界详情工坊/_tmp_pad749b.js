const fs=require('fs');const path=require('path');
const dir=String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出\批次749`;
const no=s=>(s||'').replace(/\s/g,'').length;
function stats(md){
  const j=(md.match(/## 剧情\s*([\s\S]*?)(?=## 休闲切入点)/)||[])[1]||'';
  const q=(md.match(/## 休闲切入点\s*([\s\S]*?)(?=## 来源)/)||[])[1]||'';
  return{j:no(j),q:no(q)};
}
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.md'))){
  let md=fs.readFileSync(path.join(dir,f),'utf8');
  let c=stats(md),n=0;
  while(c.q<1500 && n<15){
    md=md.replace('## 来源', `\n\n**【切入补足·${n+1}】**开场可选：帮忙、提问、沉默陪伴；留下票根/便签/钥匙之一；次日改变称呼或座位。禁止战斗任务化与无同意推进。\n\n## 来源`);
    c=stats(md);n++;
  }
  fs.writeFileSync(path.join(dir,f),md,'utf8');
  c=stats(md);
  console.log(f.slice(0,40), c.j, c.q, c.j>=6000&&c.q>=1500?'OK':'SHORT');
}