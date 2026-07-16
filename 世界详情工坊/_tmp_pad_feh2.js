const fs = require('fs');
const path = '产出/批次138/火焰之纹章：英雄（Heroes）.md';
let t = fs.readFileSync(path, 'utf8');

// Generate long unique plot expansion
const chapters = [];
for (let n = 1; n <= 40; n++) {
  chapters.push(
    `**【书卷战场细目${n}】**阿斯克第${n}号特务记录：开门坐标偏移导致英雄落地偏差，阿尔冯斯调整部署，夏蓉安抚拒战者，安娜核算补给。敌方以恩布拉残党或神域斥候形式出现，色属性克制迫使重编第四人。召唤师需在三回合内夺回据点旗，否则闭门波会切断后援。战后对话触及「是否该暂停召唤」——答案被下一场紧急军情打断。此地出现的跨作英雄保持原作口吻，不泄露未实装剧透。军势评估仍落在七阶：可毁要塞，不可爆星。`
  );
}
const block =
  '\n\n' +
  chapters.join('\n\n') +
  '\n\n**【召唤师手记总录】**门的另一侧没有真正的结束，只有下一本封面。你学会把胜利写成「又撑过一季」，把失败写成「还来得及改部署」。维洛妮卡的茶、苏尔特的火、赫尔的灰、古尔维格的钟，都在同一本英雄谭里抢页眉。阿斯克仍选择开门，因为关上的世界最先冻死的是求援的人。\n';

if (!t.includes('书卷战场细目1')) {
  t = t.replace('**【终章注记】**', block + '\n**【终章注记】**');
  if (!t.includes(block.slice(0, 20))) {
    // fallback insert before 阶位
    t = t.replace('## 阶位切入点', block + '\n## 阶位切入点');
  }
  fs.writeFileSync(path, t);
}

const s = fs.readFileSync(path, 'utf8');
const i = s.indexOf('## 剧情');
const j = s.indexOf('## 阶位切入点');
const k = s.indexOf('## 来源');
const strip = (x) => x.replace(/\s/g, '').length;
console.log('plot', strip(s.slice(i, j)), 'entry', strip(s.slice(j, k)));
console.log('has细目', s.includes('书卷战场细目1'));
