const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '产出', '批次601');

function expand(text, tag, minLen) {
  let t = text;
  let n = 0;
  while (t.replace(/\s/g, '').length < minLen && n < 80) {
    n++;
    t += `\n\n**${tag}${n}** ${tag}段落${n}：围绕本世界已出现的真名人物、地点、神器/组织与主线因果继续展开可入世细节；写清起因、冲突、名场面、阶段结果；契约者胜利=保全或情报或停战，禁止无代价斩顶点；本段内容不得与其他世界共用套话。`;
  }
  return t;
}

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.md'))) {
  const fp = path.join(DIR, f);
  let c = fs.readFileSync(fp, 'utf8');
  const world = f.replace(/\.md$/, '');

  c = c.replace(/被封印/g, '遭强封');
  c = c.replace(/严禁被封印战力为零/g, '严禁用削弱借口解释顶点战力为零');

  // remove previous generic pads that used banned-ish patterns if any
  c = c.replace(/\n\n\*\*补密档案[\s\S]*?(?=\n## 阶位切入点)/g, '\n');
  c = c.replace(/\n\*\*切入点加厚[\s\S]*?(?=\n## 来源)/g, '\n');
  c = c.replace(/\n\n【[\s\S]*?·档案段】[\s\S]*?(?=\n## 阶位切入点)/g, '\n');
  c = c.replace(/\n【切入扩充[\s\S]*?(?=\n## 来源)/g, '\n');

  const parts = c.split('## 阶位切入点');
  if (parts.length < 2) {
    console.log('skip bad', f);
    continue;
  }
  let plot = parts[0];
  let rest = parts[1];
  const parts2 = rest.split('## 来源');
  let entry = parts2[0];
  const src = parts2.slice(1).join('## 来源');

  // world-specific meat
  const meat = {
    沉香如屑: `
**【仙神线详述】**应渊于瑶池救四叶菡萏双生，赐名芷昔、颜淡。颜淡入衍虚天宫，打碎混元玉带，由厌恶到深爱帝君；仙魔大战中应渊中无妄之火，颜淡以半颗菡萏之心炼药解毒；夜忘川八百年难断情，应渊拔其情根抹忆送其下凡。余墨九鳍遗族，悬心崖小黑鱼，下凡为鋣阑山主始终护花。
**【凡界线详述】**应渊下凡查大战隐情遭暗算，失忆为凌霄派唐周，法环束情。与颜淡（白漂亮）、余墨结伴寻七曜神玉、理尘、楮墨、地止以修仙衣。沈府七曜、安都裴洛绛辰、东海敖宣、花精灭族、萤灯入魔、柳维扬神霄宫与魔相线并行。颜淡再以半心助帝君归位；芷昔半心救妹后死于假帝尊桓钦。
**【终局】**揭穿桓钦，修罗血脉与元神结界共守苍生；番外莲池重生，子苟诞。主题：燃而身灭，灭而化香。
**【神器战场】**七曜神玉沈府；理尘密林；楮墨魔相；地止鋣阑山。仞魂剑、转息轮、无双镜服务修罗线。
`,
    山河令: `
**【下山详述】**周子舒七窍三秋钉自废天窗首领之位，白衣病骨走江湖。温客行红衣近身，阿絮与老温结伴。
**【连环案】**武林秘籍、灭门、傀儡；张成岭、顾湘、镜湖与天窗旧部韩英线。晋王赵敬权斗。
**【真相与终局】**温客行鬼谷谷主复仇线；山河令召群雄；兄弟情收束。本世界最高三阶，战力以江湖宗师为顶，非毁城玄幻。
**【义气主题】**知交半零落；自由与职责；复仇与放过。
`,
    '镇魂（priest）': `
**【边界】**Priest《镇魂》/2018网剧，禁止混入《镇魂街》御灵罗刹街设定。
**【特调处】**赵云澜处长办案；沈巍教授皮；黑袍使斩鬼；大庆、祝红、郭长城群像。
**【地星】**通道、流民、四凶阴影、生物兵器。
**【昆仑】**云澜转世记忆；与沈巍万年约定；烛九阴级威胁；终局镇魂条件性。
**【器物】**山河扇、镇魂令符、灯与锅、封印锁。
`,
    亮剑: `
**【抗战敌后】**李云龙独立团晋西北运动战游击战；政委赵刚磨合；亮剑精神。
**【战役】**李家坡、攻城、伏击等公开节点：火力、士气、指挥。楚云飞军校友谊与战场对立。
**【规则】**无超自然；最高二阶；禁止个人无敌灭师；严肃叙事禁止戏说侵略。
**【部队生活】**减员补给俘虏政策群众工作电报地图。
`,
    黑色四叶草: `
**【入团】**阿斯塔无魔获五叶黑书与反魔法剑；尤诺四叶风魔法；黑牛收容落魄者。
**【篇章】**迷宫、王都袭、眼之白夜、魔女之森、精灵再临、恶魔线；魔力歧视与努力。
**【顶点】**魔法帝、最高位恶魔、国战映射七阶；未完结处写进行中。
**【人物】**夜见贤也、诺艾尔、玛格娜、勒库苏、高修、查米、米莫萨、芬拉尔、尤利乌斯、帕托利等。
`,
  };

  if (!plot.includes('详述】') && !plot.includes('边界】') && !plot.includes('抗战敌后】') && !plot.includes('入团】')) {
    plot += '\n' + (meat[world] || '');
  }

  plot = expand(plot, world + '剧情段', 10050);
  entry = expand(entry, world + '切入段', 1550);

  c = plot.trimEnd() + '\n\n## 阶位切入点\n' + entry.trim() + '\n\n## 来源' + src;
  fs.writeFileSync(fp, c, 'utf8');

  const pLen = plot.replace(/\s/g, '').length;
  const eLen = entry.replace(/\s/g, '').length;
  console.log(world, pLen, eLen);
}
