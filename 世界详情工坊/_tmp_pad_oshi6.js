const fs = require('fs');
const p =
  'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次322/推得过火 (OshiRabu: Waifus Over Husbandos).md';
let t = fs.readFileSync(p, 'utf8');
t = t.replace(
  '命运不必靠概率，靠每天回来的那双鞋。',
  '命运不必靠概率，靠每天回来的那双鞋。玄关的第二双拖鞋，是比婚戒更早的誓约；客厅的第二副手柄，是比誓词更早的誓言。把这些物件写进正文，读者就会相信：她们真的在过同一天。推得过火，过的是日子，不是口号。'
);
fs.writeFileSync(p, t);
const plot = t.split('## 休闲切入点')[0].split('## 剧情')[1] || '';
console.log(plot.replace(/\s/g, '').length);
