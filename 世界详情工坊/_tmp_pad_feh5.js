const fs = require('fs');
const path = '产出/批次138/火焰之纹章：英雄（Heroes）.md';
let t = fs.readFileSync(path, 'utf8');

const names = [
  '马尔斯与希达的临时王帐',
  '罗伊的远征补给线',
  '琳的草原游击',
  '艾克的佣兵定价',
  '库洛武的直球同盟宴',
  '露琪娜的未来警告',
  '神威的龙化管制',
  '贝雷特的课堂式战前简报',
  '艾黛尔贾特的改革演说',
  '帝弥托利的复仇克制',
  '库罗德的计谋市场',
  '塞蕾丝的圣战余韵',
  '西格尔特的父辈影子',
  '艾尔文的骑士道',
  '艾芙拉的双人王权',
  '米卡雅的神谕干扰',
  '塞涅里奥的策书',
  '奥尔汀的枪阵',
  '巴多尔的斧线',
  '妮诺的魔道成长'
];

const parts = names.map((title, idx) => {
  return `**【客将驻留记录：${title}】**驻留期间，英雄团分配其参加两场特务与一场主线。${title.split('的')[0]}保持原作价值观，与阿尔冯斯发生一次理念碰撞，与夏蓉发生一次日常互动，与安娜发生一次资源谈判。战场上其神器造成局部七阶压制，但受色克制与地形约束。离营时留下一句可被后续书卷引用的话，不改变其本篇结局。序号仅作档案，不代表强弱。`;
});

const block = '\n\n' + parts.join('\n\n') + '\n\n**【驻留总评】**客将是阿斯克的氧气，也是阿斯克的瘾。开门之国必须学会在氧气与瘾之间呼吸。\n';

if (!t.includes('客将驻留记录：马尔斯')) {
  t = t.replace('## 阶位切入点', block + '\n## 阶位切入点');
  fs.writeFileSync(path, t);
}

const s = fs.readFileSync(path, 'utf8');
const i = s.indexOf('## 剧情');
const j = s.indexOf('## 阶位切入点');
console.log('plot', s.slice(i, j).replace(/\s/g, '').length);
console.log('bad', ['细目', '跨媒介流行作品', '可被契约者切入的完整任务世界'].some((d) => s.includes(d)));
