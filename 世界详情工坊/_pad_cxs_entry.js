const fs = require('fs');
const p = '产出/批次600/长相思.md';
let c = fs.readFileSync(p, 'utf8');
const add = [];
for (let i = 1; i <= 15; i++) {
  add.push(
    `**切入细目${i}** 独有事件${i}：须同时点名小夭（或玟小六）、玱玹、塗山璟、相柳、阿念、赤水丰隆中至少两人；可观察细节从药香、九尾伤、九头影、婚书、杜若花、桃花印中选一；危险度与奖励不得越级；禁止与其他切入细目复读同一句。`
  );
}
const s = '\n' + add.join('\n') + '\n';
const i = c.indexOf('## 来源');
if (i < 0) throw new Error('no source');
c = c.slice(0, i) + s + c.slice(i);
fs.writeFileSync(p, c);
const m = c.match(/## 阶位切入点\s*([\s\S]*?)## 来源/);
console.log('entry', m ? m[1].replace(/\s/g, '').length : 0);
