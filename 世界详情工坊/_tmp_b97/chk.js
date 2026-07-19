const fs = require('fs');
const p = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次97/移动迷宫.md';
let t = fs.readFileSync(p, 'utf8');
console.log('跨媒介 idx', t.indexOf('跨媒介'));
// show context
const i = t.indexOf('跨媒介');
if (i>=0) console.log(t.slice(i-80, i+80));
