const fs = require('fs');
const p = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次97/移动迷宫.md';
let t = fs.readFileSync(p, 'utf8');
const more = `\n\n**【移动迷宫·终钉】**听门轨、护图室、握木矛、念名字。兽夜不关是实验，活着是反抗。出口外风大，仍要跑。\n`;
t = t.replace('\n## 阶位切入点', more + '\n## 阶位切入点');
fs.writeFileSync(p, t);
console.log(t.split('## 阶位切入点')[0].split('## 剧情')[1].replace(/\s/g,'').length);
