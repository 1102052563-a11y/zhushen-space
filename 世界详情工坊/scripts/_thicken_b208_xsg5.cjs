const fs = require('fs');
const p = '产出/批次208/新三国.md';
let t = fs.readFileSync(p, 'utf8');
const more = `
**【终局余波】**
司马懿死后，司马师司马昭司马炎线在剧中已埋伏笔；蜀汉姜维北伐与吴国江东守成仍在继续，但「天下归一」的势能不可逆。契约者可在终局前改变一城一将之命运，难以永久阻止晋代魏。写结局须留「气数」与「人心」双重账本。
`;
if (!t.includes('终局余波')) {
  t = t.replace('**【叙事基调 · 雷区】**', more + '\n**【叙事基调 · 雷区】**');
}
fs.writeFileSync(p, t);
const plot = t.split('## 剧情')[1].split('## 阶位切入点')[0].replace(/\s/g, '');
console.log('plot', plot.length);
