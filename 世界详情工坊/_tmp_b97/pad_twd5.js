const fs = require('fs');
const p = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次97/行尸走肉.md';
let t = fs.readFileSync(p, 'utf8');
// insert before 阶位切入点 a tiny unique block
const pad = `\n\n**【行尸·钉】**门后先听三十秒：拖步、哭声、枪栓。听完再开。活下去。\n`;
const marker = '\n## 阶位切入点';
t = t.replace(marker, pad + marker);
fs.writeFileSync(p, t);
const plot = t.split('## 阶位切入点')[0];
// exclude title/meta? validate uses sections['剧情'] which is after ## 剧情
const m = plot.match(/## 剧情\s*([\s\S]*)/);
const body = m ? m[1] : plot;
console.log('plot body', body.replace(/\s/g,'').length);
