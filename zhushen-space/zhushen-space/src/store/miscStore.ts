import { create } from 'zustand';
import { modelsFetchArgs } from '../systems/apiUrl';
import { persist } from 'zustand/middleware';
import { lzStorage, lzLocalStorage } from '../systems/compressedStorage';   // 长期事实数千条→drpg-misc 裸JSON撑爆localStorage配额；压缩存
import type { ApiConfig } from './settingsStore';
import { useSettings } from './settingsStore';
import miscDefaultPreset from '../data/miscDefaultPreset.json';
import { normImpact, type Rumor, type RumorNode } from '../systems/rumor';   // 传闻：算法在 systems/rumor，本 store 只做哑存储
import type { Economy } from '../systems/economy';   // 经济：算法在 systems/economy，本 store 只做哑存储
// 世界归属（worldScope 铁则）：乐园/枢纽判定 + 同世界比对。
// 无循环依赖：worldScope 只 import npc/faction/worldRecord 三个 store，它们都不 import miscStore（已核）。
import { isHomeWorld, sameWorld } from '../systems/worldScope';

/* ════════════════════════════════════════════
   杂项演化（misc evolution）
   维护世界级杂项：分段总结 / 双时间 / 天气 / 世界大事
   （小地图相关规则保留为可关闭条目，渲染暂未实现）
   ⚠ 主角任务（T_）的**演化**已拆成独立的「任务演化」阶段（App.tsx runQuestEvolutionPhase，
     独立 API featureKey='quest'、开关 settings.questEnabled）；任务**数据**仍存本 store（tasks/archivedTasks），
     面板/结算/正文注入读取处不变。
════════════════════════════════════════════ */

/* 任务环（questline 的单个阶段）。主线/多环支线的路线图由若干环组成。
   planned=已规划只给提示 / active=当前进行 / done=已达成 / skipped=被跨越跳过。*/
export interface QuestRing {
  idx: number;        // 环序号（1-based，路线图排序的规范键）
  goal: string;       // 这一环的目标
  hint?: string;      // 提示（planned 环未落地时的一句钩子）
  status: 'planned' | 'active' | 'done' | 'skipped';
  reward?: string;    // 本环成功奖励（可与任务顶层不同）
  penalty?: string;   // 本环失败惩罚
  optional?: boolean; // 贪婪环(可选)：高潮之后的延伸；失败仅损失本环额外奖励、不致死。强制环不设此项
  startTime?: string; // 本环执行窗口（绝对游戏时间）
  endTime?: string;
  summary?: string;   // 本环达成时·主角这一环的关键行为/结果总结（1~2句，杂项AI在 ringAdvance 时给）；面板展示 + 结算逐环评价用
  rating?: string;    // 本环评级 S/A/B/C/D/E（达成时由杂项AI给）；面板展示 + 结算逐环参考
}

export interface MiscTask {
  id: string;        // "T_17"
  name: string;      // 列1
  desc: string;      // 列2
  reward: string;    // 列3 成功奖励
  penalty: string;   // 列4 失败惩罚
  status: string;    // 列5 "进行中/三阶中期"
  startTime: string;
  endTime: string;
  addedAt: number;
  // ── 多环任务线（v2，全部可选；老存档无这些字段=单环扁平任务，按支线处理）──
  kind?: '主线' | '支线';   // 任务线类型；缺省/未标=支线。主线每世界通常仅一条 active
  rings?: QuestRing[];      // 环路线图（多环任务才有；单环任务可不设）
  currentRing?: number;     // 当前 active 环的 idx（非数组下标）
  finale?: string;          // 终局目标——定义这条线的"尽头"，最后一环达成即整条完成
  rating?: string;          // 任务评分（S/A/B/C/D/E，完成/失败时由 AI 给定；显示在已结束列表 + 供世界结算参考）
  progress?: string;        // 当前任务进度：上回合主角对该任务的实质推进（1~2句·杂项AI每轮更新·纯展示+续作连贯，不参与结算判定）
  prof?: boolean;           // 职业任务：仅由「世界卡·生成职业任务」按钮生成、进世界时落到面板；杂项演化只更新进度/结算，绝不新建职业任务
  locked?: boolean;         // 玩家锁定：任务链(名称/终局/环目标/奖惩/环数)全冻结，AI 只能推进环状态/补总结评级/更新 progress，绝不改动结构
  worldName?: string;       // 在哪个任务世界接的（worldScope·world 作用域）。建档时自动记；留空=乐园接的/老存档 → 视为跨世界，永不被封存
  frozenAt?: number;        // 封存回合：离开该世界时未结算的任务被挪进 frozenTasks 时打的戳（同名再入选「继承」可解封）
}

/* 主线判定：只有显式 kind==='主线' 才算主线，其余（含未标 kind）一律支线 */
export function isMainQuest(t: { kind?: string }): boolean {
  return t?.kind === '主线';
}

/* 合并环数组（按稳定 idx 作身份）：把 AI 增量传来的 rings 并进既有 rings —— 治"老是吃掉前面几环"。
   ① 保留既有但本次未提及的环（尤其已 done/skipped 的前面环，绝不被整组替换吞掉）；
   ② 同 idx 的环用传入的「已定义」字段覆盖、缺省字段保留旧值（不被 undefined 清空 reward/penalty 等）；
   ③ 归一成唯一 active —— 以本次指定的 active 为准，更早的旧 active 落 done、更晚的落 planned。 */
export function mergeRings(existing: QuestRing[] | undefined, incoming: QuestRing[]): QuestRing[] {
  if (!Array.isArray(existing) || existing.length === 0) return incoming;
  const byIdx = new Map<number, QuestRing>();
  for (const r of existing) byIdx.set(r.idx, { ...r });
  for (const inc of incoming) {
    const prev = byIdx.get(inc.idx);
    if (!prev) continue;   // 路线图已锁定：不新增环（总环数冻结在创建时），忽略新 idx 的环
    const merged: QuestRing = { ...prev };
    // 路线图锁定铁则：环内容（goal/reward/penalty/hint/optional/时限）一经"定实"即冻结，之后 AI 只能推进 status、补 summary/rating——
    // 治"任务内容老是被 AI 重规划、缩水、跳环"。仅"占位环"（goal 空 / 形如"（待…规划/解锁）"）允许被填实（旧档渐进式的过渡）。
    const prevGoal = String(prev.goal || '').trim();
    const isPlaceholder = !prevGoal || /待[^，。]{0,10}(规划|解锁|推进|展开)/.test(prevGoal) || prevGoal.startsWith('（待');
    (Object.keys(inc) as (keyof QuestRing)[]).forEach((k) => {
      if (inc[k] === undefined) return;
      if (k === 'status' || k === 'summary' || k === 'rating' || k === 'idx') { (merged as any)[k] = inc[k]; return; }
      if (isPlaceholder) (merged as any)[k] = inc[k];   // 占位环才允许改内容；已定实的环内容冻结
    });
    byIdx.set(inc.idx, merged);
  }
  const out = [...byIdx.values()].sort((a, b) => a.idx - b.idx);
  const incActive = incoming.find((r) => r.status === 'active');
  if (incActive) for (const r of out) {
    if (r.idx !== incActive.idx && r.status === 'active') r.status = r.idx < incActive.idx ? 'done' : 'planned';
  }
  return out;
}

/* 阶位字符串 → 数字（一阶=1…九阶=9；"1阶"也认）；无法解析返回 0 */
function tierToNum(tier: string): number {
  const cn: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const m = /([一二三四五六七八九十]|\d+)\s*阶/.exec(tier || '');
  if (!m) return 0;
  return cn[m[1]] ?? (Number(m[1]) || 0);
}
/* 四阶门槛铁律：三阶及以下世界的任务奖励里剔除"灵魂钱币/魂币"段（治"一阶世界给灵魂钱币"）；四阶+ 或阶位未知则原样不动 */
function enforceTierReward(reward: string | undefined, tier: string): string | undefined {
  if (!reward) return reward;
  const n = tierToNum(tier);
  if (n < 1 || n >= 4) return reward;   // 未知(0)或四阶及以上：不动
  const segs = String(reward).split(/[、，,·]/).map((x) => x.trim()).filter(Boolean);
  const kept = segs.filter((x) => !/灵魂钱币|魂币/.test(x));
  return (kept.length ? kept.join('、') : '乐园币+500');
}
/* 给一条任务的各环奖励+任务级奖励套用四阶门槛（据当前世界阶位）——AI/手动生成落库前都过一遍 */
function scrubTaskTierCurrency<T extends { reward?: string; rings?: QuestRing[] }>(t: T, tier: string): T {
  if (tierToNum(tier) >= 4 || tierToNum(tier) < 1) return t;
  const rings = Array.isArray(t.rings) ? t.rings.map((r) => ({ ...r, reward: enforceTierReward(r.reward, tier) })) : t.rings;
  return { ...t, reward: enforceTierReward(t.reward, tier), rings };
}

/* 锁定任务·AI 更新过滤：任务链(名称/终局/环目标/奖惩/环数/结构)全冻结，只放行 整条status/rating(结算) + progress + 各环的 status/summary/rating(推进与记录)。 */
function applyLockedPatch(x: MiscTask, patch: Partial<MiscTask>): MiscTask {
  const out: MiscTask = { ...x };
  if (patch.status !== undefined) out.status = patch.status;       // 允许整条完成/失败结算
  if (patch.progress !== undefined) out.progress = patch.progress; // 进度更新
  if (patch.rating !== undefined) out.rating = patch.rating;       // 整体评级(完成时)
  if (Array.isArray(patch.rings) && Array.isArray(x.rings)) {
    out.rings = x.rings.map((r) => {
      const inc = patch.rings!.find((ir) => ir.idx === r.idx);
      if (!inc) return r;
      const nr = { ...r };
      if (inc.status !== undefined) nr.status = inc.status;   // 只放行推进(状态)
      if (inc.summary !== undefined) nr.summary = inc.summary;
      if (inc.rating !== undefined) nr.rating = inc.rating;
      return nr;   // goal/reward/penalty/optional/hint/时限 一律冻结
    });
    const active = out.rings.find((r) => r.status === 'active');
    if (active) out.currentRing = active.idx;
  }
  return out;
}

/* 已结算（完成/失败/放弃）的任务：移出"进行中"列表，留档供面板查看，不再注入提示词 */
export interface ArchivedTask extends MiscTask {
  settledAt: number;
  worldName?: string;   // 结算入档时主角所处世界；供【结算任务】按世界筛出"本世界已完成任务"喂给结算 AI 对账
}

export interface WorldEvent {
  id: string;        // "W_1"
  time: string;
  location: string;
  desc: string;
  worldName?: string;  // 归属世界（世界作用域·见 systems/worldScope.ts）。addWorldEvent 自动落当时的 worldName。
                       // 仅追加的历史流水 → **读时按世界过滤**（buildWorldTimeInjection），不做冻结标记：
                       // 天然满足「库房只存不删」，也不必为历史条目补写。为空 = 老数据，一律放行。
  // ── 生命周期（全部可选·见 systems/worldEvent.ts）。老条目无这些字段 = 单节点扁平事件，照常显示与注入。──
  name?: string;       // 事件名（可检索的专名；缺省用 desc 前缀顶上）
  scope?: 'background' | 'region';   // 背景(远处·与主角不同城/国) / 区域(主角可感知)；缺省按区域
  guide?: { macro: string; dev: string; detail: string };   // 🔮 命运罗盘走向锚（内部参考·永不进正文）
  actors?: string;     // 参与角色（人物全名或背景集群）
  chain?: { date: string; text: string }[];   // 事件脉络：推进=**追加**一节，绝不覆盖 desc
  settleCond?: string; // 结算条件（1~3条·事件的终点）
  settledAt?: number;  // 结算时间戳（有值=已落幕，退出活跃视图但保留在流水账里）
  outcome?: 'historic' | 'derived' | 'faded';   // 三级结算：重大历史 / 派生后续 / 湮灭
  derivedAt?: number;  // outcome='derived' 的事件被任务演化阶段消费过的标记（防重复派生）
  // ── P1·世界背面借鉴：可见性 / 暗流到期 / 显露递交（判定逻辑在 systems/worldEvent.ts）──
  visibility?: 'hidden' | 'trace' | 'known' | 'direct';   // 对主角叙事视角的可见性；缺省=known（老数据行为不变）。hidden 永不进正文（同 guide 占卜锚待遇）
  publicTrace?: string;  // visibility='trace' 时外界能观察到的表象（封路/异响/停业）——正文只喂这个，绝不喂内情与事件名
  knownBy?: string;      // 秘闻知情者（逗号分隔人物名）。有值=正文会被告知「其余角色不得表现出知情」
  due?: string;          // 预计结算时刻（世界时间串）。前端 isEventDue 判到期 → 演化里标 ⏰ 逼当轮结算或显式展期
  reveal?: { state: 'pending' | 'delivered' | 'shelved'; attempts: number };   // 落幕结果的显露递交：注入正文当候选→接住=delivered；3 次没接且非 direct=shelved（编年史仍在）
}

/* 叙事长期事实（回复后由 LLM 抽取，供关键词召回）*/
export interface NarrativeFact {
  id: string;        // "F_1"
  title: string;
  text: string;
  keywords: string[];
  addedAt: number;
}

/* ── 预设条目（与主角/NPC 演化同构，可导入导出）── */
export interface MiscPresetEntry {
  identifier: string;
  name: string;
  content: string;
  enabled: boolean;
  role: string;
  source?: string;
}

/* 内置默认预设：双时间规则 + 原版 13 条 misc_management 规则（轮回乐园适配，从 data/miscDefaultPreset.json 载入）*/
export const DEFAULT_MISC_ENTRIES: MiscPresetEntry[] =
  ((miscDefaultPreset as any).entrySharedRules as any[]).map((r) => ({
    identifier: r.id,
    name: r.name,
    content: r.content,
    enabled: r.enabled !== false,
    role: r.role ?? 'system',
    source: 'entrySharedRules',
  }));

const DEFAULT_PRESET_NAME: string = (miscDefaultPreset as any).name ?? '内置·杂项演化';
const DEFAULT_PRESET_VERSION: number | undefined = (miscDefaultPreset as any).version;

/** 把启用条目拼成 system prompt（运行时再替换 ${...} 占位符）*/
export function buildMiscSystemPrompt(entries: MiscPresetEntry[]): string {
  return (entries ?? []).filter((e) => e.enabled).map((e) => e.content).join('\n\n');
}

/** 从预设 JSON 提取条目（支持 entrySharedRules / prompts.* / sharedRules）*/
export function extractMiscPresetFromJson(
  raw: string,
): { name: string; version?: number; entries: MiscPresetEntry[] } | null {
  try {
    const data = JSON.parse(raw);
    const name: string = data.name ?? '杂项演化预设';
    const version: number | undefined = data.version;
    const entries: MiscPresetEntry[] = [];
    const push = (rule: any, src: string) => {
      if (!rule || !rule.id || rule.content == null) return;
      entries.push({
        identifier: rule.id,
        name: rule.name ?? rule.id,
        content: String(rule.content),
        enabled: rule.enabled !== false,
        role: rule.role ?? 'system',
        source: src,
      });
    };
    if (Array.isArray(data.entrySharedRules)) for (const r of data.entrySharedRules) push(r, 'entrySharedRules');
    if (data.prompts && typeof data.prompts === 'object') {
      for (const [k, sec] of Object.entries(data.prompts) as [string, any][]) {
        if (sec && Array.isArray(sec.rules)) for (const r of sec.rules) push(r, `prompts.${k}`);
      }
    }
    if (Array.isArray(data.sharedRules)) for (const r of data.sharedRules) push(r, 'sharedRules');
    if (entries.length === 0) return null;
    return { name, version, entries };
  } catch {
    return null;
  }
}

/* 拉取 /models 模型列表（杂项 miscApi 与任务演化 questApi 两套配置共用；15s 超时 abort 防挂死——网络门禁规约） */
async function fetchModelList(api: ApiConfig): Promise<string[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(...modelsFetchArgs(api, ctrl.signal));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.data ?? json.models ?? []).map((m: any) => m.id ?? m.name ?? '').filter(Boolean).sort();
  } finally { clearTimeout(timer); }
}

export interface MiscSettings {
  enabled: boolean;
  questEnabled?: boolean;   // 任务演化阶段开关（独立于杂项演化 enabled；旧档缺省时继承 enabled——见 persist merge 迁移）
  entries: MiscPresetEntry[];
  presetName: string;
  presetVersion?: number;
  largeEvery: number;   // 大总结周期：每 N 个杂项演化回合才产出一条大总结（聚合压缩近期小总结），其余回合只出小总结
  // 记忆保留上限（0/缺省 = 无限）：担心存档体积时设正数=只保留最近 N 条（仅影响存储/召回候选，不影响每回合注入）
  factCap?: number;    // 长期事实上限
  smallCap?: number;   // 小总结上限
  largeCap?: number;   // 大总结上限
  questInjectEnabled?: boolean;  // 是否把当前任务(主线重/支线轻)注入正文上下文（默认开）
  questSideCap?: number;         // 注入正文的支线条数上限（相关性排序后封顶，默认 3）
  // ── 任务闸门（questGuard·AI 侧护栏；玩家 ✏️ 编辑/手动生成不受限）──
  questGuardLock?: boolean;      // AI 结构锁（默认开）：已建档任务 AI 只许推进（状态/进度/评级/环推进），名称/描述/奖惩/时限/终局/环内容冻结
  questSideMax?: number;         // 在场支线数量上限：满额时 AI 新建支线被驳回（0=不限，默认 4；主线/职业任务/进阶通告不占额）
  questNewPerRound?: number;     // 每轮杂项演化 AI 新建任务条数上限（0=不限，默认 1）
  // ── 环推进闸门（questAdvanceGate·治"部分完成就乱推进度/跳阶段/整条报完成"；见 questGuard.ts）──
  questAdvanceGate?: boolean;    // 确定性推进闸（默认开）：ringAdvance 须附正文原句 evidence（逐字核验）+ 每轮每任务最多一种环操作 + 跨环限幅 + 环状态单向 + 强制环未全达成时驳回整条成功结算
  questRingJumpMax?: number;     // 每轮每任务最多把几个环翻成 done/skipped（0=不限，默认 1）——跨越多环要分轮补账
  questAdvanceReview?: boolean;  // 推进二次复核（默认开）：推进/跳环/整条结算指令落库前，再调一次任务 API 当"复核裁判"逐要件核验正文证据，未过的剔除（仅 AI 试图推进的回合才多这一次调用）
}

const DEFAULT_SETTINGS: MiscSettings = {
  enabled: false,
  questEnabled: false,
  entries: DEFAULT_MISC_ENTRIES,
  presetName: DEFAULT_PRESET_NAME,
  presetVersion: DEFAULT_PRESET_VERSION,
  largeEvery: 6,
  factCap: 0,    // 0 = 长期事实不限数量
  smallCap: 0,   // 0 = 小总结不限数量
  largeCap: 0,   // 0 = 大总结不限数量
  questInjectEnabled: true,
  questSideCap: 3,
  questGuardLock: true,
  questSideMax: 4,
  questNewPerRound: 1,
  questAdvanceGate: true,
  questRingJumpMax: 1,
  questAdvanceReview: true,
};

interface MiscState {
  tasks: MiscTask[];
  archivedTasks: ArchivedTask[];   // 已结算任务（完成/失败/放弃），移出进行中列表
  /* 封存任务（worldScope·world 作用域）：离开某任务世界时，属于它的**未结算**任务整体挪到这里。
     ⚠ 为什么物理挪走而不是"读时过滤"：tasks 的读取点散布在正文注入/演化快照/面板/结算/参谋等十来处，
       靠每处记得加过滤条件必然会漏（本轮就先漏过一次历的过滤）。挪出数组 ⇒ 所有既有读取点自动生效、零遗漏。
     ⚠ 封存 ≠ 删除（铁律「库房只存不删」）：同名世界再入并选「继承」即 thaw 回 tasks；面板也能翻到。 */
  frozenTasks: MiscTask[];
  lastWorldSettleAt: number;       // 上次「世界结算/进入新任务世界」的时间戳；只结算 settledAt 晚于它的任务=本世界的，杜绝把之前世界重复结算
  worldEvents: WorldEvent[];
  rumors: Rumor[];        // 📢 传闻流变（真相/流传/偏差三分·world 作用域·见 systems/rumor.ts）
  economy: Economy | null;  // 💰 本世界经济气候（world 作用域·物价指数由前端按公式推进·见 systems/economy.ts）
  smallSummaries: string[];
  largeSummaries: string[];
  summaryRound: number;   // 杂项演化已运行的回合计数（用于大总结周期判断，持久化）
  turnCount: number;      // 本存档**累计总回合数**（持久化）：每次玩家发送 +1，跨任务世界/刷新/读档都不归零（进入世界会清空对话，故不能再用"对话里的用户消息数"当回合数）
  narrativeFacts: NarrativeFact[];
  weather: string;
  weatherFxCss: string;   // AI 为奇异天气生成的纯 CSS 顶栏特效（已 sanitize）
  weatherFxKey: string;   // 该 CSS 对应的天气串（按天气缓存；与当前天气失配则不用）
  paradiseTime: string;
  worldTime: string;
  worldName: string;
  worldTier: string;   // 本世界难度/阶位——进入该世界时即锁定，全程不随主角升级变化（治"难度动态漂移"）
  contractors: { count: number; note: string };   // 本世界"其他契约者"人口：进世界按世界观设定初值，随世界时间演化（陨落/离场/新来），让世界不是单机
  localCurrencyName: string;   // 本世界【当地货币】名称（贝利/戒尼/美元/骨币…）——世界限定、带不出；空=在乐园/枢纽或本世界未设定。土著报酬走它、不发乐园币/魂币
  localCurrency: number;       // 本世界【当地货币】余额——离开/切换任务世界即归零（与 worldTier/contractors 同批重置）
  truths: string[];            // 已确立真相清单（≤12·杂项阶段 truths([...]) 覆盖式维护；周期强化注入数据源，见 systems/plotThreads。⚠切世界不自动清——世界专属条目由 AI 按维护规则移除，跨世界长线保留）

  settings: MiscSettings;
  miscApi: ApiConfig;
  miscUseSharedApi: boolean;
  miscAvailableModels: string[];
  miscModelsLoading: boolean;
  miscModelsError: string;
  // ── 任务演化（独立阶段）的接口配置：featureKey='quest' 路由留空时回退到这里 ──
  questApi: ApiConfig;
  questUseSharedApi: boolean;
  questAvailableModels: string[];
  questModelsLoading: boolean;
  questModelsError: string;

  upsertTask: (t: MiscTask) => void;
  updateTask: (id: string, patch: Partial<MiscTask>) => void;
  editTask: (id: string, patch: Partial<MiscTask>) => void;   // 玩家手动编辑：直接覆盖字段/整组 rings，绕过 AI 的路线图锁定与合并
  addProfQuests: (items: { name: string; desc?: string; reward?: string }[]) => void;   // 进世界时把「世界卡·生成职业任务」的产出落成 prof 任务到面板
  toggleTaskLock: (id: string) => void;   // 玩家锁定/解锁任务链（锁定后 AI 只更新进度、不改结构）
  removeTask: (id: string) => void;
  settleTask: (id: string, status: string) => void;   // 结算：移出进行中→归档
  advanceRing: (id: string, done?: { summary?: string; rating?: string }) => void;   // 推进：当前 active 环→done（并记下该环行为总结/评级）、下一 planned 环→active，同步顶层快照
  clearArchivedTasks: () => void;
  /** 🌍 离开任务世界：把属于它的未结算任务挪进 frozenTasks。返回封存条数。 */
  freezeTasksOfWorld: (worldName: string, turn: number) => number;
  /** 同名世界再入选「继承」：把封存的挪回进行中。返回解封条数。 */
  thawTasksOfWorld: (worldName: string) => number;
  /** 玩家在面板上手动捞回单条封存任务。 */
  unfreezeTask: (id: string) => void;
  clearFrozenTasks: () => void;
  markWorldSettled: () => void;    // 打一个"世界结算/进世界"边界戳（=现在）；此后完成的任务才计入下次结算
  nextTaskId: () => string;
  addWorldEvent: (e: Omit<WorldEvent, 'id'>) => void;
  updateWorldEvent: (id: string, patch: Partial<Omit<WorldEvent, 'id'>>) => void;
  removeWorldEvent: (id: string) => void;
  appendEventChain: (id: string, node: { date?: string; text: string }) => void;   // 事件脉络只追加，绝不覆盖
  settleWorldEvent: (id: string, outcome: 'historic' | 'derived' | 'faded', summary?: string) => void;
  markEventDerived: (id: string) => void;   // 派生支线已被任务演化消费（防重复派生）
  // ── 传闻（systems/rumor.ts 是算法，这里只是哑 reducer）──
  addRumor: (r: { name: string; impact?: string; scope?: string; node?: Partial<RumorNode> }) => string;
  appendRumorNode: (id: string, node: Partial<RumorNode>) => void;   // 只 append 新 seq，绝不覆盖旧节点
  updateRumor: (id: string, patch: Partial<Pick<Rumor, 'name' | 'impact' | 'scope'>>) => void;
  removeRumor: (id: string) => void;
  setRumors: (list: Rumor[]) => void;   // 压缩/裁剪等整体重写（调用方已算好）
  // ── 经济（systems/economy.ts 是算法，这里只是哑存储）──
  setEconomy: (e: Economy | null) => void;
  patchEconomy: (patch: Partial<Economy>) => void;
  pushSmall: (s: string) => void;
  pushLarge: (s: string) => void;
  removeSmall: (index: number) => void;   // 按原始数组下标删除一条小总结（玩家在记忆面板手动清理重复/误产条目）
  removeLarge: (index: number) => void;   // 按原始数组下标删除一条大总结
  bumpSummaryRound: () => number;   // +1 并返回新值
  setTurnCount: (n: number) => void;   // 设置累计总回合数（持久化）
  addNarrativeFacts: (items: { title: string; text: string; keywords: string[] }[]) => void;
  removeNarrativeFact: (id: string) => void;
  clearNarrativeFacts: () => void;
  setWeather: (w: string) => void;
  setWeatherFx: (key: string, css: string) => void;
  setTime: (patch: { paradiseTime?: string; worldTime?: string; worldName?: string }) => void;
  setWorldTier: (tier: string) => void;   // 进入新世界时锁定本世界难度/阶位
  setTruths: (list: string[]) => void;    // 覆盖式更新已确立真相清单（裁剪至 12 条·去空白）
  setContractors: (count: number, note?: string) => void;   // 更新本世界其他契约者人口（数量/分布）
  setLocalCurrencyName: (name: string) => void;   // 进入新任务世界时设定本世界当地货币名称（贝利/戒尼…）
  adjustLocalCurrency: (delta: number) => void;   // 当地货币加减（≥0 保护）——土著发报酬/本地买卖
  setLocalCurrency: (n: number) => void;          // 当地货币设定/校准
  clearMisc: () => void;

  setSettings: (patch: Partial<Omit<MiscSettings, 'entries'>>) => void;
  setPresetEntries: (entries: MiscPresetEntry[], name: string, version?: number) => void;
  togglePresetEntry: (id: string) => void;
  updatePresetEntry: (id: string, patch: Partial<Pick<MiscPresetEntry, 'name' | 'content' | 'role'>>) => void;
  clearPreset: () => void;
  resetPreset: () => void;

  setMiscApi: (patch: Partial<ApiConfig>) => void;
  setMiscUseSharedApi: (v: boolean) => void;
  fetchMiscModels: () => Promise<void>;
  setQuestApi: (patch: Partial<ApiConfig>) => void;
  setQuestUseSharedApi: (v: boolean) => void;
  fetchQuestModels: () => Promise<void>;
}

export const useMisc = create<MiscState>()(
  persist(
    (set, get) => ({
      tasks: [],
      archivedTasks: [],
      frozenTasks: [],
      lastWorldSettleAt: 0,
      worldEvents: [],
      rumors: [],
      economy: null,
      smallSummaries: [],
      largeSummaries: [],
      summaryRound: 0,
      turnCount: 0,
      narrativeFacts: [],
      weather: '',
      weatherFxCss: '',
      weatherFxKey: '',
      paradiseTime: '',
      worldTime: '',
      worldName: '',
      worldTier: '',
      contractors: { count: 0, note: '' },
      localCurrencyName: '',
      localCurrency: 0,
      truths: [],

      settings: { ...DEFAULT_SETTINGS },
      miscApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.6, maxTokens: 4096, topP: 1,
      },
      miscUseSharedApi: true,
      miscAvailableModels: [],
      miscModelsLoading: false,
      miscModelsError: '',
      questApi: {
        baseUrl: 'https://api.openai.com/v1', apiKey: '', modelId: 'gpt-4o',
        temperature: 0.6, maxTokens: 4096, topP: 1,
      },
      questUseSharedApi: true,
      questAvailableModels: [],
      questModelsLoading: false,
      questModelsError: '',

      upsertTask: (t) =>
        set((s) => {
          const i = s.tasks.findIndex((x) => x.id === t.id);
          const next = [...s.tasks];
          // 更新既有任务：rings 走按 idx 合并、不整组替换 → 不丢已完成的前面环
          if (i >= 0) { next[i] = next[i].locked ? applyLockedPatch(next[i], t) : scrubTaskTierCurrency(Array.isArray(t.rings) ? { ...next[i], ...t, rings: mergeRings(next[i].rings, t.rings) } : { ...next[i], ...t }, s.worldTier || ''); return { tasks: next }; }
          // 新建任务·铁则「一个世界只有一条主线」：本世界已有主线（进行中 或 本世界已完成/已归档的）时，新主线强制降级为支线，杜绝一个世界冒出第二条主线。
          // 用边界戳把"本世界"框住：进行中主线看 addedAt、已归档主线看 settledAt 是否晚于 lastWorldSettleAt（=进入本世界之后），避免上个世界残留的旧主线误伤新世界建主线。
          const boundary = s.lastWorldSettleAt || 0;
          // boundary=0（尚未打过世界边界戳，多为旧存档）时不降级，避免把新世界的第一条主线误伤成支线；边界一旦建立（进世界/结算）即生效
          const worldHasMain = boundary > 0 && (s.tasks.some((x) => isMainQuest(x) && (x.addedAt || 0) > boundary)
            || s.archivedTasks.some((x) => isMainQuest(x) && x.settledAt > boundary));
          let nt = (isMainQuest(t) && worldHasMain) ? { ...t, kind: '支线' as const } : t;
          // 新建·铁则「全新任务的环只能：第1环 active、其余一律 planned」——杜绝 AI 刚建任务就把好几环标成 done/达成（治"刚登记就说打完了"的胡乱推进）。
          // 仅对"进行中"的全新任务重置；一次性给出的已完成/已失败任务(随后 settleTask 归档)不动。
          if (Array.isArray(nt.rings) && nt.rings.length && !/完成|达成|成功|失败|放弃|作废|取消/.test(nt.status || '')) {
            const sorted = [...nt.rings].sort((a, b) => a.idx - b.idx);
            const fixed = sorted.map((r, idx) => ({ ...r, status: (idx === 0 ? 'active' : 'planned') as QuestRing['status'] }));
            nt = { ...nt, rings: fixed, currentRing: fixed[0]?.idx ?? 1 };
          }
          // 世界归属（worldScope 铁则）：建档即记下"在哪个世界接的"，离世时据此封存。
          // AI 显式给了就尊重（极少），否则记当前世界名；在乐园/枢纽接的任务留空＝跨世界，永不被封存。
          if (!nt.worldName) { const wn = (s.worldName || '').trim(); if (wn && !isHomeWorld(wn)) nt = { ...nt, worldName: wn }; }
          next.push(scrubTaskTierCurrency(nt, s.worldTier || ''));
          return { tasks: next };
        }),
      updateTask: (id, patch) =>
        set((s) => {
          // 一个世界一条主线：想把某任务升为主线、但本世界已另有主线（进行中或本世界已归档）→ 不允许提升，去掉 kind 提升
          const boundary = s.lastWorldSettleAt || 0;
          let p = patch;
          if (patch.kind === '主线' && boundary > 0
            && (s.tasks.some((x) => x.id !== id && isMainQuest(x) && (x.addedAt || 0) > boundary) || s.archivedTasks.some((x) => isMainQuest(x) && x.settledAt > boundary))) {
            p = { ...patch }; delete p.kind;
          }
          return { tasks: s.tasks.map((x) =>
            x.id !== id ? x
            : x.locked ? applyLockedPatch(x, p)   // 锁定任务：只放行进度/状态，任务链冻结
            : scrubTaskTierCurrency(Array.isArray(p.rings) ? { ...x, ...p, rings: mergeRings(x.rings, p.rings) } : { ...x, ...p }, s.worldTier || ''),
          ) };
        }),
      // 玩家手动编辑：直接覆盖（rings 整组替换、不走 mergeRings 锁定/不走一世界一主线降级/不受 locked 限制）——玩家改的以玩家为准
      editTask: (id, patch) =>
        set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      toggleTaskLock: (id) =>
        set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, locked: !x.locked } : x)) })),
      addProfQuests: (items) =>
        set((s) => {
          if (!Array.isArray(items) || !items.length) return s;
          // 分配不与现有(含归档)撞号的新 id
          const nums = [...s.tasks, ...s.archivedTasks].map((t) => Number(/^T_(\d+)$/.exec(t.id)?.[1])).filter((x) => Number.isFinite(x));
          let n = nums.length ? Math.max(...nums) : 0;
          const now = Date.now();
          const add = items.filter((it) => it && String(it.name || '').trim()).map((it) => ({
            id: `T_${++n}`, name: String(it.name).trim(), desc: String(it.desc || '').trim(),
            reward: String(it.reward || '').trim(), penalty: '', status: '进行中',
            startTime: '', endTime: '', addedAt: now, kind: '支线' as const, prof: true,
          }));
          return add.length ? { tasks: [...s.tasks, ...add] } : s;
        }),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id) })),
      settleTask: (id, status) =>
        set((s) => {
          const t = s.tasks.find((x) => x.id === id);
          if (!t) return s;   // 进行中列表里没有 → 不结算（防误删/重复）
          const archived: ArchivedTask = { ...t, status: status || t.status || '已完成', settledAt: Date.now(), worldName: s.worldName || undefined };
          return {
            tasks: s.tasks.filter((x) => x.id !== id),
            archivedTasks: [archived, ...s.archivedTasks.filter((x) => x.id !== id)].slice(0, 40),
          };
        }),
      advanceRing: (id, done) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id || !Array.isArray(t.rings) || t.rings.length === 0) return t;
            const rings = t.rings.map((r) => ({ ...r }));
            const cur = rings.find((r) => r.status === 'active');
            if (cur) {
              cur.status = 'done';
              // 记下主角这一环的行为总结与评级（供面板逐环展示 + 结算逐环评价；缺省不覆盖既有）
              if (done?.summary && String(done.summary).trim()) cur.summary = String(done.summary).trim();
              if (done?.rating && String(done.rating).trim()) cur.rating = String(done.rating).trim();
            }
            // 晋升下一个 planned 环（按 idx 最小者）为 active
            const next = rings
              .filter((r) => r.status === 'planned')
              .sort((a, b) => a.idx - b.idx)[0];
            if (next) next.status = 'active';
            const active = rings.find((r) => r.status === 'active');
            return {
              ...t,
              rings,
              currentRing: active ? active.idx : t.currentRing,
              // 顶层 desc/奖惩同步到新 active 环，保证旧序列化/面板显示当前目标
              ...(active
                ? {
                    desc: active.goal || t.desc,
                    reward: active.reward ?? t.reward,
                    penalty: active.penalty ?? t.penalty,
                  }
                : {}),
            };
          }),
        })),
      clearArchivedTasks: () => set({ archivedTasks: [] }),

      /* 🌍 离开任务世界：把属于它的**未结算**任务整体挪进 frozenTasks（= 退出所有读取点，但数据仍在）。
         乐园接的任务（worldName 空）与老存档任务一律不动——宁可多留，绝不把玩家的任务弄没。 */
      freezeTasksOfWorld: (worldName, turn) => {
        const wn = String(worldName || '').trim();
        if (!wn || isHomeWorld(wn)) return 0;
        let moved = 0;
        set((s) => {
          const stay: MiscTask[] = [];
          const frozen: MiscTask[] = [];
          for (const t of s.tasks) {
            if (t.worldName && sameWorld(t.worldName, wn)) { frozen.push({ ...t, frozenAt: turn }); moved++; }
            else stay.push(t);
          }
          return moved ? { tasks: stay, frozenTasks: [...s.frozenTasks, ...frozen] } : s;
        });
        return moved;
      },

      /* 同名世界再入并选「继承」：把封存的任务原样挪回进行中（清掉 frozenAt）。 */
      thawTasksOfWorld: (worldName) => {
        const wn = String(worldName || '').trim();
        if (!wn) return 0;
        let moved = 0;
        set((s) => {
          const back: MiscTask[] = [];
          const keep: MiscTask[] = [];
          for (const t of s.frozenTasks) {
            if (t.worldName && sameWorld(t.worldName, wn)) { const { frozenAt: _drop, ...rest } = t; back.push(rest); moved++; }
            else keep.push(t);
          }
          return moved ? { tasks: [...s.tasks, ...back], frozenTasks: keep } : s;
        });
        return moved;
      },

      /* 玩家在面板上手动把某条封存任务捞回进行中（不必等同名再入）。 */
      unfreezeTask: (id) => set((s) => {
        const t = s.frozenTasks.find((x) => x.id === id);
        if (!t) return s;
        const { frozenAt: _drop, ...rest } = t;
        return { tasks: [...s.tasks, rest], frozenTasks: s.frozenTasks.filter((x) => x.id !== id) };
      }),

      clearFrozenTasks: () => set({ frozenTasks: [] }),
      markWorldSettled: () => set({ lastWorldSettleAt: Date.now() }),
      nextTaskId: () => {
        // 进行中 + 已归档的编号都算"已占用"，避免复用完成任务的编号
        const all = [...get().tasks, ...get().archivedTasks];
        const nums = all.map((t) => Number(/^T_(\d+)$/.exec(t.id)?.[1])).filter((n) => Number.isFinite(n));
        return `T_${nums.length ? Math.max(...nums) + 1 : 1}`;
      },

      addWorldEvent: (e) =>
        set((s) => {
          const nums = s.worldEvents.map((w) => Number(/^W_(\d+)$/.exec(w.id)?.[1])).filter((n) => Number.isFinite(n));
          const id = `W_${nums.length ? Math.max(...nums) + 1 : 1}`;
          // 落归属世界（世界作用域）：不带 worldName 时按当时所处世界补，供注入侧按世界过滤，
          // 治"换了世界，正文里还在被喂上个世界的大事"。
          const wn = e.worldName ?? (s.worldName || undefined);
          return { worldEvents: [...s.worldEvents, { id, ...e, ...(wn ? { worldName: wn } : {}) }].slice(-40) };
        }),
      appendEventChain: (id, node) =>
        set((s) => ({
          worldEvents: s.worldEvents.map((e) => (e.id === id
            ? { ...e, chain: [...(e.chain ?? []), { date: node.date || s.worldTime || '', text: node.text }] }
            : e)),
        })),
      settleWorldEvent: (id, outcome, summary) =>
        set((s) => ({
          worldEvents: s.worldEvents.map((e) => (e.id === id
            ? {
              ...e, outcome, settledAt: Date.now(),
              // 结算陈述并进脉络（而不是覆盖 desc）——事件的完整读法始终是"初始描述 + 逐节推进 + 落幕"
              ...(summary ? { chain: [...(e.chain ?? []), { date: s.worldTime || '', text: `【落幕·${outcome}】${summary}` }] } : {}),
              // 显露递交（P1）：非 hidden 的落幕结果进「待显露」队列——注入侧给正文当自然带出候选（systems/worldEvent.ts）
              ...(e.visibility !== 'hidden' && !e.reveal ? { reveal: { state: 'pending' as const, attempts: 0 } } : {}),
            }
            : e)),
        })),
      markEventDerived: (id) =>
        set((s) => ({ worldEvents: s.worldEvents.map((e) => (e.id === id ? { ...e, derivedAt: Date.now() } : e)) })),

      addRumor: (r) => {
        const s = get();
        const nums = s.rumors.map((x) => Number(/^R_(\d+)$/.exec(x.id)?.[1])).filter((n) => Number.isFinite(n));
        const id = `R_${nums.length ? Math.max(...nums) + 1 : 1}`;
        const n = r.node ?? {};
        set((st) => ({
          rumors: [...st.rumors, {
            id, name: r.name,
            impact: normImpact(r.impact), scope: r.scope ?? '',
            worldName: st.worldName || undefined,
            createdAt: Date.now(),
            nodes: [{
              seq: 1, date: n.date ?? st.worldTime ?? '', expire: n.expire ?? '', turn: n.turn ?? st.turnCount ?? 0,
              truth: n.truth ?? '', told: n.told ?? '', drift: n.drift ?? '', cause: n.cause ?? '',
            }],
          }],
        }));
        return id;
      },
      appendRumorNode: (id, node) =>
        set((s) => ({
          rumors: s.rumors.map((r) => {
            if (r.id !== id) return r;
            const seq = r.nodes.reduce((m, x) => Math.max(m, x.seq), 0) + 1;   // 只递增，禁止复用旧编号覆盖历史
            return { ...r, nodes: [...r.nodes, {
              seq, date: node.date ?? s.worldTime ?? '', expire: node.expire ?? '', turn: node.turn ?? s.turnCount ?? 0,
              truth: node.truth ?? '', told: node.told ?? '', drift: node.drift ?? '', cause: node.cause ?? '',
            }] };
          }),
        })),
      updateRumor: (id, patch) =>
        set((s) => ({
          rumors: s.rumors.map((r) => (r.id === id
            ? { ...r, ...patch, ...(patch.impact ? { impact: normImpact(patch.impact) } : {}) }
            : r)),
        })),
      removeRumor: (id) => set((s) => ({ rumors: s.rumors.filter((r) => r.id !== id) })),
      setRumors: (list) => set({ rumors: list }),
      setEconomy: (e) => set({ economy: e }),
      patchEconomy: (patch) => set((s) => (s.economy ? { economy: { ...s.economy, ...patch } } : s)),

      updateWorldEvent: (id, patch) =>
        set((s) => ({ worldEvents: s.worldEvents.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
      removeWorldEvent: (id) => set((s) => ({ worldEvents: s.worldEvents.filter((w) => w.id !== id) })),

      pushSmall: (str) => set((s) => { const arr = [...s.smallSummaries, str]; const cap = s.settings.smallCap ?? 0; return { smallSummaries: cap > 0 ? arr.slice(-cap) : arr }; }),   // 默认不限；smallCap>0 时保留最近 N 条
      pushLarge: (str) => set((s) => { const arr = [...s.largeSummaries, str]; const cap = s.settings.largeCap ?? 0; return { largeSummaries: cap > 0 ? arr.slice(-cap) : arr }; }),   // 默认不限；largeCap>0 时保留最近 N 条
      removeSmall: (i) => set((s) => ({ smallSummaries: s.smallSummaries.filter((_, idx) => idx !== i) })),   // 按下标删；总结是无 id 的字符串数组，只能按位置删（不按内容，避免误删重复文本的所有条目）
      removeLarge: (i) => set((s) => ({ largeSummaries: s.largeSummaries.filter((_, idx) => idx !== i) })),
      bumpSummaryRound: () => { const n = get().summaryRound + 1; set({ summaryRound: n }); return n; },
      setTurnCount: (n) => set({ turnCount: Math.max(0, Math.floor(n) || 0) }),
      addNarrativeFacts: (items) =>
        set((s) => {
          let max = s.narrativeFacts.reduce((m, f) => Math.max(m, Number(/^F_(\d+)$/.exec(f.id)?.[1]) || 0), 0);
          const add = items
            .filter((it) => it.text && it.text.trim())
            .map((it) => ({ id: `F_${++max}`, title: (it.title || it.text.slice(0, 14)).trim(), text: it.text.trim(), keywords: it.keywords ?? [], addedAt: Date.now() }));
          const arr = [...s.narrativeFacts, ...add];
          const cap = s.settings.factCap ?? 0;   // 默认 0=不限（旧版固定 300，已取消）；factCap>0 时保留最近 N 条
          return { narrativeFacts: cap > 0 ? arr.slice(-cap) : arr };
        }),
      removeNarrativeFact: (id) => set((s) => ({ narrativeFacts: s.narrativeFacts.filter((f) => f.id !== id) })),
      clearNarrativeFacts: () => set({ narrativeFacts: [] }),
      setWeather: (w) => set({ weather: w }),
      setWeatherFx: (key, css) => set({ weatherFxKey: key, weatherFxCss: css }),
      setTime: (patch) => set((s) => {
        // 真·进入新任务世界 → 打结算边界戳（比 App 的 enteredNewWorld 更早、同回合生效）：此后完成的任务才算"本世界"。
        // ⚠只在"从乐园/枢纽(或空态) 切到 任务世界"时才算进新世界；**任务世界内部子地点漂移（甲铁城→甲铁城·金刚郭）不重置边界**——
        // 否则会把边界推到已完成主线之后，导致结算漏掉已完成主线（用户实测："结算不识别已完成主线"）。
        const newIsWorld = patch.worldName != null && patch.worldName !== s.worldName && !/轮回乐园|专属房间|主神空间/.test(patch.worldName);
        const oldIsHubOrEmpty = !s.worldName || /轮回乐园|专属房间|主神空间/.test(s.worldName);
        const changedToNew = newIsWorld && oldIsHubOrEmpty;
        return {
          paradiseTime: patch.paradiseTime ?? s.paradiseTime,
          worldTime: patch.worldTime ?? s.worldTime,
          worldName: patch.worldName ?? s.worldName,
          // 切到新任务世界：清空旧世界难度戳（由 App 的 enteredNewWorld 钩子按进入时主角阶位重新锁定）+ 清空旧世界契约者人口（进新世界由杂项演化按世界观重设）
          ...(changedToNew ? { lastWorldSettleAt: Date.now(), worldTier: '', contractors: { count: 0, note: '' }, localCurrencyName: '', localCurrency: 0 } : {}),
        };
      }),
      setWorldTier: (tier) => set({ worldTier: tier || '' }),
      setTruths: (list) => set({ truths: (Array.isArray(list) ? list : []).map((t) => String(t ?? '').trim()).filter(Boolean).slice(0, 12) }),
      setContractors: (count, note) => set((s) => ({ contractors: {
        count: Number.isFinite(count) ? Math.max(0, Math.round(count)) : s.contractors.count,
        note: note != null && String(note).trim() ? String(note).trim() : s.contractors.note,
      } })),
      setLocalCurrencyName: (name) => set({ localCurrencyName: (name ?? '').trim().slice(0, 16) }),
      adjustLocalCurrency: (delta) => set((s) => ({ localCurrency: Math.max(0, s.localCurrency + (Number(delta) || 0)) })),
      setLocalCurrency: (n) => set({ localCurrency: Math.max(0, Number(n) || 0) }),
      clearMisc: () => set({ tasks: [], archivedTasks: [], frozenTasks: [], lastWorldSettleAt: 0, worldTier: '', contractors: { count: 0, note: '' }, localCurrencyName: '', localCurrency: 0, worldEvents: [], rumors: [], economy: null, smallSummaries: [], largeSummaries: [], summaryRound: 0, turnCount: 0 }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setPresetEntries: (entries, name, version) =>
        set((s) => ({ settings: { ...s.settings, entries, presetName: name, presetVersion: version } })),
      togglePresetEntry: (id) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, enabled: !e.enabled } : e) } })),
      updatePresetEntry: (id, patch) =>
        set((s) => ({ settings: { ...s.settings, entries: s.settings.entries.map((e) => e.identifier === id ? { ...e, ...patch } : e) } })),
      clearPreset: () => set((s) => ({ settings: { ...s.settings, entries: [], presetName: '', presetVersion: undefined } })),
      resetPreset: () => set((s) => ({ settings: { ...s.settings, entries: DEFAULT_MISC_ENTRIES, presetName: DEFAULT_PRESET_NAME, presetVersion: DEFAULT_PRESET_VERSION } })),

      setMiscApi: (patch) => set((s) => ({ miscApi: { ...s.miscApi, ...patch } })),
      setMiscUseSharedApi: (v) => set({ miscUseSharedApi: v }),
      fetchMiscModels: async () => {
        const s = get();
        const api = s.miscUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.miscApi;
        if (!api.baseUrl || !api.apiKey) { set({ miscModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ miscModelsLoading: true, miscModelsError: '' });
        try {
          set({ miscAvailableModels: await fetchModelList(api), miscModelsLoading: false });
        } catch (e: any) {
          set({ miscModelsError: e.message ?? '请求失败', miscModelsLoading: false });
        }
      },
      setQuestApi: (patch) => set((s) => ({ questApi: { ...s.questApi, ...patch } })),
      setQuestUseSharedApi: (v) => set({ questUseSharedApi: v }),
      fetchQuestModels: async () => {
        const s = get();
        const api = s.questUseSharedApi
          ? (() => { const ss = useSettings.getState(); return ss.textUseSharedApi ? ss.api : ss.textApi; })()
          : s.questApi;
        if (!api.baseUrl || !api.apiKey) { set({ questModelsError: '请先填写 API 地址和 Key' }); return; }
        set({ questModelsLoading: true, questModelsError: '' });
        try {
          set({ questAvailableModels: await fetchModelList(api), questModelsLoading: false });
        } catch (e: any) {
          set({ questModelsError: e.message ?? '请求失败', questModelsLoading: false });
        }
      },
    }),
    {
      name: 'drpg-misc',
      storage: lzStorage(),   // ★压缩存：长期事实可累积数千条，裸 JSON 会把 localStorage 整域配额顶满（改API/存记忆/读档回退全报 quota）
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(persisted?.settings ?? {}),
          // 强制覆盖（仿正文世界书的 builtin 重载）：预设条目每次加载都刷成最新内置默认，
          // 用户无需手动「恢复默认」就拿到内置更新。代价＝UI 里对预设条目的手改/导入只当次会话有效、
          // 不跨刷新保留；要长期改预设请改 src/data/miscDefaultPreset.json 或代码注入的 *_RULE。
          entries: DEFAULT_MISC_ENTRIES,
          presetName: DEFAULT_PRESET_NAME,
          presetVersion: DEFAULT_PRESET_VERSION,
          // 迁移：任务演化拆分前的旧档没有 questEnabled → 继承杂项演化的 enabled（原先任务就是跟着杂项演化跑的，行为无缝）
          questEnabled: persisted?.settings?.questEnabled ?? persisted?.settings?.enabled ?? DEFAULT_SETTINGS.questEnabled,
        },
        miscApi: { ...current.miscApi, ...(persisted?.miscApi ?? {}) },
        miscUseSharedApi: persisted?.miscUseSharedApi ?? current.miscUseSharedApi,
        miscAvailableModels: [],
        miscModelsLoading: false,
        miscModelsError: '',
        questApi: { ...current.questApi, ...(persisted?.questApi ?? {}) },
        questUseSharedApi: persisted?.questUseSharedApi ?? current.questUseSharedApi,
        questAvailableModels: [],
        questModelsLoading: false,
        questModelsError: '',
      }),
    },
  ),
);

// 一次性迁移：把旧的**未压缩** drpg-misc 就地压缩，立刻腾出 localStorage 配额——否则要等下一次 misc 变动才转压缩，
//   期间用户若先去改 API 仍会报 quota。模块加载即跑（persist 已 hydrate 完；幂等：已压缩值前缀是 LZ、下面 startsWith('{') 会跳过）。
try {
  const rawMisc = localStorage.getItem('drpg-misc');
  if (rawMisc && rawMisc.startsWith('{')) lzLocalStorage.setItem('drpg-misc', rawMisc);
} catch { /* */ }
