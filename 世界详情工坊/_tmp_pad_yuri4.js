const fs = require('fs');
const p =
  'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次321/屋上的百合灵 (Kindred Spirits on the Roof).md';
let t = fs.readFileSync(p, 'utf8');
t = t.replace(
  '把害怕变少的过程写细，字数与质量会一起够。',
  '把害怕变少的过程写细，字数与质量会一起够。屋上的风会证明：喜欢可以被安放，也可以被祝福。'
);
fs.writeFileSync(p, t);
const plot = t.split('## 休闲切入点')[0].split('## 剧情')[1] || '';
console.log(plot.replace(/\s/g, '').length);
