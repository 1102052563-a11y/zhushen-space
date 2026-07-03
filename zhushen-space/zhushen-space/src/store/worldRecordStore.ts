import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/* ════════════════════════════════════════════════════════════════════
   世界记录 / 世界志（drpg-worldrecord）
   —— 主角经历过的每个衍生世界的「世界观（提前生成的剧情/势力/人物骨架）」
      + 「离世总结（做了什么·获得什么·继承锚点）」。
   · 世界观：进世界时作为 depth 注入到正文最深处（App.tsx）。
   · 同名再入：可选择「继承」上次记录（注文字锚点·续进度）或「重置」（新实例）。
   · 随存档（saveManager 快照 + clearProgress 清空）。
════════════════════════════════════════════════════════════════════ */

// ── 世界观结构（AI 按 WORLDVIEW_GEN_PROMPT 生成·玩家可编辑）──
export interface WorldviewFaction {
  名称: string;
  立场?: string;        // 与主角/世界的立场（盟友/敌对/中立/待定）
  目标?: string;
  战力?: string;        // 与主角阶位相称的势力战力档
  与主角关系?: string;
  关键人物?: string[];
}
export interface WorldviewCharacter {
  名称: string;
  身份?: string;
  性格锚点?: string[];  // 驱动演戏的性格锚点（2-4 条）
  行为特征?: string[];  // 典型行为模式（2-4 条）
  初始态度?: string;    // 对主角的初始态度
  强度档?: string;      // 与主角阶位相称（T0~T9 / 阶位）
  剧情权重?: string;    // 高/中/低 · Boss…
}
export interface WorldviewPlot {
  开局情境?: string;
  主线阶段?: string[];  // 大致主线走向（骨架非剧本）
  关键转折点?: string[];
  可能结局?: string[];
  隐藏线?: string[];    // 伏笔/隐藏线
}
export interface Worldview {
  世界名: string;
  阶位?: string;
  蓝本?: string;
  基调?: string;                // genre / tone
  核心设定?: string[];          // 世界核心法则
  势力?: WorldviewFaction[];
  关键人物?: WorldviewCharacter[];
  剧情走向?: WorldviewPlot;
  主角切入点?: { 初始身份?: string; 初始位置?: string; 初始名声?: string; 与世界的钩子?: string };
  任务预埋?: { 类型?: string; 名称?: string; 评级线索?: string }[];
  氛围与禁忌?: string[];
  行为锚点总纲?: string;        // 世界级行为基调
}

// ── 离世总结结构（AI 按 WORLD_SUMMARY_PROMPT 生成·对齐 wiki 通关快照）──
export interface WorldSummary {
  状态?: string;                // 已通关 / 中途离场 / 失败…
  综合评价?: string;            // E- ~ SSS
  停留时长?: { 世界时间?: string; 回合数?: number };
  经历概述?: string[];          // 编年·主角做了什么
  关键事件?: { 事件: string; 结果?: string; 影响?: string }[];
  世界线偏转?: string;          // 主角造成的世界改变
  人物结局?: { 名称: string; 结局?: string; 关系?: string }[];
  收获?: {
    世界之源?: string; 货币?: string; 属性点?: number;
    装备?: string[]; 技能天赋变化?: string[]; 宝箱?: string[]; 重要物品?: string[];
  };
  代价?: string[];
  未了伏笔?: string[];
  离世定格?: {
    等级阶位?: string; 六维?: string; 核心技能?: string[]; 装备快照?: string; 携出物?: string[]; 随从?: string[];
  };
  继承要点?: {                  // ⭐再入继承时注入的进度锚点
    主角在此世界身份?: string;
    已达世界之源?: string;
    已完成任务?: string[];
    关键NPC现状?: string;
    遗留局势?: string;
    主角名声?: string;
  };
}

export type WorldRecordStatus = 'draft' | 'active' | 'left';

export interface WorldRecord {
  id: string;
  name: string;                 // 世界名（同名再入靠此匹配）
  tier: string;                 // 卡片阶位
  instanceId: number;          // 第几次进这个同名世界（1,2,3…）
  fromInstance?: string;        // 若继承，指向上一实例 id
  cardSnapshot?: Record<string, string>;   // 生成时卡片的原始信息（enterWorld 拼装用/一致性核对）
  worldview?: Worldview;
  status: WorldRecordStatus;
  enteredAt?: { worldTime?: string; turn?: number };
  leftAt?: { worldTime?: string; turn?: number };
  summary?: WorldSummary;
  playerTierAtGen?: string;     // 生成世界观时主角阶位/等级（调试/一致性参考）
  playerLevelAtGen?: number;
  inheritAnchors?: WorldSummary['继承要点'];   // 继承再入：上一实例的「继承要点」文字锚点（注入正文·据此续写）
  // 玩家手动编辑覆盖（存在即取代自动格式化文本·用于注入+展示；清空=恢复自动版）：
  worldviewText?: string;        // 世界观骨架（覆盖 formatWorldviewForInjection·影响注入）
  inheritAnchorsText?: string;   // 继承·上次进度（覆盖 formatInheritAnchors·影响注入）
  summaryText?: string;          // 离世总结（仅展示·覆盖 formatSummary）
  createdAt: number;
  updatedAt: number;
}

// 归一世界名做同名匹配（剥空白/装饰符·小写）。
export function normWorldName(s: string): string {
  return (s || '').replace(/[\s·•・\-—_,，。、|｜（）()【】\[\]]/g, '').toLowerCase();
}

let _seq = 0;
function newId(): string { return `wr_${Date.now().toString(36)}_${(_seq++).toString(36)}`; }

interface WorldRecordState {
  records: WorldRecord[];
  activeId: string | null;      // 当前所在世界的记录 id（其世界观注入正文）

  // 生成/更新某世界名的 draft 世界观（同名未进入的 draft 直接覆盖；否则新建）。返回记录 id。
  upsertDraft: (args: {
    name: string; tier: string; worldview: Worldview;
    cardSnapshot?: Record<string, string>; playerTier?: string; playerLevel?: number;
  }) => string;

  // 进入世界：把匹配世界名的记录标 active（优先复用传入 id；否则取最近 draft；都没有则建壳）。
  activateWorld: (args: { name: string; tier?: string; recordId?: string; turn?: number; worldTime?: string }) => string;
  // 同名再入·继承：建新实例，复用上一实例世界观 + 带其「继承要点」文字锚点（续写进度）。
  inheritWorld: (args: { name: string; tier?: string; fromId: string; turn?: number; worldTime?: string }) => string;
  // 离开当前 active 世界（标 left；总结另由 setSummary 落）。
  leaveActive: (args?: { turn?: number; worldTime?: string }) => void;

  setWorldview: (id: string, worldview: Worldview) => void;
  setSummary: (id: string, summary: WorldSummary) => void;
  updateRecord: (id: string, patch: Partial<WorldRecord>) => void;   // 通用局部更新（含手动编辑覆盖字段 worldviewText/summaryText…）
  removeRecord: (id: string) => void;

  getById: (id: string) => WorldRecord | undefined;
  getActive: () => WorldRecord | undefined;
  // 同名的、已离开(left·有总结)的历史记录（供再入「继承/重置」选择）。
  priorLeftByName: (name: string) => WorldRecord[];

  clearAll: () => void;
}

export const useWorldRecord = create<WorldRecordState>()(
  persist(
    (set, get) => ({
      records: [],
      activeId: null,

      upsertDraft: ({ name, tier, worldview, cardSnapshot, playerTier, playerLevel }) => {
        const nn = normWorldName(name);
        const now = Date.now();
        let id = '';
        set((s) => {
          // 覆盖「同名且仍是 draft、尚未进入」的记录；否则新建。
          const existing = s.records.find((r) => r.status === 'draft' && normWorldName(r.name) === nn);
          if (existing) {
            id = existing.id;
            return { records: s.records.map((r) => r.id === existing.id
              ? { ...r, tier: tier || r.tier, worldview, cardSnapshot: cardSnapshot ?? r.cardSnapshot, playerTierAtGen: playerTier ?? r.playerTierAtGen, playerLevelAtGen: playerLevel ?? r.playerLevelAtGen, updatedAt: now }
              : r) };
          }
          id = newId();
          const instanceId = s.records.filter((r) => normWorldName(r.name) === nn).length + 1;
          const rec: WorldRecord = {
            id, name, tier, instanceId, cardSnapshot, worldview, status: 'draft',
            playerTierAtGen: playerTier, playerLevelAtGen: playerLevel, createdAt: now, updatedAt: now,
          };
          return { records: [...s.records, rec] };
        });
        return id;
      },

      activateWorld: ({ name, tier, recordId, turn, worldTime }) => {
        const nn = normWorldName(name);
        const now = Date.now();
        let id = recordId || '';
        set((s) => {
          let records = s.records.map((r) => r.id === s.activeId ? { ...r, status: 'left' as const, leftAt: { turn, worldTime }, updatedAt: now } : r);
          let target = recordId ? records.find((r) => r.id === recordId) : undefined;
          // 未指定 id：取同名最近的 draft（还没进过的世界观）。
          if (!target) target = [...records].reverse().find((r) => r.status === 'draft' && normWorldName(r.name) === nn);
          if (target) {
            id = target.id;
            records = records.map((r) => r.id === target!.id ? { ...r, status: 'active' as const, enteredAt: { turn, worldTime }, updatedAt: now } : r);
          } else {
            // 没有世界观也建一个壳（玩家可事后补生成）。
            id = newId();
            const instanceId = records.filter((r) => normWorldName(r.name) === nn).length + 1;
            records = [...records, { id, name, tier: tier || '', instanceId, status: 'active' as const, enteredAt: { turn, worldTime }, createdAt: now, updatedAt: now }];
          }
          return { records, activeId: id };
        });
        return id;
      },

      inheritWorld: ({ name, tier, fromId, turn, worldTime }) => {
        const nn = normWorldName(name);
        const now = Date.now();
        let id = '';
        set((s) => {
          const records = s.records.map((r) => r.id === s.activeId ? { ...r, status: 'left' as const, leftAt: { turn, worldTime }, updatedAt: now } : r);
          const prior = records.find((r) => r.id === fromId);
          id = newId();
          const instanceId = records.filter((r) => normWorldName(r.name) === nn).length + 1;
          records.push({
            id, name, tier: tier || prior?.tier || '', instanceId, fromInstance: fromId,
            worldview: prior?.worldview, inheritAnchors: prior?.summary?.继承要点,
            status: 'active', enteredAt: { turn, worldTime }, createdAt: now, updatedAt: now,
          });
          return { records, activeId: id };
        });
        return id;
      },

      leaveActive: ({ turn, worldTime } = {}) => set((s) => ({
        records: s.records.map((r) => r.id === s.activeId ? { ...r, status: 'left' as const, leftAt: { turn, worldTime }, updatedAt: Date.now() } : r),
        activeId: null,
      })),

      setWorldview: (id, worldview) => set((s) => ({ records: s.records.map((r) => r.id === id ? { ...r, worldview, updatedAt: Date.now() } : r) })),
      setSummary: (id, summary) => set((s) => ({ records: s.records.map((r) => r.id === id ? { ...r, summary, updatedAt: Date.now() } : r) })),
      updateRecord: (id, patch) => set((s) => ({ records: s.records.map((r) => r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r) })),
      removeRecord: (id) => set((s) => ({ records: s.records.filter((r) => r.id !== id), activeId: s.activeId === id ? null : s.activeId })),

      getById: (id) => get().records.find((r) => r.id === id),
      getActive: () => { const a = get().activeId; return a ? get().records.find((r) => r.id === a) : undefined; },
      priorLeftByName: (name) => { const nn = normWorldName(name); return get().records.filter((r) => r.status === 'left' && !!r.summary && normWorldName(r.name) === nn); },

      clearAll: () => set({ records: [], activeId: null }),
    }),
    { name: 'drpg-worldrecord' },
  ),
);

// 把世界观骨架压成可读文本块，供注入正文最深处（指导 AI 演绎本世界）。
export function formatWorldviewForInjection(wv: Worldview): string {
  const L: string[] = [];
  L.push(`世界：${wv.世界名}${wv.阶位 ? `（${wv.阶位}）` : ''}${wv.蓝本 ? ` · 蓝本：${wv.蓝本}` : ''}`);
  if (wv.基调) L.push(`基调：${wv.基调}`);
  if (wv.核心设定?.length) L.push(`核心设定：${wv.核心设定.join('；')}`);
  if (wv.势力?.length) {
    L.push('势力：');
    for (const f of wv.势力) L.push(`  · ${f.名称}${f.立场 ? `[${f.立场}]` : ''}${f.目标 ? `｜目标:${f.目标}` : ''}${f.战力 ? `｜战力:${f.战力}` : ''}${f.与主角关系 ? `｜对主角:${f.与主角关系}` : ''}`);
  }
  if (wv.关键人物?.length) {
    L.push('关键人物：');
    for (const c of wv.关键人物) L.push(`  · ${c.名称}${c.身份 ? `（${c.身份}）` : ''}${c.强度档 ? `｜${c.强度档}` : ''}${c.初始态度 ? `｜初态:${c.初始态度}` : ''}${c.性格锚点?.length ? `｜性格:${c.性格锚点.join('、')}` : ''}${c.行为特征?.length ? `｜行为:${c.行为特征.join('、')}` : ''}`);
  }
  if (wv.剧情走向) {
    const p = wv.剧情走向; const parts: string[] = [];
    if (p.开局情境) parts.push(`开局:${p.开局情境}`);
    if (p.主线阶段?.length) parts.push(`主线:${p.主线阶段.join(' → ')}`);
    if (p.关键转折点?.length) parts.push(`转折:${p.关键转折点.join('；')}`);
    if (p.可能结局?.length) parts.push(`可能结局:${p.可能结局.join('；')}`);
    if (p.隐藏线?.length) parts.push(`隐藏线:${p.隐藏线.join('；')}`);
    if (parts.length) L.push(`剧情走向（骨架·非剧本·给玩家留发挥空间）：\n  ${parts.join('\n  ')}`);
  }
  if (wv.主角切入点) {
    const e = wv.主角切入点;
    const s = [e.初始身份 && `身份:${e.初始身份}`, e.初始位置 && `位置:${e.初始位置}`, e.初始名声 && `名声:${e.初始名声}`, e.与世界的钩子 && `钩子:${e.与世界的钩子}`].filter(Boolean).join('｜');
    if (s) L.push(`主角切入点：${s}`);
  }
  if (wv.氛围与禁忌?.length) L.push(`氛围与禁忌：${wv.氛围与禁忌.join('；')}`);
  if (wv.行为锚点总纲) L.push(`行为基调：${wv.行为锚点总纲}`);
  return L.join('\n');
}

// 把「继承要点」压成文字锚点块，供同名再入继承时注入正文（让 AI 知道主角曾来过、据此续写）。
export function formatInheritAnchors(a: NonNullable<WorldSummary['继承要点']>): string {
  const L: string[] = [];
  if (a.主角在此世界身份) L.push(`主角身份：${a.主角在此世界身份}`);
  if (a.主角名声) L.push(`主角名声：${a.主角名声}`);
  if (a.已达世界之源) L.push(`已达世界之源：${a.已达世界之源}`);
  if (a.已完成任务?.length) L.push(`已完成任务：${a.已完成任务.join('、')}`);
  if (a.关键NPC现状) L.push(`关键NPC现状：${a.关键NPC现状}`);
  if (a.遗留局势) L.push(`遗留局势：${a.遗留局势}`);
  return L.join('\n');
}
