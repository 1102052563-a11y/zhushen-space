#!/usr/bin/env node
/**
 * build-canon-route.mjs — 原著路线数据抽取
 * 读 lunhui-wiki（mkdocs.yml nav 定世界顺序 + 各任务世界页 + 苏晓人物页），
 * 生成 src/data/canonRoute.ts（前 N 站：世界简报 / 原著任务 / 苏晓轨道锚点 / 离世定格 / 结算基准 / 站间乐园强化）。
 *
 * 用法：npm run build-canon-route
 *   可选：--wiki=../../lunhui-wiki  --out=src/data/canonRoute.ts  --count=10
 *
 * 解析是"模糊分类 + 尽力结构化 + 全文压缩兜底"：每站末尾打印分类/抽取日志，跑完人工过目。
 */
import fs from 'node:fs';
import path from 'node:path';

/* ── CLI ── */
const argv = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const WIKI = path.resolve(process.cwd(), argv.wiki || '../../lunhui-wiki');
const OUT = path.resolve(process.cwd(), argv.out || 'src/data/canonRoute.ts');
const COUNT = Number(argv.count || 10);

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/* ── 文本工具 ── */
const stripMd = (s) => String(s)
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/\*([^*\n]+)\*/g, '$1')
  .replace(/[ \t]+/g, (m) => (m.includes('\t') ? ' ' : m));

/** 去 mkdocs admonition（!!! xxx 及其缩进体） */
function stripAdmonitions(s) {
  const out = []; let inAd = false;
  for (const line of s.split('\n')) {
    if (/^!{3}/.test(line.trim())) { inAd = true; continue; }
    if (inAd) { if (/^\s{4,}/.test(line) || line.trim() === '') continue; inAd = false; }
    out.push(line);
  }
  return out.join('\n');
}

/** markdown 表行 → 行文本（2列→k：v；分隔行→丢；多列→ ｜ 连接） */
function tableLineToText(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return line;
  let cells = t.split('|').map(c => c.trim());
  if (cells[0] === '') cells = cells.slice(1);
  if (cells[cells.length - 1] === '') cells = cells.slice(0, -1);
  if (!cells.length || cells.every(c => /^:?-{2,}:?$/.test(c))) return null;
  if (cells.length === 2) return `${cells[0]}：${cells[1]}`;
  return cells.join(' ｜ ');
}

const cap = (s, n) => { const t = String(s).trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** 压缩一段 markdown 为注入友好的纯文本 */
function compact(s, n) {
  const lines = stripAdmonitions(String(s)).split('\n')
    .map(tableLineToText).filter((l) => l !== null)
    .map((l) => stripMd(l).trimEnd())
    .filter((l) => !/本节已移入/.test(l));
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cap(text, n);
}

/** 标题尾部章节参照：（二卷3–4章）/（第7–22章），容忍尾随句号 */
const CHAP_TAIL = /（([^（）]*[卷章][^（）]*)）\s*[。.]?\s*$/;
const splitChapters = (title) => {
  const m = String(title).match(CHAP_TAIL);
  return m ? { title: title.replace(CHAP_TAIL, '').trim(), chapters: m[1].trim() } : { title: String(title).replace(/[。.]\s*$/, '').trim() };
};
const hasChapterRange = (t) => /\d+\s*[–—\-~～]\s*\d+\s*章/.test(t);

const NORM_MINUS = (s) => String(s).replace(/[−–—]/g, '-');

/* ── 人物名册：nav 人物区按世界分组（组标签自带「第N·M卷」；成员=名+一行注解+页面文件）── */
const GROUP_SKIP = /主角与随从|轮回乐园|虚空|竞技场|跨全书|现实/;
function parseCharGroups(yml) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => /^  - 人物:\s*$/.test(l));
  if (start < 0) return [];
  const groups = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^  - \S/.test(line)) break;   // 下一个顶级 nav 段
    let m;
    if ((m = line.match(/^      - (.+):\s*$/))) {
      const label = m[1].trim();
      const vm = label.match(/第([\d·、,\s]+)卷/);
      const vols = vm ? vm[1].split(/[^\d]+/).filter(Boolean).map(Number) : [];
      cur = { label, vols, skip: GROUP_SKIP.test(label) || !vols.length, members: [] };
      groups.push(cur);
      continue;
    }
    if (cur && (m = line.match(/^          - (.+):\s*(人物\/[^\s:]+\.md)\s*$/))) {
      const raw = m[1].trim();
      const nm = raw.match(/^([^（(]+)[（(]([^）)]*)[）)]?\s*$/);
      cur.members.push({
        name: (nm ? nm[1] : raw).replace(/\\/g, '').trim().slice(0, 14),
        anno: nm ? nm[2].trim() : '',
        file: m[2],
      });
    }
  }
  return groups.filter((g) => !g.skip && g.members.length);
}

const CN1 = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function volCharToInt(v) {
  const s = String(v);
  if (/^\d+$/.test(s)) return Number(s);
  const shi = s.indexOf('十');
  if (shi < 0) return CN1[s] ?? null;
  const t = shi === 0 ? 1 : CN1[s[0]];
  const o = shi === s.length - 1 ? 0 : CN1[s[s.length - 1]];
  return t != null && o != null ? t * 10 + o : null;
}

/** 人物页首次出现卷：全文最小「N卷」；只有「第N章」引用 → 第1卷；全无 → null */
function scanFirstVol(text) {
  let min = null;
  for (const m of text.matchAll(/([一二三四五六七八九十]{1,3}|\d{1,2})\s*卷/g)) {
    const n = volCharToInt(m[1]);
    if (n != null && n >= 1 && n <= 60 && (min == null || n < min)) min = n;
  }
  if (min != null) return min;
  if (/第\s*\d+[\d–\-~～、,\s]*章/.test(text)) return 1;
  return null;
}

/** 人物页正文首句（nav 无注解时的简介兜底） */
function firstParagraphBrief(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---/, '');
  for (const ln of body.split('\n')) {
    const t = ln.trim();
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('|') || t.startsWith('!!!')) continue;
    const clean = stripMd(t.replace(/^[-*]\s+/, '')).trim();
    const sent = clean.split(/[。；]/)[0];
    if (sent.length >= 4) return cap(sent, 32);
  }
  return '';
}

/* ── mkdocs nav：任务世界顺序 ── */
function parseNav(yml) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => /^\s*-\s*任务世界:\s*$/.test(l));
  if (start < 0) throw new Error('mkdocs.yml 里找不到「- 任务世界:」块');
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const entries = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    const m = line.match(/^\s*-\s*(.+):\s*(世界\/任务世界\/[^\s:]+\.md)\s*$/);
    if (m) entries.push({ navLabel: m[1].trim(), file: m[2].trim() });
  }
  return entries;
}

/* ── 世界页解析 ── */
function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) {
    const mm = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (mm) fm[mm[1].trim()] = mm[2].trim();
  }
  return { fm, body: m ? src.slice(m[0].length) : src };
}

function splitH2(body) {
  const parts = body.split(/^## /m);
  const sections = [];
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    sections.push({ title: (nl < 0 ? part : part.slice(0, nl)).trim(), text: nl < 0 ? '' : part.slice(nl + 1) });
  }
  return { intro: parts[0] || '', sections };
}

function classify(title) {
  const t = title.trim();
  if (/结算快照|通关结算/.test(t)) return 'settlement';
  if (/苏晓在本世界|苏晓的开局|^进度|^进展|^剧情进展/.test(t)) return 'track';
  if (/终局|通关结局/.test(t)) return 'ending';
  if (/世界信息|基本设定|世界性质|世界梗概/.test(t)) return 'worldInfo';
  if (/规则|警告|限制/.test(t)) return 'rules';
  if (/任务/.test(t) && !hasChapterRange(t)) return 'tasks';
  if (/^关键|势力概览|世界观|设定|地形|分区|人造人/.test(t)) return 'other';
  if (/（[^（）]*[卷章][^（）]*）/.test(t)) return 'narrative';
  return 'other';
}

/** track 小节 → 锚点（顶层 bullet；短列表且含多个 → 时按 → 拆） */
function phasesFromTrackSection(text) {
  const main = text.split(/^### /m)[0];   // 小节内再分 ### 的（如钢炼·进度）只取主干 bullet
  const bullets = [];
  for (const line of main.split('\n')) {
    const m = line.match(/^[-*]\s+(.+)$/);   // 顶层 bullet（缩进子弹丢弃）
    if (m) bullets.push(m[1].trim());
  }
  if (bullets.length && bullets.length <= 2 && bullets.some((b) => (b.match(/→/g) || []).length >= 3)) {
    const out = [];
    for (const b of bullets) {
      const { chapters } = splitChapters(b);
      const segs = stripMd(b).replace(CHAP_TAIL, '').split('→').map((s) => s.trim()).filter(Boolean);
      segs.forEach((seg, i) => out.push({ title: cap(seg, 60), ...(i === segs.length - 1 && chapters ? { chapters } : {}) }));
    }
    return out;
  }
  return bullets.map((b) => {
    const { chapters } = splitChapters(b);
    const clean = stripMd(b).replace(CHAP_TAIL, '').trim();
    const first = clean.split(/[。；]/)[0] || clean;
    return { title: cap(first, 60), ...(chapters ? { chapters } : {}) };
  });
}

function firstBullet(text) {
  for (const line of text.split('\n')) {
    const m = line.match(/^[-*]\s+(.+)$/);
    if (m) return cap(stripMd(m[1]), 110);
  }
  return undefined;
}

/** 结算快照小节解析 */
function parseSettlement(text) {
  const S = text;
  // 定格标题行（### … 或 独行 **…**）
  const lines = S.split('\n');
  let defStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const headingish = /^#{2,4}\s/.test(t) || /^\*\*[^*]+\*\*$/.test(t);
    if (headingish && /(定格|离开[^\n]{0,40}状态|离世)/.test(t)) { defStart = i; break; }
  }
  const defSub = defStart >= 0 ? lines.slice(defStart).join('\n') : S;
  const beforeDef = defStart >= 0 ? lines.slice(0, defStart).join('\n') : '';

  const src = S.match(/世界之源[^\d]{0,16}([\d.]+)\s*%/);
  const rat = NORM_MINUS(S).match(/综合评[价级][^SABCDE]{0,10}([SABCDE][+-]?)/);
  const lv = defSub.match(/L[vV]\.?\s*(\d+)/);
  const realm = defSub.match(/([一二三四五六七八九十]+阶)/);

  // 六维：优先 6 列表；否则行内「力 50 / 敏 50 …」
  let attrs;
  const KEYS = ['力量', '敏捷', '体力', '智力', '魅力', '幸运'];
  const rows = lines.map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const hi = rows.findIndex((r) => r.includes('力量') && r.includes('敏捷') && r.includes('体力'));
  if (hi >= 0) {
    const vals = rows.slice(hi + 1).find((r) => /\d/.test(r) && !/-{2,}/.test(r));
    if (vals) {
      const cells = vals.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 6) {
        attrs = {};
        KEYS.forEach((k, i) => { const n = (cells[i] || '').match(/-?\d+/); if (n) attrs[k] = Number(n[0]); });
      }
    }
  }
  if (!attrs) {
    const flat = NORM_MINUS(defSub).replace(/（[^（）]*）/g, '');   // 剥「（有效 44）」类括号插入
    const m = flat.match(/力\s*(-?\d+)[^\d-]{1,8}敏\s*(-?\d+)[^\d-]{1,8}体\s*(-?\d+)[^\d-]{1,8}智\s*(-?\d+)[^\d-]{1,8}魅\s*(-?\d+)[^\d-]{1,8}[幸运]{1,2}\s*(-?\d+)/);
    if (m) { attrs = {}; KEYS.forEach((k, i) => { attrs[k] = Number(m[i + 1]); }); }
  }

  // 乐园后续变动兜底：结算节里「返园 / 回乐园」相关行（剔编写规范样板）
  const bq = S.split('\n').map((l) => stripMd(l.replace(/^\s*>\s?/, '')).trim())
    .filter((l) => /返园|回乐园/.test(l) && !/编写规范|强制规则/.test(l)).join('；');

  return {
    exit: {
      ...(lv ? { lv: Number(lv[1]) } : {}),
      ...(realm ? { realm: realm[1] } : {}),
      ...(attrs ? { attrs } : {}),
      text: compact(defSub, 950),
    },
    settle: {
      ...(src ? { sourcePct: Number(src[1]) } : {}),
      ...(rat ? { rating: rat[1] } : {}),
      ...(beforeDef.trim() ? { text: compact(beforeDef, 280) } : {}),
    },
    afterNoteFallback: bq ? cap(bq, 300) : undefined,
  };
}

/** 任务小节 → 结构化任务 */
function parseTasks(allText) {
  const bullets = [];
  for (const line of allText.split('\n')) {
    const m = line.match(/^[-*]\s+(.+)$/);
    if (m) bullets.push(stripMd(m[1]).trim());
  }
  // 只在「。已完成——…」这种状态后缀处截断；括号内的「（Lv.4·已完成）」保留不动
  const cutDone = (s) => s.split(/。\s*已完成/)[0].split(/。\s*苏晓/)[0].trim();
  let mainMission, mainReward;
  const sideMissions = [], triggerQuests = [];
  for (const b of bullets) {
    if (!mainMission && /主线/.test(b)) {
      mainMission = cap(cutDone(b), 220);
      const r = b.match(/奖励?[：:]\s*([^（\n。]+)/);
      if (r) mainReward = cap(r[1], 120);
    } else if (/支线/.test(b)) sideMissions.push(cap(cutDone(b), 160));
    else if (/触发任务|隐藏任务|猎杀任务|成就任务|阵营任务/.test(b)) triggerQuests.push(cap(cutDone(b), 180));
  }
  if (!mainMission && bullets.length) {   // 无「主线」标签（晋升考核/空间战争等）→ 首 bullet 兜底
    mainMission = cap(cutDone(bullets[0]), 220);
    const r = bullets[0].match(/奖励?[：:]\s*([^（\n。]+)/);
    if (r) mainReward = cap(r[1], 120);
  }
  return { mainMission, mainReward, sideMissions, triggerQuests };
}

/** 卷号：优先数轨道/结算小节里的「N卷」，全无但有「第N章」→ 一卷；再退整页频次 */
function guessVolume(primaryText, body) {
  const count = (txt) => {
    const freq = {};
    for (const m of txt.matchAll(/([一二三四五六七八九十]{1,3})卷/g)) freq[m[1]] = (freq[m[1]] || 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  };
  const p = count(primaryText);
  if (p) return p[0];
  if (/第\s*\d+[–—\-~～\d]*\s*章/.test(primaryText)) return '一';
  const b = count(body);
  return b ? b[0] : '一';
}

function stationTypeOf(name, navLabel) {
  const t = name + navLabel;
  if (/生存试炼/.test(t)) return '生存试炼';
  if (/晋升|考核/.test(t)) return '晋升考核';
  if (/争夺战/.test(t)) return '世界争夺战';
  if (/入侵/.test(t)) return '乐园入侵';
  return '任务世界';
}

function parseStation(entry, order) {
  const abs = path.join(WIKI, 'docs', entry.file.replace(/\//g, path.sep));
  const srcRaw = read(abs);
  const { fm, body } = parseFrontmatter(srcRaw);
  const { sections } = splitH2(body);

  const bag = { worldInfo: [], rules: [], tasks: [], track: [], settlement: [], ending: [], narrative: [], other: [] };
  for (const s of sections) bag[classify(s.title)].push(s);

  // 轨道锚点：track bullet + narrative 标题，按文档顺序
  const phases = [];
  let alias;
  for (const s of sections) {
    const cls = classify(s.title);
    if (cls === 'track') {
      const am = s.title.match(/化名「([^」]+)」/) || s.title.match(/化名([^）·\s]+)/);
      if (am && !alias) alias = am[1].trim();
      phases.push(...phasesFromTrackSection(s.text));
    } else if (cls === 'narrative') {
      const { title, chapters } = splitChapters(s.title);
      const note = firstBullet(s.text);
      phases.push({ title: cap(stripMd(title), 60), ...(chapters ? { chapters } : {}), ...(note ? { note } : {}) });
    }
  }
  const trackCapped = phases.slice(0, 24);

  const settleSec = bag.settlement[0];
  const st = settleSec ? parseSettlement(settleSec.text) : { exit: { text: '' }, settle: {}, afterNoteFallback: undefined };

  const worldInfoText = bag.worldInfo.map((s) => s.text).join('\n');
  const era = (worldInfoText.match(/(?:时间点|开局|时间线)\*{0,2}[：:]\s*(.+)/) || [])[1];
  const currency = (worldInfoText.match(/本地货币\*{0,2}[：:]\s*(.+)/) || [])[1];
  const tasksAll = bag.tasks.map((s) => s.text).join('\n');
  const tq = parseTasks(tasksAll);

  const name = (fm.title || entry.navLabel).trim();
  const station = {
    id: path.basename(entry.file, '.md'),
    order,
    name,
    navLabel: entry.navLabel,
    volume: guessVolume(bag.track.map((s) => `${s.title}\n${s.text}`).join('\n'), body),
    file: entry.file,
    stationType: stationTypeOf(name, entry.navLabel),
    ...(fm['难度'] ? { difficulty: stripMd(fm['难度']) } : {}),
    ...(fm['状态'] ? { status: stripMd(fm['状态']) } : {}),
    recommendedTier: '一阶',   // 之后按上一站离世阶位重算
    world: {
      desc: compact(worldInfoText, 520),
      ...(era ? { era: cap(stripMd(era), 160) } : {}),
      ...(currency ? { currency: cap(stripMd(currency), 60) } : {}),
      ...(bag.rules.length ? { rules: compact(bag.rules.map((s) => `【${s.title}】\n${s.text}`).join('\n'), 420) } : {}),
      ...(tasksAll.trim() ? { tasksText: compact(tasksAll, 820) } : {}),
      ...(tq.mainMission ? { mainMission: tq.mainMission } : {}),
      ...(tq.mainReward ? { mainReward: tq.mainReward } : {}),
      ...(tq.sideMissions.length ? { sideMissions: tq.sideMissions } : {}),
      ...(tq.triggerQuests.length ? { triggerQuests: tq.triggerQuests } : {}),
    },
    suxiao: {
      alias: alias || '白夜',
      track: trackCapped,
      exit: st.exit,
      ...(Object.keys(st.settle).length ? { settle: st.settle } : {}),
      ...(bag.ending.length ? { endingNote: compact(bag.ending.map((s) => s.text).join('\n'), 260) } : {}),
    },
  };
  return { station, afterNoteFallback: st.afterNoteFallback, log: { id: station.id, secs: sections.map((s) => `${classify(s.title)}:${s.title.slice(0, 14)}`), phases: trackCapped.length } };
}

/* ── 苏晓人物页：人设 + 站间乐园停留 ── */
const STATION_MATCHERS = [
  /^海贼王（LV/, /^东京喰种/, /^进击的巨人/, /^斩·?赤红之瞳/, /寄生兽/,
  /^海贼王（第六/, /^钢之炼金术师/, /^二阶生存试炼/, /^火影忍者/, /^全职猎人/,
];
const isInterlude = (t) => /乐园|返园|返回现实|返现实|复仇/.test(t);

function parseSuxiaoPage() {
  const src = read(path.join(WIKI, 'docs', '人物', '苏晓.md'));
  const { body } = parseFrontmatter(src);
  const { sections } = splitH2(body);

  const intro = sections.find((s) => /^简介/.test(s.title));
  const personality = sections.find((s) => /^性格/.test(s.title));
  const persona = cap([intro ? compact(intro.text, 200) : '', personality ? compact(personality.text, 140) : '']
    .filter(Boolean).join('\n'), 340);

  const hist = sections.find((s) => /^历程/.test(s.title));
  const paradiseAfter = {};   // stationOrder(1起) -> text
  if (hist) {
    const h3 = hist.text.split(/^### /m).slice(1).map((part) => {
      const nl = part.indexOf('\n');
      return { title: stripMd(nl < 0 ? part : part.slice(0, nl)).trim(), text: nl < 0 ? '' : part.slice(nl + 1) };
    });
    let current = 0;   // 已到第几站（1起）
    for (const sec of h3) {
      let matched = false;
      for (let k = current; k < STATION_MATCHERS.length; k++) {
        if (STATION_MATCHERS[k].test(sec.title)) { current = k + 1; matched = true; break; }
      }
      if (matched) continue;
      if (current >= 1 && isInterlude(sec.title)) {
        const bullets = sec.text.split('\n').filter((l) => /^[-*]\s+/.test(l)).slice(0, 4)
          .map((l) => stripMd(l.replace(/^[-*]\s+/, '')).trim());
        const bodyTxt = bullets.length ? bullets.join('；') : compact(sec.text, 200);
        const piece = `【${splitChapters(sec.title).title}】${bodyTxt}`;
        paradiseAfter[current] = cap([paradiseAfter[current], piece].filter(Boolean).join('\n'), 450);
      } else if (current >= STATION_MATCHERS.length) {
        break;   // 已过最后一站且遇到未知世界 → 停
      }
    }
  }
  return { persona, paradiseAfter };
}

/* ── 主流程 ── */
function main() {
  const yml = read(path.join(WIKI, 'mkdocs.yml'));
  const nav = parseNav(yml);
  console.log(`nav 任务世界共 ${nav.length} 站，取前 ${COUNT} 站`);
  const picked = nav.slice(0, COUNT);

  const { persona, paradiseAfter } = parseSuxiaoPage();

  const stations = []; const logs = [];
  picked.forEach((entry, i) => {
    const { station, afterNoteFallback, log } = parseStation(entry, i + 1);
    const pa = paradiseAfter[i + 1] || afterNoteFallback;
    if (pa) station.suxiao.paradiseAfter = pa;
    stations.push(station); logs.push(log);
  });

  // 🧑‍🤝‍🧑 每站原著人物名册：站卷号 ∈ 人物分组卷号集合 → 该组成员中「首现卷 ≤ 本站卷」者（与向量剧透闸同口径）
  const charGroups = parseCharGroups(yml);
  for (const st of stations) {
    const V = volCharToInt(st.volume);
    if (!V) continue;
    const g = charGroups.find((x) => x.vols.includes(V));
    if (!g) continue;
    const roster = [];
    for (const mem of g.members) {
      let vol = g.vols.length === 1 ? g.vols[0] : null;   // 单卷分组免读页；多卷分组逐页判首现卷
      let brief = mem.anno;
      try {
        const txt = read(path.join(WIKI, 'docs', mem.file.replace(/\//g, path.sep)));
        if (vol == null) vol = scanFirstVol(txt) ?? Math.min(...g.vols);
        if (!brief) brief = firstParagraphBrief(txt);
      } catch { if (vol == null) vol = Math.min(...g.vols); }
      if (vol <= V) roster.push({ name: mem.name, ...(brief ? { brief: cap(brief, 30) } : {}), vol });
    }
    if (roster.length) st.world.npcRoster = roster.sort((a, b) => a.vol - b.vol).slice(0, 20);
  }

  // 推荐阶位 = 上一站离世阶位（首站一阶；解析不到则沿用）
  let tier = '一阶';
  for (const s of stations) { s.recommendedTier = tier; tier = s.suxiao.exit.realm || tier; }

  const meta = { generatedAt: new Date().toISOString(), stationCount: stations.length, totalNavWorlds: nav.length };
  const suxiao = { name: '苏晓', defaultAlias: '白夜', persona };

  const ts = `// ⚠ AUTO-GENERATED by tools/build-canon-route.mjs — 手改无效；改 wiki 或脚本后重跑 \`npm run build-canon-route\`
import type { CanonRouteMeta, CanonStation, CanonSuxiao } from './canonRouteTypes';

export const CANON_ROUTE_META: CanonRouteMeta = ${JSON.stringify(meta, null, 2)};

export const CANON_SUXIAO: CanonSuxiao = ${JSON.stringify(suxiao, null, 2)};

export const CANON_STATIONS: CanonStation[] = ${JSON.stringify(stations, null, 2)};
`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, ts, 'utf8');

  console.log(`\n✓ 写出 ${path.relative(process.cwd(), OUT)}（${(ts.length / 1024).toFixed(1)} KB）\n`);
  for (const l of logs) {
    const s = stations.find((x) => x.id === l.id);
    console.log(`— ${String(s.order).padStart(2)}. ${s.name} [${s.stationType}·${s.volume}卷·荐${s.recommendedTier}]`);
    console.log(`   锚点${l.phases}  主线:${s.world.mainMission ? '✓' : '✗'}  时间点:${s.world.era ? '✓' : '✗'}  规则:${s.world.rules ? '✓' : '✗'}  结算:${s.suxiao.settle?.sourcePct ?? '?'}%/${s.suxiao.settle?.rating ?? '?'}  定格:Lv${s.suxiao.exit.lv ?? '?'}·${s.suxiao.exit.realm ?? '?'}·六维${s.suxiao.exit.attrs ? '✓' : '✗'}  乐园后记:${s.suxiao.paradiseAfter ? '✓' : '✗'}  名册:${s.world.npcRoster?.length ?? 0}人`);
    if (s.world.npcRoster?.length) console.log(`   👥 ${s.world.npcRoster.map((r) => `${r.name}(卷${r.vol})`).join('、')}`);
    console.log(`   小节分类: ${l.secs.join(' / ')}`);
  }
}
main();
