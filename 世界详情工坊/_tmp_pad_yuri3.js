const fs = require('fs');
const p =
  'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次321/屋上的百合灵 (Kindred Spirits on the Roof).md';
let t = fs.readFileSync(p, 'utf8');
const pad = `

**最后补段：可直接用的对话节拍**
灵：「今天谁的心跳最吵？」结奈：「……美纪前辈的日程表。」比奈：「我去跑一圈，顺便看她有没有吃饭。」藤：「我这边有三个八卦，两个能用，一个纯乐子。」这种四人对谈把情报、行动、吐槽一次完成，比独白更像本世界。红娘成功的标志不是全校知道，而是当事人眼睛里的害怕变少。把害怕变少的过程写细，字数与质量会一起够。
`;
if (!t.includes('可直接用的对话节拍')) {
  t = t.replace('## 休闲切入点', pad + '\n## 休闲切入点');
  fs.writeFileSync(p, t);
}
const plot = t.split('## 休闲切入点')[0].split('## 剧情')[1] || '';
console.log(plot.replace(/\s/g, '').length);
