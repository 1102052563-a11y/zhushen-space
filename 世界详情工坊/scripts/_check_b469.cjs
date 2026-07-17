const fs = require('fs');
const path = require('path');
const dir = String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\产出\批次469`;
const MIN_PLOT = 6000, MIN_ENTRY = 1500;
const REQ = ['【作品来源】','【世界定位】','【世界观 · 舞台设定】','【地理 · 生活舞台】','【故事主线 · 情感线】','【可攻略角色 / 主要人物】','【人际关系网 / 社团势力】','【情感事件 · 名场面】','【隐藏剧情 · 真结局 · 伏笔】','【氛围基调 · 雷区】'];
const BANNED = ['家里没人会注意','本周扩招','一起叠巾','第一天把名牌','表摆反','永远准时','拖鞋摆在最角落','欢迎喊得很亮','力量体系','战力','阶位','巅峰战力','${props','见上文对应线','心结与攻略以同意与边界为核心'];
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
const allNames=[];
let allPass=true;
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.md')).sort()){
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
  for(const b of BANNED) if(t.includes(b)) errs.push('禁句:'+b);
  const src=(sec['来源']||'').split('\n').filter(l=>/- \[/.test(l));
  if(src.length<3) errs.push('来源<'+src.length);
  // names
  const nameRe=/\*\*([^*（]+)（/g; let nm;
  while((nm=nameRe.exec(plot))!==null){ if(!nm[1].includes('主角')&&!nm[1].includes('重要配角')) allNames.push([f,nm[1].trim()]); }
  const status=errs.length?'FAIL '+errs.join('|'):'PASS';
  if(errs.length) allPass=false;
  console.log(f+'\t剧情='+charCount(plot)+'\t切入='+charCount(entry)+'\t'+status);
}
// cross-file name dups
const names=allNames.map(x=>x[1]);
const dups=[...new Set(names.filter((n,i)=>names.indexOf(n)!==i))];
console.log('unique_names_scanned='+new Set(names).size);
if(dups.length){ console.log('NAME_DUP', dups.join(',')); allPass=false; }
else console.log('NAME_DUP none');
console.log(allPass?'ALL PASS':'SOME FAIL');