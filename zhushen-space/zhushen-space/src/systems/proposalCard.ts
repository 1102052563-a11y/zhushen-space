import { useMisc, type MiscTask, type QuestRing } from '../store/miscStore';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { useCalendar } from '../store/calendarStore';
import { lenientJsonParse } from './stateParser';
import { FORESHADOW_UID, threadInCurrentWorld } from './plotThreads';
import { useRowScope } from '../store/rowScopeStore';
import { TYPE_META, visibleIn, type AlmanacType } from './calendar';

/* ══════════ 提案卡（AI 出卡 → 玩家点「应用」才落库）══════════
   借鉴 ST-SevenDaysCal「构画」最值得抄的一条机制：局外顾问给的东西**不自动生效**，
   渲染成卡片让玩家挑，点「应用」才写进存档。与自动演化阶段互补——
   演化是「AI 替你记账」，提案卡是「你想加点什么，让 AI 帮你拟稿」。

   协议（全 ASCII 标签，避开预设里 <> 转义的坑）：
     <proposal kind="quest|thread|almanac" ref="可选·要改的既有条目 id">
     { …JSON… }
     </proposal>
   解析一律走 lenientJsonParse（容忍裸键/单引号/尾逗号）。

   ⚠ 三条铁则：
   ① **不自动落库**：parse 只产出待选卡片，唯一写库入口是 applyProposal（玩家点击触发）。
   ② **历史卡片喂回 AI 前必须 stripProposalsForApi**：否则模型会照抄自己上一轮的旧卡片
      （参考插件踩过这个坑，用占位符替换解决）。
   ③ 落库走各自 store 的**既有** action，不另开写入通道——闸门/判重/夹取都复用原有的。 */

export type ProposalKind = 'quest' | 'thread' | 'almanac';
export const PROPOSAL_KINDS: ProposalKind[] = ['quest', 'thread', 'almanac'];

export const KIND_META: Record<ProposalKind, { label: string; glyph: string }> = {
  quest:   { label: '任务', glyph: '🎯' },
  thread:  { label: '伏笔', glyph: '🕯' },
  almanac: { label: '历',   glyph: '🗓' },
};

export interface Proposal {
  id: string;                        // 本地渲染用（消息内序号）
  kind: ProposalKind;
  ref?: string;                      // 要改的既有条目 id（任务 T_n / 伏笔 row_id / 历 alm_x）；空=新增
  data: Record<string, unknown>;
  raw: string;                       // 原始 JSON 文本（应用失败时可展示排错）
}

const CARD_RE = /<proposal\s+([^>]*)>([\s\S]*?)<\/proposal\s*>/gi;

function attr(attrs: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
  return m ? m[1].trim() : '';
}

/** 从 AI 回复里剥出提案卡；返回去掉卡片后的正文 + 解析出的卡片列表。认不出 kind 的整块丢弃。 */
export function parseProposals(reply: string, msgKey = ''): { text: string; cards: Proposal[] } {
  const cards: Proposal[] = [];
  let i = 0;
  const text = String(reply ?? '').replace(CARD_RE, (_all, attrs: string, body: string) => {
    const kind = attr(attrs, 'kind').toLowerCase() as ProposalKind;
    if (!PROPOSAL_KINDS.includes(kind)) return '';
    const data = lenientJsonParse(String(body).trim());
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
    cards.push({
      id: `${msgKey}#${i++}`,
      kind,
      ref: attr(attrs, 'ref') || undefined,
      data: data as Record<string, unknown>,
      raw: String(body).trim(),
    });
    return '';
  }).trim();
  return { text, cards };
}

/** 历史消息喂回 AI 前：把卡片块换成占位符。**防模型照抄旧卡片**（内容已可能被玩家改过或没应用）。 */
export function stripProposalsForApi(content: string): string {
  return String(content ?? '').replace(CARD_RE, (_all, attrs: string) => {
    const kind = attr(attrs, 'kind').toLowerCase() as ProposalKind;
    const label = KIND_META[kind]?.label ?? '';
    return `【此处曾给出一张${label}提案卡；它是否被采纳、当前内容如何，一律以下方的现状清单为准】`;
  });
}

// ─── 展示摘要（卡片正面几行）──────────────────────────────────────────────────

function str(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

export interface ProposalLine { label: string; value: string }

/** 卡片正面要展示的字段行（按 kind 取，空字段自动省略）。 */
export function proposalLines(p: Proposal): ProposalLine[] {
  const d = p.data;
  if (p.kind === 'quest') {
    const rings = Array.isArray(d.rings) ? (d.rings as Record<string, unknown>[]) : [];
    return [
      { label: '名称', value: str(d, 'name', '名称') },
      { label: '类型', value: str(d, 'kind', '类型') || '支线' },
      { label: '简述', value: str(d, 'desc', '描述', '简述') },
      { label: '终局', value: str(d, 'finale', '终局') },
      { label: '奖励', value: str(d, 'reward', '奖励') },
      { label: '惩罚', value: str(d, 'penalty', '惩罚') },
      { label: '环', value: rings.map((r, i) => `${i + 1}.${str(r, 'goal', '目标')}`).filter((s) => s.length > 2).join('　') },
    ].filter((l) => l.value);
  }
  if (p.kind === 'thread') {
    return [
      { label: '伏笔', value: str(d, 'title', '伏笔', 'name') },
      { label: '涉及', value: str(d, 'obj', '涉及对象', '涉及') },
      { label: '预期回收', value: str(d, 'expect', '预期回收') },
      { label: '说明', value: str(d, 'note', '说明', 'desc') },
    ].filter((l) => l.value);
  }
  const t = str(d, 'type', '类型') as AlmanacType;
  const meta = TYPE_META[t] ?? TYPE_META.custom;
  const days = Number(d.days ?? 1) || 1;
  return [
    { label: '名称', value: str(d, 'name', '名称') },
    { label: '类型', value: meta.label },
    { label: '日期', value: `${Number(d.month) || 1}月${Number(d.day) || 1}日${days > 1 ? `（共${days}天）` : ''}${str(d, 'displayDate', '本地写法') ? ` · ${str(d, 'displayDate', '本地写法')}` : ''}` },
    { label: '说明', value: str(d, 'note', '说明') },
    { label: '归属', value: str(d, 'world', '世界') || '跨世界' },
  ].filter((l) => l.value);
}

// ─── 落库（唯一写入入口·玩家点击才调用）──────────────────────────────────────

function ringsFrom(raw: unknown): QuestRing[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: QuestRing[] = [];
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const o = r as Record<string, unknown>;
    const goal = str(o, 'goal', '目标');
    if (!goal) return;
    const st = String(o.status ?? '').trim();
    out.push({
      idx: Number.isFinite(Number(o.idx)) ? Number(o.idx) : i + 1,
      goal,
      status: /^(active|进行中|当前)$/i.test(st) ? 'active' : /^(done|已完成|完成)$/i.test(st) ? 'done' : 'planned',
      reward: str(o, 'reward', '奖励') || undefined,
      hint: str(o, 'hint', '提示') || undefined,
    });
  });
  if (!out.length) return undefined;
  if (!out.some((r) => r.status === 'active')) out[0].status = 'active';   // 至少有一环在跑，否则面板显示不出当前环
  return out.slice(0, 12);
}

// ─── 现状清单（喂给参谋：让它知道已有什么、能引用 id 改哪条）──────────────────

/** 参谋的「存档现状」上下文。逐条带 id，AI 才能用 ref="T_3" 精确改某条而不是重复新建。 */
export function buildAdvisorContext(): string {
  const M = useMisc.getState();
  const parts: string[] = [];
  const bits = [M.worldName && `世界：${M.worldName}`, M.worldTime && `世界时间：${M.worldTime}`, M.paradiseTime && `乐园时间：${M.paradiseTime}`, M.weather && `天气：${M.weather}`].filter(Boolean);
  if (bits.length) parts.push(`【当前时空】${bits.join('｜')}`);

  const tasks = M.tasks ?? [];
  parts.push(tasks.length
    ? `【进行中任务·带 id】\n${tasks.map((t) => {
      const ring = t.rings?.find((r) => r.idx === t.currentRing) ?? t.rings?.find((r) => r.status === 'active');
      return `- ${t.id}｜${t.kind === '主线' ? '主线' : '支线'}「${t.name}」${ring ? `·当前环 ${ring.idx}：${ring.goal}` : ''}${t.locked ? '·已锁定' : ''}`;
    }).join('\n')}`
    : '【进行中任务】（无）');

  try {
    const rows: string[][] = useTables.getState().tables[FORESHADOW_UID]?.content?.slice(1) ?? [];
    // 同 <伏笔催收> 口径：剔终态 + 剔别的任务世界埋的线（worldScope 铁则）
    const live = rows.filter((r) => !/已回收|已废弃/.test(String(r?.[4] ?? '')) && threadInCurrentWorld(String(r?.[0] ?? ''), M.worldName));
    parts.push(live.length
      ? `【未回收伏笔·带 row_id】\n${live.map((r) => `- ${r[0]}｜「${r[1]}」·${r[4] || '埋下'}${r[5] ? `·预期回收：${r[5]}` : ''}`).join('\n')}`
      : '【未回收伏笔】（无）');
  } catch { /* 表不可用则整段略过 */ }

  // ⚠ 必须按世界过滤（worldScope 铁则）：历是 world+paradise 混合作用域，全量倒出来会把
  //   上个任务世界的节日报给参谋，它据此出提案 / 讨论，等于跨世界串味。口径与楼层信息条、历面板一致。
  const alm = visibleIn(useCalendar.getState().items, M.worldName);
  parts.push(alm.length
    ? `【世界历·带 id（只列本世界可见的：本世界专属 + 跨世界）】\n${alm.map((it) => `- ${it.id}｜${it.month}/${it.day}${(it.days ?? 1) > 1 ? `起${it.days}天` : ''} ${TYPE_META[it.type].label}「${it.name}」${it.world ? `·${it.world}` : '·跨世界'}`).join('\n')}`
    : '【世界历】（无）');

  return parts.join('\n\n');
}

export interface ApplyResult { ok: boolean; msg: string }

/** 把一张卡片写进对应 store。**唯一写库入口**，只应由玩家点击触发。 */
export function applyProposal(p: Proposal): ApplyResult {
  try {
    const d = p.data;
    if (p.kind === 'quest') {
      const name = str(d, 'name', '名称');
      if (!name) return { ok: false, msg: '缺名称，没法建任务' };
      const M = useMisc.getState();
      const rings = ringsFrom(d.rings);
      const active = rings?.find((r) => r.status === 'active');
      if (p.ref) {
        const exist = M.tasks.find((t) => t.id === p.ref);
        if (!exist) return { ok: false, msg: `找不到任务 ${p.ref}（可能已结算）` };
        // 玩家主动应用 → 走 editTask（绕过 AI 结构锁，玩家说了算）
        M.editTask(p.ref, {
          name, desc: str(d, 'desc', '描述', '简述'), reward: str(d, 'reward', '奖励'), penalty: str(d, 'penalty', '惩罚'),
          finale: str(d, 'finale', '终局'), endTime: str(d, 'endTime', '截止'),
          ...(rings ? { rings, currentRing: active?.idx ?? rings[0].idx } : {}),
          ...(str(d, 'kind', '类型').includes('主线') ? { kind: '主线' as const } : {}),
        });
        return { ok: true, msg: `已更新任务 ${p.ref}` };
      }
      const id = M.nextTaskId();
      const task: MiscTask = {
        id, name,
        desc: str(d, 'desc', '描述', '简述'),
        reward: str(d, 'reward', '奖励'),
        penalty: str(d, 'penalty', '惩罚'),
        status: '进行中',
        startTime: '', endTime: str(d, 'endTime', '截止'),
        addedAt: Date.now(),
        kind: str(d, 'kind', '类型').includes('主线') ? '主线' : '支线',
        finale: str(d, 'finale', '终局') || undefined,
        ...(rings ? { rings, currentRing: active?.idx ?? rings[0].idx } : {}),
      };
      M.upsertTask(task);
      return { ok: true, msg: `已建任务 ${id}` };
    }

    if (p.kind === 'thread') {
      const title = str(d, 'title', '伏笔', 'name');
      if (!title) return { ok: false, msg: '缺伏笔内容' };
      const T = useTables.getState();
      const row = {
        '伏笔': title,
        '埋下时间': useMisc.getState().worldTime || '',
        '涉及对象': str(d, 'obj', '涉及对象', '涉及'),
        '状态': str(d, 'state', '状态') || '埋下',
        '预期回收': str(d, 'expect', '预期回收'),
        '说明': str(d, 'note', '说明', 'desc'),
      };
      if (p.ref) {
        const i = T.rowIndexById(FORESHADOW_UID, p.ref);
        if (i < 0) return { ok: false, msg: `伏笔表里找不到 row_id=${p.ref}` };
        return T.updateRow(FORESHADOW_UID, i, row) ? { ok: true, msg: `已更新伏笔 #${p.ref}` } : { ok: false, msg: '更新伏笔失败' };
      }
      const idx = T.insertRow(FORESHADOW_UID, row);
      if (idx < 0) return { ok: false, msg: '写入伏笔表失败' };
      // ⚠ 这条路径绕过了 applyTableEdits，它平时负责的两件旁路记录都得在这补上，否则：
      //   ① 不补编辑日志 → 账龄(plotThreads.lastTouchTurn)查无记录＝「久远」，刚埋下就被当陈债催收；
      //   ② 不补世界归属索引 → 这条伏笔成了「不确定」，切世界后仍跟着显示/催收。
      try {
        const M = useMisc.getState();
        const sheet = useTables.getState().tables[FORESHADOW_UID];
        const after = sheet?.content?.[idx + 1] ?? null;
        const newRowId = String(after?.[0] ?? '');
        useTableJournal.getState().record([{
          turn: M.turnCount ?? -1,
          uid: FORESHADOW_UID, sheetName: sheet?.name || '伏笔表',
          command: 'insertRow', rowId: newRowId, pos: idx, before: null, after,
        }]);
        if (newRowId) useRowScope.getState().note(FORESHADOW_UID, newRowId, { turn: M.turnCount ?? undefined, world: M.worldName || undefined });
      } catch { /* 旁路记录写不进不影响已落库的伏笔，静默 */ }
      return { ok: true, msg: '已埋下伏笔' };
    }

    // almanac
    const name = str(d, 'name', '名称');
    if (!name) return { ok: false, msg: '缺名称，没法记进历' };
    // ⚠ world 键**只在 AI 真给了时才带上**：没给就让 store 按当前世界兜底（见 calendarStore.resolveWorld）。
    //   若这里无条件写 world:''，就等于替 AI 宣称「跨世界」，本世界的节日会跟着主角进下一个世界。
    const gaveWorld = 'world' in d || '世界' in d;
    useCalendar.getState().upsert({
      name,
      type: (String(d.type ?? '').trim() || 'custom') as AlmanacType,
      month: Number(d.month) || 1,
      day: Number(d.day) || 1,
      days: Number(d.days) || 1,
      displayDate: str(d, 'displayDate', '本地写法'),
      note: str(d, 'note', '说明'),
      ...(gaveWorld ? { world: str(d, 'world', '世界') } : {}),
    }, p.ref, useMisc.getState().worldName);
    return { ok: true, msg: p.ref ? '已更新历条目' : `已记入历：${name}` };
  } catch (e) {
    return { ok: false, msg: `应用失败：${e instanceof Error ? e.message : String(e)}` };
  }
}
