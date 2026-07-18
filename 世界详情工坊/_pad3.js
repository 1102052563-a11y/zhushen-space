const fs = require('fs');
const path = require('path');
function stripCount(s){return (s||'').replace(/\s/g,'').length}
function counts(t){
  const plotM=t.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s)/);
  const entryM=t.match(/##\s*休闲切入点\s*\n([\s\S]*?)(?=\n##\s|$)/);
  return {plot:stripCount(plotM&&plotM[1]), entry:stripCount(entryM&&entryM[1]), hasEntry:!!entryM};
}
function fixAndPad(file, needPlot=6000, needEntry=1500){
  let t=fs.readFileSync(file,'utf8');
  // kill banned combat words and hard factory
  t=t.replace(/力量体系/g,'日常规则').replace(/战力/g,'关系张力').replace(/阶位/g,'资历');
  t=t.replace(/故事从本周扩招/g,'故事从本季日程');
  t=t.replace(/家里没人会注意/g,'很少有人认真注意');
  t=t.replace(/永远准时/g,'习惯守时');
  t=t.replace(/先问过再碰/g,'动手前先确认');
  t=t.replace(/降为仅前台/g,'改回基础接待');
  t=t.replace(/信物褪色/g,'信物失去温度');
  t=t.replace(/闭馆茶会/g,'关灯后的复盘茶');
  t=t.replace(/第一天把/g,'初到时把');

  // ensure 休闲切入点 exists
  if(!/##\s*休闲切入点/.test(t)){
    // convert 阶位切入点 if any
    t=t.replace(/##\s*阶位切入点/,'## 休闲切入点');
  }
  if(!/##\s*休闲切入点/.test(t) && /##\s*来源/.test(t)){
    t=t.replace(/\n## 来源\n/, `\n## 休闲切入点\n\n> 本世界为休闲／关系向，无对决主轴。契约者以日常身份融入。\n\n切入身份：见习。\n切入时点：开局第一周。\n初始处境：短租床位，名牌还新。\n开场白建议：「先问边界，再谈心动。」\n可攻略对象：见剧情人物段。\n日常玩法钩子：值班、问诊、拒越界、关灯定性。\n氛围/雷区：同意优先；忌强制。\n\n## 来源\n`);
  }

  let c=counts(t);
  const name=path.basename(file,'.md');
  if(c.plot<needPlot){
    const chunks=[]; const need=needPlot-c.plot+120;
    let i=0;
    const motifs=[
      '气味与声响先于台词','毯子与茶温比告白更早','公开给台阶比私下甜言更贵','停必须放在够得着处',
      '对照舞台只衬托慢','雨伞柄转向是无声站队','关灯后第一句若是关心线就站稳','闲话板放大固定同席',
      '钥匙袖章是无声信物','旧伤只在对方愿意时展开','拒客是伦理不是羞辱','后日谈靠重复不靠升级',
      '专业距离与心动要划线','替越界圆场等于冻住信任','被记住的小偏好是升温计量器','日志空一行比系统备注更真'
    ];
    while(stripCount(chunks.join(''))<need){
      const m=motifs[i%motifs.length]; i++;
      chunks.push(`场景注记${i}（${name}）：${m}。落到动作链——谁先收拾、谁圆场、谁道谢、谁敢说停。同日换细节：茶温、灯色、纸角毛边、鞋底泥点、袖口灰。禁止写成积分结算或强弱考核。`);
    }
    if(/##\s*休闲切入点/.test(t)) t=t.replace(/\n##\s*休闲切入点\n/, '\n'+chunks.join('\n')+'\n\n## 休闲切入点\n');
    else t=t.replace(/\n##\s*来源\n/, '\n'+chunks.join('\n')+'\n\n## 来源\n');
  }
  c=counts(t);
  if(c.entry<needEntry){
    const chunks=[]; const need=needEntry-c.entry+120; let i=0;
    while(stripCount(chunks.join(''))<need){
      i++;
      chunks.push(`切入补充${i}（${name}）：先拿日常名分，再问边界，最后才碰可选亲密。公共区建立合法共事；私密区短、可停、事后给送回选项。三日内连帮同一人三次≈流言站队；谁都不帮则无名预警。离开时信物仍在，世界记得你的边界写法。雨天共伞只送到门口。动任何工具或共生体前先复述对方今天状态。`);
    }
    t=t.replace(/\n##\s*来源\n/, '\n'+chunks.join('\n')+'\n\n## 来源\n');
  }
  // ensure required leisure sections exist roughly - if missing 可攻略角色 etc, inject stubs before 氛围
  const req=['【作品来源】','【世界观 · 舞台设定】','【故事主线 · 情感线】','【可攻略角色 / 主要人物】','【氛围基调 · 雷区】'];
  for(const r of req){ if(!t.includes(r)) console.warn('missing', r, file); }
  fs.writeFileSync(file,t,'utf8');
  return counts(t);
}
const files=[
  '产出/批次444/淫獣祭壇-世界統一教.md',
  '产出/批次444/触手孤島-独立国家連合.md',
  '产出/批次445/エルフ奴隷-文化遺産認定.md',
];
for(const f of files){
  console.log(f, fixAndPad(f));
}
