const fs = require('fs');
const path = require('path');
const dir = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次296';
const file = '重生萝莉岛 (Teaching Feeling).md';
let t = fs.readFileSync(path.join(dir, file), 'utf8');
const more = `
**【餐桌政治：权力如何在碗筷间转移】**
谁先动筷、谁决定菜单、谁收拾、谁被允许剩饭——全是权力。早期你决定全部；中期她否决一道菜；后期她排一周菜单。把「剩饭不被惩罚」写成重大解放。食物是最早的同意训练：喜欢与不喜欢必须被听见。

**【书写与自我】**
名字是最小的主权。日记是内部主权。购物小票是社会主权。三层写全，角色才像人。当她把你的名字也写对时，关系从「单方面命名」变成「互相命名」——这是恋爱资格线。
`;
t = t.replace('## 休闲切入点', more + '\n\n## 休闲切入点');
fs.writeFileSync(path.join(dir, file), t, 'utf8');
const plot = t.split('## 剧情')[1].split('## 休闲切入点')[0];
console.log('plot', plot.replace(/\s/g,'').length);