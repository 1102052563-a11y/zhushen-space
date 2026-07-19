const fs = require('fs');
const p = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次97/移动迷宫.md';
let t = fs.readFileSync(p, 'utf8');
const blocks = [];
for (let i = 1; i <= 20; i++) {
  blocks.push(`**【移动迷宫·加厚${i}】**林间空地的秩序建立在恐惧与分工上。跑者用肺换地图，守卫用失眠换门关，农夫用茧换粮。WICKED在玻璃后记录心跳与背叛。鬼火兽的酸液滴在番茄垄上发出滋声时，少年们发现文明只是暂时的编队。托马斯带来问题，特丽萨带来变量，查克带来尚未被实验磨掉的软。锚点夜门不关，神话破产，木矛对准液压关节，名字变成红叉。出口外的风不是自由的保证，只是下一场测试的开场白。契约者能改的是谁多活一个黎明，不能改的是实验仍在继续。把路线画直，把矛握紧，把同伴的名字念准。`);
}
const pad = '\n\n' + blocks.join('\n\n') + '\n';
const marker = '\n## 阶位切入点';
t = t.replace(marker, pad + marker);
fs.writeFileSync(p, t);
const plot = t.split('## 阶位切入点')[0].split('## 剧情')[1];
console.log('plot', plot.replace(/\s/g,'').length);
