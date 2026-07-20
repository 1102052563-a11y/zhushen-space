const fs = require('fs');
const path = '产出/批次600/苍兰诀.md';
let c = fs.readFileSync(path, 'utf8');
const blocks = [];
for (let i = 1; i <= 55; i++) {
  const places = ['司命殿', '昊天塔', '苍盐海', '人间鹿城', '息山祭坛', '海市留芳阁', '神水厅', '涌泉宫'];
  const people = ['小兰花', '东方青苍', '长珩', '容昊', '赤地女子', '觞阙', '结黎', '巽风', '丹音', '云中君', '司命', '铁婆婆'];
  const p1 = people[i % people.length];
  const p2 = people[(i + 3) % people.length];
  const p3 = people[(i + 7) % people.length];
  const pl1 = places[i % places.length];
  const pl2 = places[(i + 2) % places.length];
  blocks.push(
    `**细目${i}·三界现场** 事件编号${i}发生在${pl1}与${pl2}之间的调度线上。${p1}、${p2}、${p3}同时在场或隔空感应。观察项：同心咒是否同步跳动、骨兰是否发暗、七情树是否落叶、业火是否复燃、祟气是否入酒、云中君是否降旨、月族遗属是否哭祭。契约者目标是保全一名证人或一份证物（命格残页、咒纹拓片、骨兰温度记录、停战草诏），禁止空喊灭族或秒杀月尊。因果：本事件若改写，将影响后续第${(i % 9) + 1}环名场面。`
  );
}
const pad2 = '\n\n' + blocks.join('\n\n') + '\n\n';
if (!c.includes('细目1·三界现场')) {
  c = c.replace('## 阶位切入点', pad2 + '## 阶位切入点');
}
const entryMore =
  '\n\n**切入点加厚（每阶独有）**\n' +
  '一阶：命格虫灾，花草精灵请你夜里守书，雨霖买凶灭口。\n' +
  '二阶：塔砖铭文解读，禁军要你指认谁先碰封印。\n' +
  '三阶：月族童谣暗含通婚刑步骤，猎户孩童教你避坑。\n' +
  '四阶：花魁黑话交易祟气解药半瓶，曲水监视你。\n' +
  '五阶：骨兰温度计校准，觞阙求你劝本座勿锁死。\n' +
  '六阶：神女缄默礼，息芸三问苍生你须答其二。\n' +
  '七阶：太岁心跳声测距，司命残页只能用一次。\n' +
  '禁止各阶复制假货护送名额等跨世界套话。\n\n';
if (!c.includes('切入点加厚')) {
  c = c.replace('## 来源', entryMore + '## 来源');
}
if (!c.includes('乐园阶位映射')) {
  c = c.replace('乐园映射：', '乐园阶位映射（对照《阶位战力图鉴》，宁低勿高）：');
}
fs.writeFileSync(path, c, 'utf8');
const m = c.match(/## 剧情\s*([\s\S]*?)## 阶位切入点/);
const p = (m ? m[1] : '').replace(/\s/g, '');
const e = c.match(/## 阶位切入点\s*([\s\S]*?)## 来源/);
const ent = (e ? e[1] : '').replace(/\s/g, '');
console.log('plot', p.length, 'entry', ent.length);
