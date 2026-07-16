const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '_b239_densify.cjs');
let s = fs.readFileSync(p, 'utf8');
s = s.replaceAll("i <= 32; i++) {\n    blocks.push(line(\n      '沃尔特进化·加冕倒计时'", "i <= 50; i++) {\n    blocks.push(line(\n      '沃尔特进化·加冕倒计时'");
s = s.replaceAll("i <= 32; i++) {\n    blocks.push(line(\n      '大门开启·门缘小时志'", "i <= 50; i++) {\n    blocks.push(line(\n      '大门开启·门缘小时志'");
s = s.replaceAll("i <= 32; i++) {\n    blocks.push(line(\n      '英格丽德深渊化·仪式节拍'", "i <= 50; i++) {\n    blocks.push(line(\n      '英格丽德深渊化·仪式节拍'");
s = s.replace("'T-' + (72 - i) + 'h：", "'T-' + (90 - i) + 'h：");
// also bump goddess logs
s = s.replaceAll("i <= 32; i++) {\n    blocks.push(line(\n      '女神堕落·信仰战场日志'", "i <= 40; i++) {\n    blocks.push(line(\n      '女神堕落·信仰战场日志'");
fs.writeFileSync(p, s);
delete require.cache[require.resolve('./_b239_densify.cjs')];
const d = require('./_b239_densify.cjs');
for (const [n, f] of Object.entries(d)) {
  const arr = f();
  console.log(n, arr.length, arr.join('').replace(/\s/g, '').length);
}
