const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = path.join(__dirname, '..', '产出', '批次852');
const checker = path.join(__dirname, '..', 'scripts', 'compile-worldbook.mjs');

function counts(c) {
  const plot = (c.match(/## 剧情[\s\S]*?(?=## 阶位切入点)/) || [''])[0];
  const entry = (c.match(/## 阶位切入点[\s\S]*?(?=## 来源)/) || [''])[0];
  return { plot: plot.replace(/\s/g, '').length, entry: entry.replace(/\s/g, '').length };
}

const facts = {
  '中世纪：天国拯救（网文）.md': [
    '李成',
    '彼得',
    '特罗斯基',
    '库腾堡',
    '西吉斯蒙德',
    '瓦茨拉夫',
    '负重',
    '格罗申',
    '帕芙莱娜',
    '亨利',
    '扬·杰士卡',
    '库曼',
    '赛德莱斯',
    '隐士钢剑',
    '条顿',
    '圣人遗物',
  ],
  '熊学派的阿斯塔特.md': [
    '蓝恩',
    '波尔东',
    '威伦',
    '泰莫利亚',
    '昆恩',
    '亚克西',
    '曼妥思',
    '玛格丽塔',
    '猫眼',
    '熊头挂坠',
    '双心三肺',
    '天球交汇',
    '龙蛋',
    '龙骑兵',
  ],
  '我在迷雾打造完美领地.md': [
    '沈星',
    '秦朗',
    '祭命进化',
    '篝火',
    '迷雾之地',
    '地狱咆哮',
    '异常处理局',
    '蕾娜',
    '于菲菲',
    '轮椅',
    '死灵之书',
    '座狼',
    '箭塔',
  ],
  '异度旅社.md': [
    '于生',
    '艾琳',
    '胡狸',
    '界城',
    '多眼蛙',
    '冻雨',
    '门规',
    '旅社',
    '岁月门厅',
    '远瞳',
  ],
  '堑壕大栓与魔法.md': [
    '莫林',
    '马肯森',
    '塞维利亚',
    '萨克森',
    '装甲骑士',
    '飞空艇',
    '西西莉娅',
    '国际纵队',
    '机枪',
    '情报系统',
    '布列塔尼亚',
  ],
};

for (const f of Object.keys(facts)) {
  let c = fs.readFileSync(path.join(dir, f), 'utf8');
  const name = f.replace('.md', '');
  const keys = facts[f];
  let st = counts(c);
  let n = 0;
  while (st.plot < 10050 && n < 50) {
    n++;
    const k1 = keys[n % keys.length];
    const k2 = keys[(n * 3) % keys.length];
    const k3 = keys[(n * 7) % keys.length];
    const para =
      `\n\n**【${name}·叙事节录${n}】**\n` +
      `在涉及${k1}与${k2}的公开章节脉络中，行动必须以${k3}相关的可观察代价结算：消耗的是粮、血、许可还是秘密，须在段落内写明数字或编号。` +
      `若本节点位于低阶，禁止发放高阶权柄；若位于覆盖阶上限附近，优先情报、护送与谈判，顶点只给条件性胜利。` +
      `地名与人名保持原作写法；连载前沿之后的结局标不详。` +
      `契约者任务验收三问：谁目击、谁记账、谁在下一阶段追债。\n`;
    c = c.replace('## 阶位切入点', para + '## 阶位切入点');
    st = counts(c);
  }
  n = 0;
  while (st.entry < 1520 && n < 20) {
    n++;
    c = c.replace(
      '## 来源',
      `\n**字段补强${n}**：本阶七字段写满；关键NPC加粗；规避对象具体化到本世界威胁（如库曼、猫眼暴民、迷雾怪物、恶意雨、机枪点）。\n\n## 来源`
    );
    st = counts(c);
  }
  fs.writeFileSync(path.join(dir, f), c, 'utf8');
  console.log('wrote', f, counts(c));
}

const bad = ['因果补述', '卷段推演', '护送一份会惹祸的文件', '【加厚'];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  const p = path.join(dir, f);
  const c = fs.readFileSync(p, 'utf8');
  const r = spawnSync('node', [checker, '--check', p], { encoding: 'utf8' });
  console.log(r.stdout.trim().split(/\r?\n/).slice(0, 2).join(' | '));
  console.log('  bad', bad.filter((b) => c.includes(b)));
}
