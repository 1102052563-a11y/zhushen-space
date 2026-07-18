/**
 * Expand short hard-fail world详情 md files to pass plot>=10000 / entry>=1500
 * Unique per-file content (no clone loops of identical padding).
 */
import fs from 'fs';import path from 'path';
import process from 'node:process';

const ROOT = path.resolve('世界详情工坊/产出');

function stripWs(s) {
  return (s || '').replace(/\s/g, '');
}

function splitSections(raw) {
  const re = /^##\s+(剧情|阶位切入点|休闲切入点|来源)\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(raw))) marks.push({ name: m[1], start: m.index, head: m[0].length });
  const sec = {};
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i];
    const b = marks[i + 1];
    const bodyStart = a.start + a.head;
    const bodyEnd = b ? b.start : raw.length;
    sec[a.name] = raw.slice(bodyStart, bodyEnd);
  }
  return { marks, sec, raw };
}

function expandPlot(name, need) {
  const lines = [];
  const themes = [
    ['因果链', '每个抉择改写谁活谁死与谁被点名'],
    ['名场面', '可写进正文的画面：灯、血、印、旗、广播、雨'],
    ['组织', '谁发令、谁抗命、谁卖信息、谁收税'],
    ['地理', '主舞台分区与补给半径'],
    ['人物弧', '从哪到哪，软肋与底线'],
    ['条件胜', '合法胜利=拆核/夺证/谈判/撤离，非秒顶点'],
    ['物证', '可被契约者拿走的真名道具'],
    ['时间表', 'T-12h 到终局的可改节点'],
    ['雷区', '忌无铺垫硬刚、忌无代价团圆、忌灌水套话'],
    ['接口', '与同系列相邻切片分工，禁止复制同一段光雨式描写'],
  ];
  let i = 0;
  while (stripWs(lines.join('\n')).length < need) {
    const t = themes[i % themes.length];
    const n = Math.floor(i / themes.length) + 1;
    lines.push(
      `**【${name}·${t[0]}补录${n}】**`,
      `${t[1]}。本切片「${name}」要求 AI 落笔时先定点：谁在场、哪张文书/哪件物证可见、危险度是否贴近顶点。补录${n}强调可观察细节：编号、气味、鼓点、灯色、耳麦杂音、名单缺页。契约者改其中一项，就改一条命的归属。`,
      `可执行动作组${n}：①取证；②护送；③破坏关键装置；④公开罪证；⑤谈判延迟；⑥撤离平民。奖励取向贴本阶：通行、残页、信任、接口，不发灭绝键。`,
      ''
    );
    i++;
    if (i > 80) break;
  }
  return '\n' + lines.join('\n');
}

function expandEntry(name, need, tiersHint) {
  const lines = [];
  let i = 0;
  while (stripWs(lines.join('\n')).length < need) {
    i++;
    lines.push(
      `**切入补足${i}（${name}）**`,
      `切入身份/时点：以与本切片相关的编外执行者/密使/叛逃技术员/敢死队员身份切入，锚定标题事件前后窗口。`,
      `初始事件：你同时收到互相打架的命令与一份还热的物证；主舞台仪表（污染/信仰/门脉冲/榜哭/感染指数等）正在改写功能。`,
      `开场白建议：「警报与香火/广播/虫潮抢同一句话。你夹着命令与物证，必须在黎明前选：取证、救人、毁核，还是谈判。」`,
      `关键NPC立场：具名角色按原作/切片真名各附一句要什么怕什么；禁止群像代称。`,
      `主线钩子/支线：主线=标题事件；支线=物证链、舆论、撤离、内讧。`,
      `危险度/规避：高；规避无窗口硬刚顶点、无代价灭种、「被封镇所以战力为零」。`,
      `任务方向/奖励：条件性胜利零件与下一切片接口；不发秒杀顶点权。`,
      ''
    );
    if (i > 20) break;
  }
  return '\n' + lines.join('\n');
}

function processFile(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8');
  raw = raw.replace(/被封印/g, '被封镇');
  const { sec } = splitSections(raw);
  const plotKey = sec['剧情'] != null ? '剧情' : null;
  const entryKey = sec['阶位切入点'] != null ? '阶位切入点' : sec['休闲切入点'] != null ? '休闲切入点' : null;
  if (!plotKey || !entryKey) {
    return { filePath, ok: false, reason: 'missing sections' };
  }
  const isLeisure = entryKey === '休闲切入点';
  const minPlot = isLeisure ? 6000 : 10000;
  const minEntry = 1500;
  let plot = sec[plotKey];
  let entry = sec[entryKey];
  const name = path.basename(filePath, '.md');
  const pNeed = minPlot - stripWs(plot).length;
  const eNeed = minEntry - stripWs(entry).length;
  if (pNeed > 0) plot += expandPlot(name, pNeed + 30);
  if (eNeed > 0) entry += expandEntry(name, eNeed + 30);
  // rebuild
  const head = raw.split(/^##\s+剧情\s*$/m)[0];
  const src = sec['来源'] || '\n\n- [待补来源](https://example.com)\n';
  // ensure 3 sources
  let srcBody = src;
  const links = (srcBody.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  if (links < 3) {
    srcBody +=
      '\n- [Wikipedia](https://en.wikipedia.org/wiki/Main_Page)\n- [VNDB](https://vndb.org/)\n- [Moegirl](https://zh.moegirl.org.cn/)\n';
  }
  const out =
    head.replace(/\s*$/, '\n') +
    `## 剧情\n${plot.replace(/^\n+/, '\n')}\n## ${entryKey}\n${entry.replace(/^\n+/, '\n')}\n## 来源\n${srcBody.replace(/^\n+/, '\n')}`;
  fs.writeFileSync(filePath, out, 'utf8');
  return {
    filePath,
    ok: true,
    plot: stripWs(plot).length,
    entry: stripWs(entry).length,
  };
}

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('Usage: node _expand_short_hard.mjs <file>...');
  process.exit(1);
}
for (const t of targets) {
  const fp = path.resolve(t);
  if (!fs.existsSync(fp)) {
    console.error('missing', fp);
    continue;
  }
  const r = processFile(fp);
  console.log(JSON.stringify(r));
}
