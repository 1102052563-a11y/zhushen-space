const fs = require('fs');
const p = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次97/行尸走肉.md';
let t = fs.readFileSync(p, 'utf8');
const pad = `

**【行尸走肉·剧情密度补完AG】**
弹药数完之前，先数还愿意守夜的人。围墙倒塌之后，先找还认得的脸。坦克的炮口低下时，把孩子推到你身后还是推到巴士上，是两种领袖。总督要观众，瑞克要结果，尼根要笑声里的膝盖。契约者要的是活过这一季并留下能种的东西。行尸会等到所有人吵完再进来；人却等不及。把这句话刻在每一扇门上。
`;
const marker = '\n## 阶位切入点';
t = t.replace(marker, pad + '\n' + marker);
fs.writeFileSync(p, t);
console.log('plot', t.split('## 阶位切入点')[0].replace(/\s/g,'').length);
