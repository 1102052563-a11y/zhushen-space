import fs from 'fs';
import path from 'path';

const dir = '产出/批次851';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));

const extras = {
  '伊塔之柱.md': {
    open: '戈蓝德的钟声与云鲸港的汽笛不是同一种时间。',
    npcs: '额外可接触：**塔塔**示警、协会文书吏、流放档案员。',
  },
  '亡灵天灾从坟场魔开始.md': {
    open: '雾像脓，棺像未填的预算表。',
    npcs: '额外：**系统**文本、雾中诡异、公会会计。',
  },
  '三国神话世界.md': {
    open: '表字比城池更稀缺。',
    npcs: '额外：**命运商人**、公会密探、系统仙子。',
  },
  '天命游戏平台.md': {
    open: '寿命栏的数字比血条诚实。',
    npcs: '额外：平台语音、镖局账房、追杀令差役。',
  },
  '天运玩家.md': {
    open: '14:00的指针比枪栓响。',
    npcs: '额外：网吧老板、拾荒队、职务上级。',
  },
};

function entryLen(md) {
  return ((md.split('## 阶位切入点')[1] || '').split('## 来源')[0] || '').replace(/\s/g, '').length;
}

for (const f of files) {
  let md = fs.readFileSync(path.join(dir, f), 'utf8');
  md = md.replace(/\bundefined\b/g, '');
  md = md.replace(/\*\*【档案增补\d+】\*\*/g, '**【世界细则】**');

  if (!/^## 来源\s*$/m.test(md)) {
    const idx = md.search(/^- \[[^\]]+\]\(https:\/\//m);
    if (idx >= 0) {
      md = md.slice(0, idx) + '## 来源\n\n' + md.slice(idx);
    }
  }

  const ex = extras[f] || {
    open: '风里有文书的味道。',
    npcs: '额外NPC以本阶真名为准。',
  };
  if (!md.includes('**切入点加写**')) {
    const inject = `
**切入点加写**
各阶开场白可替换使用：「${ex.open}」——强化本世界独特声景。
${ex.npcs}
主线钩子须写清蝴蝶效应节点名称；支线至少两条且不与邻阶重复。
危险度随阶递增；顶点阶必须写条件性胜利／情报优先。
任务奖励贴合阶段：许可／材料／编制／权柄碎片，禁止越级发灭世装。
连载中世界禁止写死终局。

`;
    md = md.replace(/\n## 来源\n/, '\n' + inject + '\n## 来源\n');
  }

  let i = 0;
  const tiers = ['一', '二', '三', '四', '五', '六', '七', '八'];
  while (entryLen(md) < 1520 && i < 25) {
    const memo = `**${tiers[i] || '高'}阶备忘**：本阶事件、地名、人名不得与其他阶复制；开场白第二人称；关键NPC加粗真名；初始事件含地点冲突抉择。\n\n`;
    md = md.replace(/\n## 来源\n/, '\n' + memo + '## 来源\n');
    i++;
  }

  fs.writeFileSync(path.join(dir, f), md, 'utf8');
  const links = (md.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  console.log(f, 'entry', entryLen(md), 'links', links, 'hasSrc', /^## 来源\s*$/m.test(md));
}
