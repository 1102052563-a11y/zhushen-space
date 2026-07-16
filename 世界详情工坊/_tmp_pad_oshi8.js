const fs = require('fs');
const p =
  'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次322/推得过火 (OshiRabu: Waifus Over Husbandos).md';
let t = fs.readFileSync(p, 'utf8');
t = t.replace(
  '请把日子过完整，再谈永远。',
  '请把日子过完整，再谈永远。永远从今晚的晚饭开始。'
);
fs.writeFileSync(p, t);
const plot = t.split('## 休闲切入点')[0].split('## 剧情')[1] || '';
console.log(plot.replace(/\s/g, '').length);
