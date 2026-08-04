import type { WorldRecord, WorldSummary } from '../store/worldRecordStore';
import type { Deed } from '../store/characterStore';

/* ════════════════════════════════════════════
   编年史 · 史料聚合引擎（📜 传奇模式，纯逻辑无 React）

   【史观】当朝为实录、前朝才有正史 ——
   · 实录（raw）：当前世界进行中，直接投影既有数据源，不花 API、不落库
   · 正史（compiled）：世界结算/离世后由 AI 一次「删繁就简」编纂，落进 chronicleStore
   两者在 UI 上并存：已编纂的卷显示正史，未编纂的卷显示实录 + 「修史」按钮。

   【骨架】三层，不是一条流水：
   · 卷 = WorldRecord（一个世界一卷，有进出回合/评级/离世总结，无上限随存档）
   · 页 = chronicle 纪要表（AI 每回合写的 时间/地点/事件，无上限随存档）
   · 注 = deedLog / 归档任务 / 丰碑（挂在卷上的旁证）

   【分卷】纪要表本身没有回合号（它的「时间」列是游戏内时间，对史书而言比回合号更好用）。
   分卷靠 chronicleStore 旁路记的 rowMeta（row_id → turn/world），
   老存档没有 rowMeta → 优雅降级到「散佚卷」，绝不丢数据。

   ⚠ 本引擎只做**投影与判定**，不写任何 store；所有数据源以参数传入，便于单测。
════════════════════════════════════════════ */

/** 重要性三级：金=里程碑、银=事件、灰=日常流水（默认折叠）。 */
export type ChronicleTier = 'gold' | 'silver' | 'gray';

export type ChronicleKind =
  | 'worldEnter' | 'worldLeave'      // 卷首尾
  | 'chronicleRow'                   // 纪要行（实录主体）
  | 'keyEvent'                       // 离世总结里的关键事件
  | 'outcome'                        // 人物结局
  | 'deed'                           // 人物事迹（deedLog）
  | 'questSettle'                    // 归档任务结算
  | 'monument'                       // 入碑（跨存档·只进「前尘」视图）
  | 'compiled';                      // AI 编纂产出的正史条目

export interface ChronicleEntityRef {
  type: 'npc' | 'faction' | 'world' | 'player';
  id?: string;
  name: string;
}

export interface ChronicleEvent {
  id: string;
  kind: ChronicleKind;
  tier: ChronicleTier;
  turn?: number;         // 技术排序键（可能缺；缺时靠 order）
  order: number;         // 卷内稳定序（纪要行 row_id / 数组下标）
  timeText?: string;     // 游戏内时间 —— **史书正文显示用这个**，不是 turn
  location?: string;
  world?: string;
  title: string;
  detail?: string;
  entities?: ChronicleEntityRef[];
}

export interface ChronicleVolume {
  id: string;                  // WorldRecord.id；散佚卷 = '__orphan__'
  world: string;
  tier?: string;               // 世界阶位
  instanceId?: number;         // 同名世界第几次进
  fromInstance?: string;       // 继承链
  status: 'draft' | 'active' | 'left' | 'orphan';
  enterTurn?: number;
  leaveTurn?: number;
  rating?: string;             // 综合评价 E- ~ SSS
  events: ChronicleEvent[];
  summary?: WorldSummary;
  compiled: boolean;           // 是否已修成正史
}

/* ── 一、重要性判定（确定性关键词表·不花 API）───────────────
   金 = 生死/突破/通关/缔约/覆灭这类改变格局的事；银 = 战斗/结识/交易/任务这类值得记一笔的事；其余为灰。
   ⚠ 判定只看文本，宁可漏判为灰（灰默认折叠、不丢数据），不要滥判为金（金太多等于没有金）。 */
const GOLD_WORDS = [
  // 生死（本作战斗为主，杀伐的说法多，别只认「击杀」——「斩杀」「诛」这类漏判会让一卷史事全是灰）
  '死', '殒', '殒命', '陨落', '陨', '战死', '身亡', '丧命', '亡故', '牺牲',
  '击杀', '斩杀', '诛杀', '诛灭', '杀死', '处决', '灭杀', '重创致死',
  '覆灭', '灭族', '毁灭', '全灭',
  '突破', '晋升', '晋阶', '进阶', '觉醒', '通关', '结算', '离世', '离开世界',
  '缔约', '契约', '结拜', '背叛', '反目', '决裂', '告白', '成婚',
  '传说级', '史诗级', '圣灵级', '不朽级', '起源', '永恒', '创世',
];
const SILVER_WORDS = [
  '战', '交战', '击败', '战胜', '败于', '重伤', '负伤', '受伤', '濒死',
  '结识', '相遇', '初遇', '加入', '招募', '合作', '结盟', '谈判',
  '交易', '购入', '卖出', '夺取', '获得', '取得', '完成任务', '任务',
  '晋级', '升级', '学会', '习得', '解锁',
];

export function classifyText(text: string): ChronicleTier {
  const s = String(text ?? '');
  if (!s.trim()) return 'gray';
  for (const w of GOLD_WORDS) if (s.includes(w)) return 'gold';
  for (const w of SILVER_WORDS) if (s.includes(w)) return 'silver';
  return 'gray';
}

export const TIER_ORDER: Record<ChronicleTier, number> = { gold: 0, silver: 1, gray: 2 };
export const TIER_LABEL: Record<ChronicleTier, string> = { gold: '里程碑', silver: '纪事', gray: '日常' };

/* ── 二、实体互链（扫已知人名/势力名，点得进去）───────────── */

/** 在文本里扫出已知实体。名字短于 2 字的跳过（"王""李"这种会满篇误命中）。 */
export function extractEntities(
  text: string,
  known: { npcs?: { id: string; name: string }[]; factions?: { id: string; name: string }[]; playerName?: string },
): ChronicleEntityRef[] {
  const s = String(text ?? '');
  if (!s) return [];
  const out: ChronicleEntityRef[] = [];
  const seen = new Set<string>();
  const push = (r: ChronicleEntityRef) => { const k = `${r.type}:${r.name}`; if (!seen.has(k)) { seen.add(k); out.push(r); } };
  for (const n of known.npcs ?? []) if (n.name && n.name.length >= 2 && s.includes(n.name)) push({ type: 'npc', id: n.id, name: n.name });
  for (const f of known.factions ?? []) if (f.name && f.name.length >= 2 && s.includes(f.name)) push({ type: 'faction', id: f.id, name: f.name });
  if (known.playerName && known.playerName.length >= 2 && s.includes(known.playerName)) push({ type: 'player', id: 'B1', name: known.playerName });
  return out.slice(0, 8);
}

/* ── 三、数据源入参（全部可选：缺哪个就少一类事件，绝不报错）── */

/** 纪要表一行（useTables.rows('chronicle') 的行对象形态）。 */
export interface ChronicleRow { row_id?: string; 时间?: string; 地点?: string; 事件?: string; [k: string]: string | undefined }
/** 纪要行旁路索引（chronicleStore.rowMeta：分卷靠它）。 */
export interface RowMeta { turn?: number; world?: string }

export interface ChronicleSources {
  rows?: ChronicleRow[];                       // 纪要表全部行
  rowMeta?: Record<string, RowMeta>;           // row_id → {turn, world}
  records?: WorldRecord[];                     // 世界记录（卷骨架）
  archivedTasks?: { id?: string; name?: string; title?: string; settledAt?: number; worldName?: string; reward?: string }[];
  deeds?: { owner: string; ownerId?: string; log: Deed[] }[];   // 人物事迹（玩家 + 各 NPC）
  known?: { npcs?: { id: string; name: string }[]; factions?: { id: string; name: string }[]; playerName?: string };
  compiledIds?: string[];                      // 已修成正史的卷 id
  currentWorld?: string;                       // 当前世界名（给 active 卷兜底分卷）
  currentTurn?: number;
}

/* ── 四、分卷 ─────────────────────────────────────────── */

export const ORPHAN_VOLUME = '__orphan__';

/** 一条纪要行归哪一卷：优先按 turn 落进 [enterTurn, leaveTurn] 区间，其次按世界名，都没有则散佚。 */
export function volumeIdForRow(meta: RowMeta | undefined, records: WorldRecord[], currentWorld?: string): string {
  const turn = meta?.turn;
  if (typeof turn === 'number') {
    for (const r of records) {
      const a = r.enteredAt?.turn;
      const b = r.leftAt?.turn;
      if (typeof a === 'number' && turn >= a && (typeof b !== 'number' || turn <= b)) return r.id;
    }
  }
  if (meta?.world) {
    const hit = records.find((r) => r.name === meta.world);
    if (hit) return hit.id;
  }
  if (!meta && currentWorld) {
    // 老存档的行完全没有 meta：如果只有一卷 active，宁可归给它也别丢进散佚
    const active = records.find((r) => r.status === 'active' && r.name === currentWorld);
    if (active && records.length === 1) return active.id;
  }
  return ORPHAN_VOLUME;
}

/** 主入口：把所有史料源投影成按卷分组的编年史（新卷在前）。 */
export function buildVolumes(src: ChronicleSources): ChronicleVolume[] {
  const records = (src.records ?? []).filter((r) => r && r.id);
  const compiled = new Set(src.compiledIds ?? []);
  const byId = new Map<string, ChronicleVolume>();

  for (const r of records) {
    byId.set(r.id, {
      id: r.id, world: r.name, tier: r.tier, instanceId: r.instanceId, fromInstance: r.fromInstance,
      status: r.status === 'draft' || r.status === 'active' || r.status === 'left' ? r.status : 'left',
      enterTurn: r.enteredAt?.turn, leaveTurn: r.leftAt?.turn,
      rating: r.summary?.综合评价, summary: r.summary, compiled: compiled.has(r.id), events: [],
    });
  }
  const orphan = (): ChronicleVolume => {
    let v = byId.get(ORPHAN_VOLUME);
    if (!v) {
      v = { id: ORPHAN_VOLUME, world: '散佚残卷', status: 'orphan', compiled: false, events: [] };
      byId.set(ORPHAN_VOLUME, v);
    }
    return v;
  };
  const put = (volId: string, ev: ChronicleEvent) => (byId.get(volId) ?? orphan()).events.push(ev);

  // ① 卷首尾：进入/离开世界
  for (const r of records) {
    const v = byId.get(r.id)!;
    if (typeof r.enteredAt?.turn === 'number' || r.enteredAt?.worldTime) {
      v.events.push({
        id: `${r.id}:enter`, kind: 'worldEnter', tier: 'gold', turn: r.enteredAt?.turn, order: -1,
        timeText: r.enteredAt?.worldTime, world: r.name,
        title: `踏入${r.name}`,
        detail: [r.tier && `世界阶位 ${r.tier}`, r.instanceId && r.instanceId > 1 ? `第 ${r.instanceId} 次进入` : ''].filter(Boolean).join(' · ') || undefined,
        entities: [{ type: 'world', id: r.id, name: r.name }],
      });
    }
    if (r.status === 'left') {
      v.events.push({
        id: `${r.id}:leave`, kind: 'worldLeave', tier: 'gold', turn: r.leftAt?.turn, order: Number.MAX_SAFE_INTEGER,
        timeText: r.leftAt?.worldTime, world: r.name,
        title: `离开${r.name}`,
        detail: [r.summary?.状态, r.summary?.综合评价 && `综合评价 ${r.summary.综合评价}`].filter(Boolean).join(' · ') || undefined,
        entities: [{ type: 'world', id: r.id, name: r.name }],
      });
    }
  }

  // ② 纪要行（实录主体）
  (src.rows ?? []).forEach((row, i) => {
    const text = String(row.事件 ?? '').trim();
    if (!text) return;
    const rowId = String(row.row_id ?? i + 1);
    const meta = src.rowMeta?.[rowId];
    const volId = volumeIdForRow(meta, records, src.currentWorld);
    put(volId, {
      id: `cr:${rowId}`, kind: 'chronicleRow', tier: classifyText(text),
      turn: meta?.turn, order: Number(rowId) || i,
      timeText: String(row.时间 ?? '').trim() || undefined,
      location: String(row.地点 ?? '').trim() || undefined,
      world: meta?.world,
      title: text.length > 42 ? text.slice(0, 42) + '…' : text,
      detail: text.length > 42 ? text : undefined,
      entities: extractEntities(text, src.known ?? {}),
    });
  });

  // ③ 离世总结里的关键事件 / 人物结局（已是 AI 提炼过的，天然是金银料）
  for (const r of records) {
    const v = byId.get(r.id)!;
    (r.summary?.关键事件 ?? []).forEach((k, i) => {
      const body = [k.结果 && `结果：${k.结果}`, k.影响 && `影响：${k.影响}`].filter(Boolean).join('　');
      v.events.push({
        id: `${r.id}:key:${i}`, kind: 'keyEvent', tier: 'gold', turn: r.leftAt?.turn,
        order: Number.MAX_SAFE_INTEGER - 1000 + i, world: r.name,
        title: k.事件, detail: body || undefined,
        entities: extractEntities(`${k.事件}${body}`, src.known ?? {}),
      });
    });
    (r.summary?.人物结局 ?? []).forEach((p, i) => {
      v.events.push({
        id: `${r.id}:fate:${i}`, kind: 'outcome', tier: 'silver', turn: r.leftAt?.turn,
        order: Number.MAX_SAFE_INTEGER - 500 + i, world: r.name,
        title: `${p.名称}的结局`,
        detail: [p.结局, p.关系 && `（${p.关系}）`].filter(Boolean).join(''),
        entities: extractEntities(p.名称, src.known ?? {}),
      });
    });
  }

  // ④ 归档任务（有 settledAt 时间戳，但没有 turn；按世界名归卷）
  (src.archivedTasks ?? []).forEach((t, i) => {
    const name = t.name || t.title || '';
    if (!name) return;
    const hit = records.find((r) => r.name && r.name === t.worldName);
    put(hit?.id ?? ORPHAN_VOLUME, {
      id: `qt:${t.id ?? i}`, kind: 'questSettle', tier: 'silver',
      order: Number.MAX_SAFE_INTEGER - 400 + i, world: t.worldName,
      title: `了结任务「${name}」`, detail: t.reward || undefined,
    });
  });

  // ⑤ 人物事迹（deedLog）。autonomy 写的 time 形如「第N回合」→ 抽出来当排序键。
  for (const d of src.deeds ?? []) {
    (d.log ?? []).forEach((deed, i) => {
      const text = String(deed.description ?? '').trim();
      if (!text) return;
      const turn = turnFromDeedTime(deed.time);
      const volId = volumeIdForRow({ turn }, records, src.currentWorld);
      put(volId, {
        id: `deed:${d.ownerId ?? d.owner}:${i}:${deed.addedAt ?? 0}`, kind: 'deed',
        tier: classifyText(text), turn, order: deed.addedAt ?? i,
        timeText: deed.time || undefined, location: deed.location || undefined,
        title: `${d.owner}：${text.length > 34 ? text.slice(0, 34) + '…' : text}`,
        detail: text.length > 34 ? text : undefined,
        entities: [
          ...(d.ownerId ? [{ type: 'npc' as const, id: d.ownerId, name: d.owner }] : []),
          ...extractEntities(text, src.known ?? {}),
        ].slice(0, 8),
      });
    });
  }

  // 卷内排序：turn 优先，其次 order；卷间：新卷在前，散佚垫底
  const vols = [...byId.values()];
  for (const v of vols) {
    v.events.sort((a, b) => {
      const at = a.turn ?? Number.NaN; const bt = b.turn ?? Number.NaN;
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      return a.order - b.order;
    });
  }
  return vols.sort((a, b) => {
    if (a.id === ORPHAN_VOLUME) return 1;
    if (b.id === ORPHAN_VOLUME) return -1;
    return (b.enterTurn ?? 0) - (a.enterTurn ?? 0);
  });
}

/** 「第47回合」/「T47」/「回合 47」→ 47；认不出返回 undefined。 */
export function turnFromDeedTime(time?: string): number | undefined {
  const s = String(time ?? '');
  const m = s.match(/第\s*(\d+)\s*回合/) || s.match(/\bT\s*(\d+)\b/i) || s.match(/回合\s*(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
}

/* ── 五、切入点：本卷之最（自动挖掘·给玩家"值得翻这一页"的理由）──
   ⚠ 只用**可靠数据源**（卷内事件统计 + 离世总结），不从残缺日志硬造"最惨烈一战"这类结论。 */

export interface VolumeDigest { icon: string; label: string; value: string }

export function digestVolume(v: ChronicleVolume): VolumeDigest[] {
  const out: VolumeDigest[] = [];
  const gold = v.events.filter((e) => e.tier === 'gold').length;
  const span = typeof v.enterTurn === 'number' && typeof v.leaveTurn === 'number' ? v.leaveTurn - v.enterTurn : undefined;

  if (v.rating) out.push({ icon: '🏅', label: '综合评价', value: v.rating });
  if (span != null && span >= 0) out.push({ icon: '⏳', label: '停留', value: `${span} 回合` });
  else if (v.summary?.停留时长?.回合数) out.push({ icon: '⏳', label: '停留', value: `${v.summary.停留时长.回合数} 回合` });
  out.push({ icon: '📖', label: '史事', value: `${v.events.length} 条 · 里程碑 ${gold}` });

  // 同行最久：卷内出现次数最多的 NPC
  const tally = new Map<string, number>();
  for (const e of v.events) for (const en of e.entities ?? []) if (en.type === 'npc') tally.set(en.name, (tally.get(en.name) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 2) out.push({ icon: '👤', label: '同行最多', value: `${top[0]}（${top[1]} 次）` });

  const s = v.summary;
  if (s?.收获?.世界之源) out.push({ icon: '🌐', label: '世界之源', value: s.收获.世界之源 });
  if (s?.代价?.length) out.push({ icon: '🩸', label: '代价', value: s.代价[0] });
  if (s?.未了伏笔?.length) out.push({ icon: '🕯', label: '未了', value: `${s.未了伏笔.length} 条伏笔` });
  return out;
}

/** 全史概览（本纪首屏）。 */
export function overallDigest(vols: ChronicleVolume[]): VolumeDigest[] {
  const real = vols.filter((v) => v.id !== ORPHAN_VOLUME);
  const cleared = real.filter((v) => v.status === 'left').length;
  const events = vols.reduce((n, v) => n + v.events.length, 0);
  const gold = vols.reduce((n, v) => n + v.events.filter((e) => e.tier === 'gold').length, 0);
  const out: VolumeDigest[] = [
    { icon: '📚', label: '历世', value: `${real.length} 卷（已了结 ${cleared}）` },
    { icon: '📖', label: '史事', value: `${events} 条` },
    { icon: '⭐', label: '里程碑', value: `${gold} 条` },
  ];
  const rated = real.map((v) => v.rating).filter(Boolean) as string[];
  if (rated.length) out.push({ icon: '🏅', label: '评价', value: rated.join(' / ') });
  return out;
}

/* ── 六、编纂：把一卷实录压成给 AI 的输入（删繁就简的原料）── */

/** 编纂输入：只送**灰+银**的流水（金料已经是提炼过的，让 AI 原样保留即可），并硬限行数防超 token。 */
export function buildCompileInput(v: ChronicleVolume, maxLines = 160): { text: string; count: number } {
  const lines = v.events
    .filter((e) => e.kind === 'chronicleRow' || e.kind === 'deed')
    .map((e) => {
      const head = [e.timeText, e.location].filter(Boolean).join('·');
      return `${head ? `[${head}] ` : ''}${e.detail || e.title}`;
    });
  const kept = lines.length > maxLines ? lines.slice(-maxLines) : lines;   // 超长取最近的（近事更值得细写）
  return { text: kept.join('\n'), count: kept.length };
}

/** AI 编纂产出的一条正史（落库进 chronicleStore.compiled）。 */
export interface CompiledEntry {
  timeText?: string;
  location?: string;
  title: string;
  detail?: string;
  tier: ChronicleTier;
}

/** 「前尘提要」——进入新世界的过场用（P2 读回）：把上一世界的**编纂正史**压成一小段跨世界前情记忆；
    无编纂时回退「离世总结」的评价与经历概述；两者都无 → ''。
    ★此前 compiled 修完只有玩家自己看（全库唯一消费点是 ChroniclePanel）——这里让编年史真正成为 AI 的长期记忆。
    纯函数：数据源全部参数传入（同本文件其余投影函数），便于单测；限长防注入块膨胀。 */
export function buildPriorSaga(
  worldName: string,
  vol?: { entries: CompiledEntry[]; preface?: string } | null,
  summary?: { 综合评价?: string; 状态?: string; 经历概述?: string[]; 世界线偏转?: string } | null,
  maxChars = 400,
): string {
  const parts: string[] = [];
  if (vol && vol.entries?.length) {
    if (vol.preface?.trim()) parts.push(vol.preface.trim());
    // 金档（重大）优先，其次银档；每条只取标题，最多 6 条
    const ranked = [...vol.entries].sort((a, b) => (a.tier === 'gold' ? 0 : a.tier === 'silver' ? 1 : 2) - (b.tier === 'gold' ? 0 : b.tier === 'silver' ? 1 : 2));
    const titles = ranked.slice(0, 6).map((e) => e.title?.trim()).filter(Boolean);
    if (titles.length) parts.push(titles.join('；'));
  } else if (summary) {
    const bits = [
      summary.状态 && `${summary.状态}`,
      summary.综合评价 && `评价 ${summary.综合评价}`,
      summary.经历概述?.length ? summary.经历概述.slice(0, 3).join('；') : '',
      summary.世界线偏转 && `世界线偏转：${summary.世界线偏转}`,
    ].filter(Boolean);
    if (bits.length) parts.push(bits.join('。'));
  }
  if (!parts.length) return '';
  return `【${worldName}】${parts.join('。')}`.slice(0, maxChars);
}

/** 夹取 AI 的编纂产出：条数、字段长度、tier 合法性全部由前端定，绝不采信越界值。 */
export function sanitizeCompiled(raw: any, maxEntries = 40): CompiledEntry[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.entries) ? raw.entries : [];
  const txt = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return arr.slice(0, maxEntries).map((e: any): CompiledEntry => ({
    timeText: txt(e?.timeText ?? e?.时间, 40) || undefined,
    location: txt(e?.location ?? e?.地点, 40) || undefined,
    title: txt(e?.title ?? e?.事件, 80) || '（无题）',
    detail: txt(e?.detail ?? e?.详述, 300) || undefined,
    tier: e?.tier === 'gold' || e?.tier === 'silver' || e?.tier === 'gray' ? e.tier : classifyText(txt(e?.title ?? e?.事件, 80)),
  })).filter((e: CompiledEntry) => e.title && e.title !== '（无题）');
}

/** 正史条目 → 展示用事件（与实录同构，UI 一套渲染两态）。 */
export function compiledToEvents(entries: CompiledEntry[], volId: string, world?: string): ChronicleEvent[] {
  return entries.map((e, i) => ({
    id: `cp:${volId}:${i}`, kind: 'compiled' as const, tier: e.tier, order: i,
    timeText: e.timeText, location: e.location, world,
    title: e.title, detail: e.detail,
  }));
}
