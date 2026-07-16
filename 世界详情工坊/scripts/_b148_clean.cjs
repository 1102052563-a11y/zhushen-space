const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '产出', '批次148');

const KEEP_PLOT = new Set([
  '作品来源', '世界定位', '世界观 · 力量体系', '地理 · 舞台', '世界剧情线',
  '主要人物', '势力图谱', '贵重物品', '隐藏剧情 · 伏笔', '大事记时间线', '叙事基调 · 雷区'
]);

const EXTRA = {
  '银翼杀手：黑莲花.md': [
    '洛杉矶 2032 社会补密', '战斗与潜行规则', '记忆政治', '与电影宇宙衔接',
    '契约者蝴蝶', '可观察细节扩写', '终局语气', '人物关系网', '完整因果链',
    '2032 时间锚与前史', '逐仇名单执行序（可作任务板）', 'Joseph 双面账本',
    'Davis 调查时间线', '复制人身体规则', '华莱士继承战争细部', '银翼杀手职业伦理',
    '黑市生态链', '沙漠猎场规则', '逐段剧情功能扩写（Elle 弧）'
  ],
  '宝可梦 白.md': [
    '合众生态与对战规则补密（AI 写战常用）', '关键战役与名场面因果链（细）',
    '训练家社会与微观政治', '传说与神兽在白版的可触状态', '与续作关系（边界声明）',
    '可观察细节库（正文优先素材）', '结局状态摘要'
  ],
  '宝可梦 黑2.md': [
    '合众两年后社会补密', '关键战役因果链', '训练家微观政治', '传说可触状态',
    '与前作边界', '馆主序列与城镇功能全表（黑2）', '新等离子组织结构',
    '双龙冻结事件分镜', '阿克罗玛理念战', '修线情感节拍', 'PWT 与摄影棚的叙事用途',
    '后日谈开放清单', '版本独占与生态', '可观察细节扩写', '结局政治状态',
    '两年空隙：合众所变（记忆连接可印证）', '主线战斗节奏（供 AI 控场）',
    '魁奇思再起逻辑', '圣剑士与支线传说', '黑色城市（后日谈）', 'DNA 连结器伦理'
  ],
  '魔兽世界：风暴要塞.md': [
    '外围虚空风暴政治', '三舱功能对照', '之眼四阶段叙事', '法力饥渴主题',
    '进入规则', '可观察细节', '契约者阶位使用说明', '与太阳之井边界'
  ],
  '魔兽世界：海加尔山之战.md': [
    '战役细则扩写', '地理与感官', '战后政治一句', '八阶锚定再述', '可观察细节库',
    '具名战斗员补列', '因果链', '契约者边界', '与 W3/WoW 双层',
    '战役前夜会谈细目', '第一道防线战术志', '第二道防线战术志', '第三道防线与峰顶',
    '号角与小精灵机制', '副官波次与副本映射', '战后三条建国路', '不朽丧失的社会冲击'
  ]
};

const PAD_RE = /再补|再增密|扩展档案|补齐字数|最后加厚|字数补钉|密度自检|密度段|合法加厚|字数与密度|禁用套话|AI优先级|收束锚|开场锚|专题·|补密：|长补：|补钉|最后补钉|再列|口述样本|辞典|遭遇表|任务板例|机制关键词|战役全流程|收束$/;

function splitSections(body) {
  const re = /\n\*\*【([^】]+)】\*\*\n/g;
  const marks = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    marks.push({ name: m[1], start: m.index });
  }
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : body.length;
    out.push({ name: marks[i].name, text: body.slice(marks[i].start, end) });
  }
  const pre = marks.length ? body.slice(0, marks[0].start) : body;
  return { pre, sections: out };
}

function cleanEntry(entry) {
  let e = entry.replace(
    /\n\*\*[一二三四五六七八九]阶(补强|加厚)[^\n]*\*\*[\s\S]*?(?=\n\*\*[一二三四五六七八九]阶|\n*$)/g,
    ''
  );
  return e.trim();
}

function processFile(fname) {
  const full = path.join(dir, fname);
  let t = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  const nameM = t.match(/^# .+$/m);
  const metaM = t.match(/<!--meta[^>]+-->/);
  const plotM = t.match(/## 剧情\n([\s\S]*?)\n## 阶位切入点\n/);
  const entryM = t.match(/## 阶位切入点\n([\s\S]*?)\n## 来源\n/);
  const srcM = t.match(/## 来源\n([\s\S]*)$/);
  if (!plotM || !entryM || !srcM) {
    console.log(fname, 'PARSE FAIL');
    return null;
  }
  const { pre, sections } = splitSections(plotM[1]);
  const extra = new Set(EXTRA[fname] || []);
  const kept = [];
  for (const s of sections) {
    if (PAD_RE.test(s.name)) continue;
    if (KEEP_PLOT.has(s.name) || extra.has(s.name)) {
      kept.push(s.text.trimEnd());
    }
  }
  let plot = (pre + kept.join('\n\n')).trim() + '\n';
  let entry = cleanEntry(entryM[1]);

  // Hyjal: only 八阶
  if (fname.includes('海加尔')) {
    const lines = entry.split('\n');
    const keep = [];
    let mode = 'head';
    for (const line of lines) {
      const tm = line.match(/^\*\*([一二三四五六七八九])阶/);
      if (tm) {
        mode = tm[1] === '八' ? 'keep' : 'skip';
        if (mode === 'keep') keep.push(line);
        continue;
      }
      if (mode === 'head' || mode === 'keep') keep.push(line);
    }
    entry = keep.join('\n').trim();
  }

  const pc = plot.replace(/\s/g, '').length;
  const ec = entry.replace(/\s/g, '').length;
  const out = `${nameM[0]}\n${metaM[0]}\n\n## 剧情\n\n${plot}\n## 阶位切入点\n\n${entry}\n\n## 来源\n\n${srcM[1].trim()}\n`;
  fs.writeFileSync(full, out);
  console.log(fname, 'plot', pc, 'entry', ec, 'need+', Math.max(0, 10000 - pc), Math.max(0, 1500 - ec));
  return { fname, pc, ec };
}

const results = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  results.push(processFile(f));
}
fs.writeFileSync(path.join(__dirname, '_b148_clean_report.json'), JSON.stringify(results, null, 2));
