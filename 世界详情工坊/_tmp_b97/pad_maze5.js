const fs = require('fs');
const p = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次97/移动迷宫.md';
let t = fs.readFileSync(p, 'utf8');
const more = `\n\n**【移动迷宫·钉】**跑者交线、守卫听门、农夫护种、图室不死。兽夜阵心放抄本与幼弟，阵外放骄傲。门若说谎，矛就是法律。活过黎明，再谈出口。WICKED要数据，你们要名字。把名字念准，把路线画直，把同伴拉回日落之前。\n`;
t = t.replace('\n## 阶位切入点', more + '\n## 阶位切入点');
fs.writeFileSync(p, t);
console.log(t.split('## 阶位切入点')[0].split('## 剧情')[1].replace(/\s/g,'').length);
