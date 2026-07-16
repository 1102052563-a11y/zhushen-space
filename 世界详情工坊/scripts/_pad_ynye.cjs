const fs = require('fs');
let t = fs.readFileSync('产出/批次05/一念永恒.md', 'utf8');
const more = `**【收束句】**
一念永恒的世界奖励算计与存活，惩罚无后手的热血；落陈夜里，结丹是天，不死是缝，契约者能做的是把缝撕宽——而不是假装自己是天。
`;
t = t.replace('## 阶位切入点', more + '\n\n## 阶位切入点');
fs.writeFileSync('产出/批次05/一念永恒.md', t, 'utf8');
const plot = t.split('## 阶位切入点')[0].replace(/\s/g, '').length;
console.log('plot', plot);
