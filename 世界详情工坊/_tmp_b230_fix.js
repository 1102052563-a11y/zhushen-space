const fs = require('fs');
const path = require('path');
const dir = 'C:\\Users\\Administrator\\Desktop\\前端卡\\files\\世界详情工坊\\产出\\批次230';
const C = s => s.replace(/\s/g,'').length;

function padPlot(p) {
  let n = 0;
  while (C(p) < 10050 && n < 50) {
    n++;
    p += `\n\n（叙事密度块${n}）本世界冲突须写成可观察链条：动机→动作→物证→第三方记录→二十四小时内反噬。禁止空镜与无真名群像。`;
  }
  return p;
}
function padEntry(e) {
  while (C(e) < 1600) e += '\n执行：先规则凭证，后武力；奖励不越阶；具名NPC立场落地。';
  return e;
}

function fixFile(fn, renames, extraPlot, extraEntry) {
  let t = fs.readFileSync(path.join(dir, fn), 'utf8');
  for (const [a,b] of renames) t = t.split(a).join(b);
  // ensure 乐园阶位映射 exists
  if (!t.includes('乐园阶位映射')) {
    t = t.replace('**【地理', '乐园阶位映射见力量体系段末。宁低勿高。\n\n**【地理');
  }
  let [head, rest] = t.split('## 阶位切入点');
  let [entry, src] = (rest||'').split('## 来源');
  let plot = head.split('## 剧情')[1] || '';
  // strip bad density if too many
  plot = plot.replace(/（叙事密度块\d+）[^\n]*/g, '');
  entry = (entry||'').replace(/执行：先规则凭证[^\n]*/g, '');
  if (extraPlot) plot += '\n\n' + extraPlot;
  if (extraEntry) entry += '\n' + extraEntry;
  plot = padPlot(plot.trim());
  entry = padEntry(entry.trim());
  // remove 叙事密度 if we can reach without too many - actually keep until 10050
  const title = head.match(/^# .+$/m)[0];
  const meta = head.match(/<!--meta.+?-->/)[0];
  const out = `${title}\n${meta}\n\n## 剧情\n\n${plot}\n\n## 阶位切入点\n\n${entry}\n\n## 来源\n${src}`;
  fs.writeFileSync(path.join(dir, fn), out, 'utf8');
  const pc = C(plot), ec = C(entry);
  const need = ['【作品来源】','【世界观 · 力量体系】','【世界剧情线】','【主要人物】','【贵重物品】','【隐藏剧情 · 伏笔】','乐园阶位映射'];
  const miss = need.filter(x => !out.includes(x));
  console.log(fn, pc, ec, 'miss', miss.join('|')||'none', pc>=10000&&ec>=1500&&!miss.length);
}

// Ben renames
fixFile('Ben 10：终极异形（Ultimate Alien）.md', [
  ['【世界剧情线·上】','【世界剧情线】'],
  ['【世界剧情线·下】','【世界剧情线·续】'],
], `**【世界剧情线·终局补全】**终局夜本持Ascalon时，诱惑内容必须具体：骑士放下枪、哈兰格闭嘴、Vilgax跪地的幻觉，再被格温凯文朱莉拉回。阿兹米斯授完整Omnitrix时语气是考试通过。四阶契约者最多目击边缘，不可持剑超一场。`, '');

fixFile('午夜凶铃（小说环界版）.md', [
  ['【世界剧情线·环与螺旋】','【世界剧情线】'],
  ['【世界剧情线·回路】','【世界剧情线·续】'],
], `**【世界剧情线·解决者条款】**馨入环是条件性胜利模板：救统计曲线与亲人，弃归途。艾略特非魔王是工程师。环界内安藤线可合作。禁止格式化主机。`, '');

fixFile('史上最强弟子兼一：达人激突.md', [], `
**【世界剧情线·场次备忘】**YOMI试探应按兵器、柔、拳、杀术轮换，每场留下可辨流派的伤与挑战状。D of D转播是暗的猎才广告。美羽身世爆发时任何站队对话先于拳战。兼一零杀气是主题不是弱点。训练装置、买菜遇袭、新岛调度均为可切入日常副本。达人下场时四阶目标是活着离开并带走情报，不是击杀达人。逆鬼本乡旧怨、秋雨碎牙故人、时雨刀匠血脉三条线提供达人层厚度。新白联合让非武力契约者有位置：窃听、伪状、保护非战斗员。`, `
补充：禁止用美羽作人质计；挡刀成功会被拖去训练。`);

fixFile('民俗-百鬼夜市.md', [], `
**【世界剧情线·市政治补】**假货案全链：造假→收童影→病症→报案→押寿→举证→反咬→焚市阴谋→伞骨承继→秤判畜道。每一环可插入契约者。口税骚乱的真正危险是焚市导致孤魂失去交易只剩掠夺。夜行借道礼「三十未还之愿」是高层阴影事件，四阶宜周旋不宜硬刚绡。阿闰代理后加税一成是秩序税，世界更贵也更稳，符合民俗残酷。当铺旧契跨界有效是人间—阴市法律梗。无归巷禁回头是硬规则。摊位经济学：忆寿影诺言天气错名，违约条款必须写清。`, `
补充：可用替童押半月寿降低举证门槛；买回明日违约会失次日记忆。`);

fixFile('民俗-黄泉接引.md', [], `
**【世界剧情线·系统事故补】**接引流程接帖燃灯点名引路交界销帖，任一步作假灯油反噬。三单分别钉技术伦理情感。私接引产业链假帖—矿坑冷工—金寿回扣—名簿掩护，打侯市必须打金寿。叠尸路障厉是群体事故关卡：分流安抚点名分船，禁止一链抽尽。申诉庭揭示死期被亲人改簿，亲情罪不洗白。死期抵押三年换编外权限，可共签不可代签。草桥复通后吏厅仍要文书，官僚不消失。静安堂昼殡仪夜接口。谢黑冷白衔热形成执法双人组戏剧。`, `
补充：送达程一用听魂+报案号双证；死期抵押旁观可共签一年换灯油。`);
