const fs = require('fs');
const p = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次97/移动迷宫.md';
let t = fs.readFileSync(p, 'utf8');
const more = `\n\n**【移动迷宫·再钉】**盒子每月升起，像不祥的节日。新人眨眼，旧人盘算床位。迷宫走廊在夜间改写，像有人用石笔涂掉你们的命。鬼火兽的液压关节在酸雾里亮一下，就足够让矛阵手心出汗。托马斯说他也许设计过这里，加利说那就该先杀他。纽特说先活。明霍说先跑。特丽萨说改变已开始。你把这些话排成队形，放进四阶的夜。门开着，神话关不上，只好把人打开又聚拢。聚拢的人叫空地，空地的人叫还没被红叉吃掉的名单。\n`;
t = t.replace('\n## 阶位切入点', more + '\n## 阶位切入点');
fs.writeFileSync(p, t);
console.log(t.split('## 阶位切入点')[0].split('## 剧情')[1].replace(/\s/g,'').length);
