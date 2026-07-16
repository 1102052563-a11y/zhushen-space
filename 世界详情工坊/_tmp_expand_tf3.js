const fs = require('fs');
const path = require('path');
const dir = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次296';
const file = '重生萝莉岛 (Teaching Feeling).md';
let t = fs.readFileSync(path.join(dir, file), 'utf8');
const more = `
**【收束金句落地场景】**
雨夜停电，你点蜡烛继续名字课。她说怕黑，你说怕的人可以靠得更近，但先问可不可以。她点头，把写着「希尔薇」的纸按在胸口——不是符咒，是自己。天亮后她把纸贴在冰箱，旁边空一格留给「明天」。这就是本世界的胜利画面：没有征服，只有被选中的明天。
`;
t = t.replace('## 休闲切入点', more + '\n\n## 休闲切入点');
fs.writeFileSync(path.join(dir, file), t, 'utf8');
const plot = t.split('## 剧情')[1].split('## 休闲切入点')[0];
console.log('plot', plot.replace(/\s/g,'').length);