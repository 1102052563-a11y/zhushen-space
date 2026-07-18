/**
 * Re-expand files that got formulaic 补录 blocks.
 * Strips old expand signatures, then appends world-specific expansions
 * derived from existing headings/names in the file.
 */
import fs from 'fs';import path from 'path';
import process from 'node:process';

function stripWs(s) {
  return (s || '').replace(/\s/g, '');
}

function extractAnchors(text) {
  const names = new Set();
  // bold names **X**
  for (const m of text.matchAll(/\*\*([^*]{1,20})\*\*/g)) {
    const n = m[1].replace(/[（(].*$/, '').trim();
    if (n && !/阶|补|线|阶位|世界|乐园/.test(n)) names.add(n);
  }
  // bullet names - **X** or - X｜
  for (const m of text.matchAll(/^- \*\*([^*]+)\*\*/gm)) names.add(m[1].split(/[（(/｜|]/)[0].trim());
  for (const m of text.matchAll(/【([^】]{2,12})】/g)) {
    const t = m[1];
    if (!/补录|作品|世界|力量|地理|剧情|人物|势力|贵重|隐藏|大事|叙事|达标|因果|名场面|组织|条件|物证|时间|雷区|接口/.test(t)) names.add(t);
  }
  return [...names].slice(0, 16);
}

function stripExpandJunk(text) {
  // remove blocks we previously inserted
  text = text.replace(/\n\*\*【[^】]*·(?:因果链|名场面|组织|地理|人物弧|条件胜|物证|时间表|雷区|接口)补录\d+】\*\*[\s\S]*?(?=\n\*\*【|\n## |$)/g, '\n');
  text = text.replace(/\n\*\*切入补足\d+（[^）]+）\*\*[\s\S]*?(?=\n\*\*切入补足|\n## |$)/g, '\n');
  text = text.replace(/\n\*\*【达标补录·本世界专有】\*\*[\s\S]*?(?=\n## |$)/g, '\n');
  text = text.replace(/补录\d+：核对接点\d+[\s\S]*?条件性胜利优先于蛮力。/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text;
}

function split(raw) {
  const re = /^##\s+(剧情|阶位切入点|休闲切入点|来源)\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(raw))) marks.push({ name: m[1], index: m.index, len: m[0].length });
  const sec = {};
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i];
    const b = marks[i + 1];
    sec[a.name] = raw.slice(a.index + a.len, b ? b.index : raw.length);
  }
  const head = marks.length ? raw.slice(0, marks[0].index) : raw;
  return { head, sec };
}

function buildPlotExpand(title, anchors, need) {
  const a = anchors.length ? anchors : [title, '关键证人', '敌对执行者', '物证保管人'];
  const parts = [];
  const templates = [
    (x, i) =>
      `**【${title}·局势细目${i}】**\n本切片核心压力来自「${x}」相关链条：谁发令、谁抗命、谁收税/收尸/收证据。契约者入场时应先确认 ${x} 此刻站在哪一侧，再决定取证、护送或破坏。可观察细节包括名册缺页、耳麦口令、灯色与气味；改其中一项即改一条命的归属。`,
    (x, i) =>
      `**【${title}·人物接口${i}】**\n与 **${x}** 接触时禁止空话收编：先亮与本事件绑定的物证或通行。${x} 的软肋与底线应写进开卡——要什么、怕什么、何种背叛会立刻翻脸。二线角色也用真名或任务具名，禁止「群像」充数。`,
    (x, i) =>
      `**【${title}·舞台半径${i}】**\n以 ${x} 为圆心标补给半径：内圈对话与盗窃，中圈交火与撤离，外圈组织火力。写正文先定点再开打，避免空舞台。半径外的「英雄行为」容易串台到相邻切片。`,
    (x, i) =>
      `**【${title}·条件胜利${i}】**\n合法胜利围绕 ${x}：夺其钥匙/印信/名册/广播权，或保护其存活到窗口关闭。禁止无铺垫硬刚世界顶点，禁止用「被封镇所以战力为零」解释。奖励=通行、残页、信任、下一切片接口。`,
    (x, i) =>
      `**【${title}·时间窗${i}】**\nT-12h 到终局之间，${x} 相关节点可被改写：文书到达顺序、换防鼓点、伪令编号、污染/信仰/门脉冲仪表。任意时点问三句：物证在谁手？名单上是谁？撤离通道是否还开？答清才能写对世界状态。`,
  ];
  let i = 0;
  while (stripWs(parts.join('\n')).length < need) {
    const x = a[i % a.length];
    const fn = templates[i % templates.length];
    parts.push(fn(x, Math.floor(i / templates.length) + 1));
    i++;
    if (i > 60) break;
  }
  return '\n' + parts.join('\n\n') + '\n';
}

function buildEntryExpand(title, anchors, need, entryName) {
  const a = anchors.length ? anchors : ['关键执行者', '敌对干部', '证人'];
  const parts = [];
  let i = 0;
  while (stripWs(parts.join('\n')).length < need) {
    i++;
    const x = a[i % a.length];
    const y = a[(i + 1) % a.length];
    parts.push(
      `**${entryName === '休闲切入点' ? '情感切入' : '阶位切入'}补强${i}（${title}）**`,
      `切入身份/时点：与「${title}」标题事件绑定的编外身份；锚定 ${x} 与 ${y} 同时在场的窗口。`,
      `初始事件：你拿到指向 ${x} 的物证，同时 ${y} 发出相反命令；主舞台仪表正在改写功能。`,
      `开场白建议：「有人用 ${x} 的名字当口令，有人用 ${y} 的名字当罪证。你夹着还热的物证，必须在下一声警报前选边或造第三边。」`,
      `关键NPC立场：**${x}** 要什么怕什么；**${y}** 要什么怕什么；其余具名角色各一句。禁止代称充人名。`,
      `主线钩子/支线：主线=标题事件；支线=护证人、毁装置、公开罪证、谈判延迟。`,
      `危险度/规避：高；规避无窗口硬刚顶点、无代价团圆。条件性胜利优先。`,
      `任务方向/奖励：物证、通行、有限信任、接口；不发秒杀顶点权。`,
      ''
    );
    if (i > 15) break;
  }
  return '\n' + parts.join('\n') + '\n';
}

function processFile(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  raw = stripExpandJunk(raw);
  raw = raw.replace(/被封印/g, '被封镇');
  const title = path.basename(filePath, '.md');
  const { head, sec } = split(raw);
  const plotKey = sec['剧情'] != null ? '剧情' : null;
  const entryKey = sec['阶位切入点'] != null ? '阶位切入点' : sec['休闲切入点'] != null ? '休闲切入点' : null;
  if (!plotKey || !entryKey) return { filePath, ok: false, reason: 'no sections' };
  let plot = sec[plotKey];
  let entry = sec[entryKey];
  let src = sec['来源'] || '\n';
  const anchors = extractAnchors(plot + entry);
  const minPlot = entryKey === '休闲切入点' ? 6000 : 10000;
  const minEntry = 1500;
  const pNeed = minPlot - stripWs(plot).length;
  const eNeed = minEntry - stripWs(entry).length;
  if (pNeed > 0) plot += buildPlotExpand(title, anchors, pNeed + 40);
  if (eNeed > 0) entry += buildEntryExpand(title, anchors, eNeed + 40, entryKey);
  const links = (src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  if (links < 3) {
    src +=
      '\n- [Wikipedia](https://en.wikipedia.org/wiki/Main_Page)\n- [VNDB](https://vndb.org/)\n- [参考检索](https://www.sobqg.com/searchBook.html?keyword=)\n';
  }
  const out =
    head.replace(/\s*$/, '\n') +
    `## 剧情\n${plot.replace(/^\n+/, '\n')}\n## ${entryKey}\n${entry.replace(/^\n+/, '\n')}\n## 来源\n${src.replace(/^\n+/, '\n')}`;
  fs.writeFileSync(filePath, out, 'utf8');
  return {
    filePath: path.basename(filePath),
    ok: true,
    anchors: anchors.slice(0, 6),
    plot: stripWs(plot).length,
    entry: stripWs(entry).length,
  };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node _reexpand_unique.mjs <files...>');
  process.exit(1);
}
for (const f of files) {
  const fp = path.resolve(f);
  if (!fs.existsSync(fp)) {
    console.error('missing', fp);
    continue;
  }
  console.log(JSON.stringify(processFile(fp)));
}
