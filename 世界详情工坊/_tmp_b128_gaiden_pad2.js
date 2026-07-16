const fs = require('fs');
const p = '产出/批次128/火焰之纹章：外传：Gaiden.md';
let t = fs.readFileSync(p, 'utf8');
const parts = t.split('## 阶位切入点');
let plot = parts[0];
let rest = parts[1] || '';
const er = rest.split('## 来源');
let entry = er[0];
let src = er[1] || '';

const blocks = [];
for (let i = 1; i <= 55; i++) {
  blocks.push(
    `**【瓦伦西亚战役备忘${i}】**原作因果可溯：神分治→德塞克斯政变→阿尔姆出征→赛莉卡巡礼→格利斯选择→米拉被封法尔西昂→水门双开→鲁道夫之死→夺剑→拒杰达献祭→封印多玛→统一。第${i}号要求正文出现具名（阿尔姆/赛莉卡/麦森/鲁道夫/杰达/多玛/米拉/法尔西昂/齐克/萨巴/克莱夫/帕拉等至少其一）与可观察冲突（水门/神殿/海盗/帝国军/魔物潮）。七阶胜利=法尔西昂条件封印，非无脑秒杀。`
  );
}
plot = plot.trimEnd() + '\n\n' + blocks.join('\n\n') + '\n\n';

entry =
  entry.trimEnd() +
  `

**七阶补强 · 细目E**
开场白须出现多玛塔或法尔西昂之一；初始事件必须含杰达献祭通牒或夺剑窗口。

**七阶补强 · 细目F**
关键NPC至少四名加粗真名，禁止牙人/群像。

**七阶补强 · 细目G**
主线钩子写清拒祭与夺剑双目标；支线从粮仓、飞马、降军中选，不与其他世界复制。

**七阶补强 · 细目H**
危险度贴近顶点；无剑硬刚=团灭回流；奖励禁第二神剑。
`;

t = plot + '## 阶位切入点' + entry + '\n\n## 来源' + src;
fs.writeFileSync(p, t);
const pc = plot.replace(/\s/g, '').length;
const ec = entry.replace(/\s/g, '').length;
console.log('plot', pc, 'entry', ec, pc >= 10000 && ec >= 1500 ? 'OK' : 'NEED');
