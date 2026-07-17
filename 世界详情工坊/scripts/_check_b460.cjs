const fs = require('fs');
const path = require('path');
const dir = String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出\批次460`;
const MIN_PLOT = 6000, MIN_ENTRY = 1500;
const REQ = ['【作品来源】','【世界定位】','【世界观 · 舞台设定】','【地理 · 生活舞台】','【故事主线 · 情感线】','【可攻略角色 / 主要人物】','【人际关系网 / 社团势力】','【情感事件 · 名场面】','【隐藏剧情 · 真结局 · 伏笔】','【氛围基调 · 雷区】'];
function charCount(s){return (s||'').replace(/\s/g,'').length}
function split(text){
  const re=/^##\s+(剧情|阶位切入点|休闲切入点|来源)\s*$/gm;
  const marks=[]; let m;
  while((m=re.exec(text))!==null) marks.push({name:m[1],start:m.index,bodyStart:m.index+m[0].length});
  const out={};
  for(let i=0;i<marks.length;i++){
    const end=i+1<marks.length?marks[i+1].start:text.length;
    out[marks[i].name]=text.slice(marks[i].bodyStart,end).trim();
  }
  return out;
}
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.md'))){
  const t=fs.readFileSync(path.join(dir,f),'utf8');
  const sec=split(t);
  const plot=sec['剧情']||'', entry=sec['休闲切入点']||'';
  const errs=[];
  if(!sec['剧情']) errs.push('缺剧情');
  if(!sec['休闲切入点']) errs.push('缺休闲切入点');
  if(charCount(plot)<MIN_PLOT) errs.push(`剧情${charCount(plot)}<${MIN_PLOT}`);
  if(charCount(entry)<MIN_ENTRY) errs.push(`切入${charCount(entry)}<${MIN_ENTRY}`);
  for(const r of REQ) if(!plot.includes(r)) errs.push('缺'+r);
  if(/力量体系|战力|阶位|巅峰战力/.test(plot+entry)) errs.push('含战力措辞');
  if(!/<!--meta lib=休闲/.test(t)) errs.push('meta错');
  const src=(sec['来源']||'').split('\n').filter(l=>/- \[/.test(l));
  if(src.length<3) errs.push('来源<'+src.length);
  console.log(f+'\t剧情='+charCount(plot)+'\t切入='+charCount(entry)+'\t'+(errs.length?'FAIL '+errs.join('|'):'PASS'));
}
