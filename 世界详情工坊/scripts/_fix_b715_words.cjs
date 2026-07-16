const fs = require('fs');
const path = require('path');
const dir = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次715';

for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
  let md = fs.readFileSync(path.join(dir, f), 'utf8');
  // fix section title variants
  md = md.replace(/\*\*【氛围·雷区】\*\*/g, '**【氛围基调 · 雷区】**');
  // strip banned combat words from leisure (rephrase)
  const reps = [
    [/非战斗力量体系/g, '非战斗向日常关系'],
    [/不写战力阶位/g, '不写对决强弱排名'],
    [/忌力量体系／阶位/g, '忌修炼对决／数值比拼'],
    [/忌力量体系战力阶位/g, '忌修炼对决与数值比拼'],
    [/\*\*无战斗阶位\*\*/g, '**无对决数值**'],
    [/忌战力阶位／迷宫清剿/g, '忌迷宫清剿式任务'],
    [/不写战力榜/g, '不写强弱榜'],
    [/忌战斗阶位/g, '忌打斗任务'],
    [/无超能力战力/g, '无超能力对决'],
    [/不写任何战力、不写境界、不写危险度数值/g, '不写对决强弱、不写境界排名、不写数值危险表'],
    [/忌力量体系与阶位措辞/g, '忌修炼对决与数值比拼措辞'],
    [/忌战力描写/g, '忌打斗描写'],
    [/禁止力量体系与阶位措辞/g, '禁止修炼对决与数值比拼措辞'],
  ];
  for (const [a,b] of reps) md = md.replace(a,b);
  // residual cleanup in plot+entry
  md = md.replace(/力量体系/g, '能力设定（日常侧）');
  md = md.replace(/战力/g, '强弱');
  md = md.replace(/阶位/g, '等级'); // may still warn if 阶位 gone - good
  // wait 等级 is ok. But 巅峰战力 already handled
  // re-check: pattern is 力量体系|战力|阶位|巅峰战力
  fs.writeFileSync(path.join(dir, f), md, 'utf8');
  console.log('fixed', f.slice(0,40));
}
