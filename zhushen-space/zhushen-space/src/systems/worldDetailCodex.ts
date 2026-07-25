/* 世界详情档案 → 悬浮图鉴词条（2026-07-25）
   ─────────────────────────────────────────────────────────────────────────────
   把当前世界 `·剧情` 档案里的【主要人物】【贵重物品】两段，解析成悬浮图鉴的词条。

   动机：人物段按工坊配额要写 ~2500 字，但正文注入受 WORLD_DETAIL_BUDGET + 分层引擎压制，
   每回合只放得下 4~5 千字，人物细节大部分挤不进去。悬浮图鉴是纯渲染层、不占 token，
   正好接住这批「预算装不下但玩家会想查」的信息。

   ⚠ 只吃这两段。【世界剧情线】【隐藏剧情·伏笔】一律不碰——worldDetailInject 的阶段门控
   （未来阶段 + 隐藏剧情对正文不可见）是治「抢进度/泄底」的，悬浮卡不能从背后把它绕过去。

   ⚠ 与 systems/worldCodex.ts（AI 联网生成的「世界百科」）无关：那个是玩家在游戏内按模块
   调 API 生成的自由文本，结构不保证；这里吃的是工坊手写、README 强制格式的静态档案。

   ⚠ 纯函数、不碰 store/网络，方便单测。解析目标是工坊 README 强制的两种行格式：
     人物：`- **克莱恩·莫雷蒂/愚者（周明瑞）**｜谨慎幽默重责任；马甲夏洛克、格尔曼。弧光：…`
           `- 孟浩（主角）｜性格：隐忍护短｜装备·能力：铜镜｜人物弧光：穷书生→山海星空之主`
     宝物：`- 铜镜（照妖镜）：全书第一至宝，苍茫老祖为灵宠鹦鹉所造…` */

export interface WorldCodexLite {
  id: string;
  name: string;
  aliases: string[];
  meta?: string;
  lines: string[];
  kind: 'wchar' | 'witem';
}

/** 取 `**【节名】**` 到下一个 `**【` 之间的正文块；没有该节 → ''。 */
export function sectionOf(plot: string, title: string): string {
  const head = `**【${title}】**`;
  const i = plot.indexOf(head);
  if (i < 0) return '';
  const from = i + head.length;
  const j = plot.indexOf('**【', from);
  return (j < 0 ? plot.slice(from) : plot.slice(from, j)).trim();
}

const strip = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/** 「马甲夏洛克、格尔曼」「又名：X/Y」这类行内别名——中文原著里极常见，抽出来能大幅提升召回。 */
function inlineAliases(body: string): string[] {
  const out: string[] = [];
  const re = /(?:马甲|别名|又名|化名|本名|原名|化身)[:：]?\s*([^。；;｜|]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    for (const a of m[1].split(/[、,，\/／]/)) {
      const s = strip(a);
      if (s) out.push(s);
    }
  }
  return out;
}

/** 名字段 → 主名 + 别名。`克莱恩·莫雷蒂/愚者（周明瑞）` → 克莱恩·莫雷蒂 + [愚者, 周明瑞] */
function splitName(rawName: string): { name: string; aliases: string[] } {
  const aliases: string[] = [];
  // 括号内容：可能是本名（周明瑞）、塔罗代号（正义）、身份（主角）——一律当别名收，
  // 「主角」这类由 codexIndex.usableName 的停用词表挡掉，这里不重复判断。
  const s = strip(rawName).replace(/[（(]([^）)]+)[）)]/g, (_m, inner: string) => {
    for (const a of String(inner).split(/[、,，\/／]/)) {
      const t = strip(a);
      if (t) aliases.push(t);
    }
    return '';
  });
  const segs = s.split(/[\/／]/).map(strip).filter(Boolean);
  const name = segs.shift() ?? '';
  aliases.push(...segs);
  return { name, aliases };
}

/** 描述 → 短句数组；含「弧光」的排到最后——它天然是全程剧透，靠 codexIndex 的 LINE_MAX 自然挤掉。 */
function toLines(body: string): string[] {
  const parts: string[] = [];
  for (const seg of body.split(/[｜|]/)) {
    for (const s of seg.split(/[；;。]/)) {
      const t = strip(s);
      if (t) parts.push(t);
    }
  }
  const arc = (s: string) => /弧光/.test(s);
  return [...parts.filter((s) => !arc(s)), ...parts.filter(arc)];
}

/** 逐行取 `- xxx` 条目（跳过工坊模板里的 `（正式产出…）` 说明行）。 */
function bulletsOf(block: string): string[] {
  const out: string[] = [];
  for (const raw of block.split('\n')) {
    const m = raw.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!m) continue;
    if (/^[（(]正式产出/.test(strip(m[1]))) continue;
    out.push(m[1]);
  }
  return out;
}

/**
 * 解析一个世界的 `·剧情` 全文 → 悬浮词条。
 * @param plot 世界详情 `·剧情` 正文
 * @param worldName 世界名（进 meta，让玩家一眼知道这条是哪个世界的原著设定）
 */
export function parseWorldDetailCodex(plot: string, worldName: string): WorldCodexLite[] {
  const out: WorldCodexLite[] = [];
  const seen = new Set<string>();
  const push = (kind: WorldCodexLite['kind'], name: string, aliases: string[], lines: string[]) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({
      id: `${worldName}/${name}`,
      name,
      aliases: [...new Set(aliases.filter((a) => a && a !== name))],
      meta: `原著 · ${worldName}`,
      lines,
      kind,
    });
  };

  // ① 主要人物：`- **名（别名）**｜描述`
  for (const line of bulletsOf(sectionOf(plot, '主要人物'))) {
    const cut = line.search(/[｜|]/);
    const { name, aliases } = splitName(cut < 0 ? line : line.slice(0, cut));
    const body = cut < 0 ? '' : line.slice(cut + 1);
    push('wchar', name, [...aliases, ...inlineAliases(body)], toLines(body));
  }

  // ② 贵重物品：`- 名（别名）：描述`——分隔符是全角冒号，不是 ｜
  for (const line of bulletsOf(sectionOf(plot, '贵重物品'))) {
    const cut = line.search(/[：:]/);
    const { name, aliases } = splitName(cut < 0 ? line : line.slice(0, cut));
    const body = cut < 0 ? '' : line.slice(cut + 1);
    push('witem', name, [...aliases, ...inlineAliases(body)], toLines(body));
  }

  return out;
}
