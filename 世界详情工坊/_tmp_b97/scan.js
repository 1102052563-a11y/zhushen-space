const fs=require('fs');
const path=require('path');
const root='C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出';
const hits=[];
function walk(d){
  for(const n of fs.readdirSync(d)){
    const p=path.join(d,n);
    const st=fs.statSync(p);
    if(st.isDirectory()) walk(p);
    else if(n.endsWith('.md')){
      const t=fs.readFileSync(p,'utf8');
      if(t.includes('sobqg.com') && !t.includes('跨媒介流行作品')) hits.push({p:p.replace(root,''), n});
    }
  }
}
walk(root);
console.log('hits',hits.length);
console.log(hits.slice(0,15));
// sample sources from one good file in batch 96 or nearby
const samples=['批次96/无职转生.md','批次93/大逃杀.md','批次97/SCP基金会·Site-19站点.md'];
for(const s of samples){
  const fp=path.join(root,s);
  if(!fs.existsSync(fp)) continue;
  const t=fs.readFileSync(fp,'utf8');
  const src=t.split('## 来源')[1]||'';
  console.log('===',s); console.log(src.slice(0,600));
}
