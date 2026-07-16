const fs = require('fs');
const p = '产出/批次208/新三国.md';
let t = fs.readFileSync(p, 'utf8');
t = t.replace('**【叙事基调 · 雷区】**', '**【锚点确认】**卡片默认锚在赤壁前夜柴桑—江面轴。\n\n**【叙事基调 · 雷区】**');
fs.writeFileSync(p, t);
const plot = t.split('## 剧情')[1].split('## 阶位切入点')[0].replace(/\s/g, '');
console.log('plot', plot.length);
