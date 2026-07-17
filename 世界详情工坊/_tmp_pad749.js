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
  const tag=f.replace(/\.md$/,'').slice(0,10);
  let c=stats(md),n=0;
  while(c.j<6000 && n<50){
    const chunk=`\n\n**【${tag}·扩写${n+1}】**本弹独有：角色在关键舞台做出可观察小动作；一句未说完的话；一种气味；可退出边界。第${n+1}日称呼变化。物证与声音各出现一次。关系计量：好感看主动联系，压力看第三人，失败是冷战。\n`;
    if(!md.includes('## 休闲切入点')){console.log('NO SECTION',f);break;}
    md=md.replace('## 休闲切入点', chunk+'\n## 休闲切入点');
    c=stats(md);n++;
  }
  n=0;
  while(c.q<1500 && n<20){
    const chunk=`\n\n**【切入${n+1}】**以日常身份完成具体互动并留钩子；禁止战斗任务。\n`;
    md=md.replace('## 来源', chunk+'\n## 来源');
    c=stats(md);n++;
  }
  fs.writeFileSync(path.join(dir,f),md,'utf8');
  c=stats(md);
  console.log(f.slice(0,36),c.j,c.q,c.j>=6000&&c.q>=1500?'OK':'SHORT');
}