import type { ItemCategory, CurrencyWallet } from '../store/itemStore';
import { useItems, normalizeGradeLabel, isResourcePseudoItem } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useNpc, defaultNpcRecord, isNpcId } from '../store/npcStore';
import { useFaction } from '../store/factionStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam, type TeamRank } from '../store/adventureTeamStore';
import { usePlayer } from '../store/playerStore';
import { useSettings } from '../store/settingsStore';
import { resolveEquipSlot } from './equipSlots';
import { unmetRequirements } from './attrBonus';
import { getPlayerEffectiveAttrs } from './playerAttrs';
import { opOf, refOf, isBatchDup, newBatch, recordItem, currencyDupKey, isCurrencyApplied, type ItemOp, type ItemEditResult, type LedgerCtx } from './ledger/itemLedger';

import { recordEvo, charRef, npcRef, charDigest, npcDigest, type EvoCtx, type EvoResult } from './ledger/evoLedger';
import { parseEditItems, parseEditChars, parseEditNpcs, parseEditFactions } from './editParser';

// 演化账本闸门相关件 re-export（App / stateApply 从 stateParser 统一拿，避免到处 import 子路径）
export { buildItemFeedback, purgeItemPhaseCurrency, detectUnregisteredCurrencyGains } from './ledger/itemLedger';
export { buildEvoFeedback, recordEvo } from './ledger/evoLedger';
export type { ItemEditResult, LedgerCtx } from './ledger/itemLedger';
export type { EvoResult, EvoCtx } from './ledger/evoLedger';
export { editToTerritoryText, editToTeamText } from './editParser';   // <edit> → 领地/团 透传合成 <upstore>

/* ════════════════════════════════════════════
   <state> 块 — 通用 key=value 变量更新
════════════════════════════════════════════ */

export interface StateUpdate {
  key: string;
  op: '=' | '+=' | '-=';
  value: string | number | boolean;
  raw: string;
}

export function extractStateBlocks(text: string): string[] {
  const re = /<state\b[^>]*>([\s\S]*?)<\/state>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

export function stripStateBlocks(text: string): string {
  return text
    .replace(/<state\b[^>]*>[\s\S]*?<\/state>/gi, '')
    .replace(/<state\b[^>]*>[\s\S]*$/i, '')
    .replace(/<upstore\b[^>]*>[\s\S]*?<\/upstore>/gi, '')
    .replace(/<upstore\b[^>]*>[\s\S]*$/i, '')
    .replace(/<edit\b[^>]*>[\s\S]*?<\/edit>/gi, '')
    .replace(/<edit\b[^>]*>[\s\S]*$/i, '')
    .replace(/<battle\b[^>]*\/>/gi, '')
    .replace(/<battle\b[^>]*>[\s\S]*?<\/battle>/gi, '')
    .replace(/<battle\b[^>]*>[\s\S]*$/i, '')
    .replace(/<tableEdit\b[^>]*>[\s\S]*?<\/tableEdit>/gi, '')   // 表格数据库·隐藏数据通道（applyAllUpdates 已在剥离前处理，展示/演化文本剥掉）
    .replace(/<tableEdit\b[^>]*>[\s\S]*$/i, '')                 // 截断流未闭合形态
    .trimEnd();
}

function parseLine(line: string): StateUpdate | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return null;

  const itemMatch = trimmed.match(/^item\.(add|remove|create|consume|equip|unequip|destroy)\s*=\s*(.+)$/i);
  if (itemMatch) {
    return { key: `item.${itemMatch[1].toLowerCase()}`, op: '=', value: itemMatch[2].trim(), raw: line };
  }

  const match = trimmed.match(/^([\w.]+)\s*([-+]?=)\s*([\s\S]*)$/);
  if (!match) return null;

  const [, key, op, rawVal] = match;
  const value = parseValue(rawVal.trim());
  if (value === undefined) return null;
  return { key, op: op as StateUpdate['op'], value, raw: line };
}

function parseValue(s: string): StateUpdate['value'] | undefined {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '') return undefined;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  return s;
}

export function parseStateBlock(blockContent: string): StateUpdate[] {
  return blockContent.split('\n').flatMap((line) => { const u = parseLine(line); return u ? [u] : []; });
}

export function parseAllStateUpdates(text: string): StateUpdate[] {
  return extractStateBlocks(text).flatMap(parseStateBlock);
}

/* ════════════════════════════════════════════
   <upstore> 块 — 物品 helper 函数指令
════════════════════════════════════════════ */

export type ItemCommandType =
  | 'createItem'
  | 'consumeItem'
  | 'destroyItem'
  | 'transferSpiritStones'  // 兼容旧预设
  | 'transferCurrency'      // 新货币指令
  | 'equipItem'
  | 'unequipItem'
  | 'updateItem'
  | 'updateItemQuantity'
  | 'transferItem';

export interface ItemCommand {
  type: ItemCommandType;
  data: any;
  raw: string;
}

export function extractUpstoreBlocks(text: string): string[] {
  const re = /<upstore\b[^>]*>([\s\S]*?)<\/upstore>/gi;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

/* 宽松 JSON 解析：容忍 AI 常见的非标准写法——**裸键(无引号)**、单引号字符串、尾随逗号。
   先按标准 JSON 试，失败再逐步放宽（给裸键补引号 / 单引号转双引号 / 去尾逗号）。都失败返回 undefined。
   注：裸键正则只匹配 { 或 , 之后紧跟的 ASCII 标识符，不会误伤中文字符串值里的全角「：，」。 */
export function lenientJsonParse(s: string): any {
  const quoteKeys = (x: string) => x.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*):/g, '$1"$2"$3:');
  const stripTrailingCommas = (x: string) => x.replace(/,(\s*[}\]])/g, '$1');
  const candidates = [
    s,
    quoteKeys(s),
    stripTrailingCommas(quoteKeys(s)),
    stripTrailingCommas(quoteKeys(s.replace(/'/g, '"'))),
  ];
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* 试下一种放宽方式 */ }
  }
  return undefined;
}

// 从 upstore 块中提取 helper 函数调用
// 格式: createItem({...}) / consumeItem({...}) 等
function parseUpstoreBlock(block: string): ItemCommand[] {
  const commands: ItemCommand[] = [];
  // 匹配 funcName({...}) 格式，支持嵌套大括号
  const re = /\b(createItem|consumeItem|destroyItem|transferSpiritStones|transferCurrency|equipItem|unequipItem|updateItem|updateItemQuantity|transferItem)\s*\((\{[\s\S]*?\})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const type = m[1] as ItemCommandType;
    const data = lenientJsonParse(m[2]);
    if (data !== undefined) commands.push({ type, data, raw: m[0] });
    else console.warn('[Upstore] 解析失败:', m[0]);
  }
  // 兼容 AI（尤其轻量模型）把 updateItem 写成 XML 标签的情况：
  // <updateItem itemId="" name=""><affix><item>…</item></affix><effect><item>…</item></effect></updateItem>
  const xmlRe = /<updateItem\b([^>]*)>([\s\S]*?)<\/updateItem>/gi;
  let xm: RegExpExecArray | null;
  while ((xm = xmlRe.exec(block)) !== null) {
    const attrs = xm[1], inner = xm[2];
    const attr = (n: string) => new RegExp(`${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs)?.[1];
    const itemId = attr('itemId'); const name = attr('name');
    const patch: Record<string, string> = {};
    // 每个子标签(affix/effect/combatStat…) → 字段；标签内可有多条 <item>，拼成一段文本
    const fieldRe = /<([a-zA-Z]\w*)>([\s\S]*?)<\/\1>/g;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(inner)) !== null) {
      const tag = fm[1]; if (tag === 'item') continue;
      const items = [...fm[2].matchAll(/<item>([\s\S]*?)<\/item>/g)].map((x) => x[1].trim()).filter(Boolean);
      const val = (items.length ? items.join(' ') : fm[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (val) patch[tag] = val;
    }
    if ((itemId || name) && Object.keys(patch).length) commands.push({ type: 'updateItem', data: { itemId, name, patch }, raw: xm[0] });
  }
  return commands;
}

export function parseAllItemCommands(text: string): ItemCommand[] {
  return [...extractUpstoreBlocks(text).flatMap(parseUpstoreBlock), ...parseEditItems(text)];   // <upstore> 与 <edit> 等效合流
}

/* ════════════════════════════════════════════
   将 ItemCommand 应用到 itemStore
════════════════════════════════════════════ */

/* ── NPC 物品 owner 解析器 ──
   物品管理阶段经常给 NPC 物品编一个"幻觉ID"（如 C22），与登场判断分配的真实ID（如 C1）对不上，
   导致同一 NPC 分裂成"基础信息"和"装备"两张卡。这里把未知/空壳 owner 重定向到真实在场 NPC。
   由 App 在挂载时注入。 */
let npcOwnerResolver: ((owner: string) => string) | null = null;
export function setNpcOwnerResolver(fn: ((owner: string) => string) | null): void {
  npcOwnerResolver = fn;
}
function resolveOwner(owner: string): string {
  if (owner === 'B1' || !npcOwnerResolver) return owner;
  try { return npcOwnerResolver(owner) || owner; } catch { return owner; }
}

/** 把 AI 给的货币种类字符串（grade/type，含旧灵石别名）归一化到 CurrencyWallet 键 */
function normalizeCurrencyType(raw: unknown): keyof CurrencyWallet {
  const s = String(raw ?? '').trim();
  if (s.includes('黄金') && s.includes('技能')) return '黄金技能点';
  if (s.includes('技能点') || s === '技能点') return '技能点';
  if (s.includes('魂') || s.includes('灵魂') || s.includes('上品') || s.includes('极品')) return '灵魂钱币';
  return '乐园币'; // 缺省 / 乐园币 / 下品 / 中品
}

/* 角色成长「点数」（属性点 / 真实属性点 / 技能点 / 黄金技能点 / 潜能点）只能在「世界结算」(玩家输入【结算任务】)
   由结算路径发放：属性点·真实属性点 → 主角演化 applyPlayerProfileCommands；技能点·黄金技能点·潜能点 → <state> 结算门控。
   物品演化阶段的 transferSpiritStones 绝不发放它们——AI 若在此误发，一律忽略（防越过结算门槛、防被错塞进乐园币）。*/
function isProgressionPointGrade(raw: unknown): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  return s.includes('属性点') || (s.includes('属性') && s.includes('点'))
      || s.includes('技能点')   // 含「黄金技能点」
      || s.includes('潜能');     // 潜能点
}

/* ── 奖励预告守卫（代码护栏·治「正文只是奖励预告、货币却真加了」）─────────────────
   正文里的「🎁奖励预告 / 奖励预览」是任务奖励的**预告、未发放**；AI 却常据此发 transferCurrency 提前入账。
   这里从含"奖励预告/预览"的行抽出货币金额，拦掉与之**金额匹配**的货币指令——结算回合(【结算任务】/世界结算)放行。
   与提示词规则「奖励预告不算入手」双管（用户要求代码可校验，不靠纯提示词）。*/
const REWARD_PREVIEW_LINE = /奖励\s*[预預]\s*(告|览|報|报|覽)/;
// "真到手"语境：击杀奖励/开宝箱/猩红卡片/掉落/成交/领取… 这些是**当场真入账**，绝不能当预告拦。
const REAL_ACQUIRE = /获得|得到|得了|到手|到账|入账|收入囊中|开出|开箱|宝箱|翻开|翻出|抽到|掉落|爆出|缴获|击杀|斩杀|杀死|讨伐|清剿|赏金|悬赏|成交|卖出|卖给|售出|兑换|领取|拿到|捡到|发放|已发|结算|卡片|卡牌|奖励到手|收入/;
const CUR_AMT_RE = /(乐园币|魂币|灵魂钱币|灵魂币|乐园货币)\s*[+＋]?\s*(\d[\d,]*)/g;
function scanCurrencyAmounts(line: string, into: Set<number>): void {
  CUR_AMT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CUR_AMT_RE.exec(line))) { const n = Number(String(m[2]).replace(/,/g, '')); if (n > 0) into.add(n); }
}
/** 只在"奖励预告/预览"行出现的货币金额（纯预告候选）。 */
export function previewRewardCurrencyAmounts(raw: string): Set<number> {
  const out = new Set<number>();
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/)) if (REWARD_PREVIEW_LINE.test(line)) scanCurrencyAmounts(line, out);
  return out;
}
/** 出现在"真到手"语境（击杀/开箱/卡片/掉落/成交/领取…·非预告行）的货币金额——这些是当场真入账，放行。 */
export function realAcquiredCurrencyAmounts(raw: string): Set<number> {
  const out = new Set<number>();
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/)) {
    if (REWARD_PREVIEW_LINE.test(line)) continue;   // 预告行不算"真到手"
    if (REAL_ACQUIRE.test(line)) scanCurrencyAmounts(line, out);
  }
  return out;
}
const CUR_NAME_RE = /^(乐园币|魂币|灵魂钱币|灵魂币|乐园货币)/;
/** 一条物品指令若是「给主角入账货币」，返回其金额（正数）；否则 null。覆盖全部货币向量：
   transferCurrency / transferSpiritStones / currency 命令，以及 createItem 一个货币名（前端会折算进钱包）。 */
function playerCurrencyGrantAmount(cmd: ItemCommand): number | null {
  const d = (cmd.data ?? {}) as Record<string, unknown>;
  if (cmd.type === 'transferCurrency' || cmd.type === 'transferSpiritStones') {   // 二者 opOf 归一到 'currency' op·是货币入账的唯一命令类型
    const toB1 = d.to === 'B1' || d.from == null;   // 给主角（非支出/非转给别人）
    const amt = Number(d.amount ?? 0);
    return toB1 && amt > 0 ? amt : null;
  }
  if (cmd.type === 'createItem') {
    const item = (d.item ?? d) as Record<string, unknown>;
    const name = String(item.name ?? item['1'] ?? '').trim();
    if (CUR_NAME_RE.test(name)) { const q = Number(item.quantity ?? item['4'] ?? 0); return q > 0 ? q : null; }
  }
  return null;
}
/** 从物品指令里剔除「与奖励预告金额匹配的货币入账」（非结算回合）。返回过滤后指令 + 拦截数。 */
export function stripPreviewRewardCurrency(raw: string, cmds: ItemCommand[]): { cmds: ItemCommand[]; blocked: number } {
  if (!Array.isArray(cmds) || cmds.length === 0) return { cmds, blocked: 0 };
  if (/【结算任务】|世界结算|<世界结算>/.test(raw)) return { cmds, blocked: 0 };   // 结算回合正常发放奖励
  const preview = previewRewardCurrencyAmounts(raw);
  if (preview.size === 0) return { cmds, blocked: 0 };
  const acquired = realAcquiredCurrencyAmounts(raw);
  // 只拦「纯预告」金额：在预告里、但本回合并无"击杀/开箱/卡片/掉落/成交/领取…"真到手语境。
  const blockable = new Set([...preview].filter((n) => !acquired.has(n)));
  if (blockable.size === 0) return { cmds, blocked: 0 };
  let blocked = 0;
  const kept = cmds.filter((cmd) => {
    const amt = playerCurrencyGrantAmount(cmd);
    if (amt != null && blockable.has(amt)) {
      blocked++;
      console.warn(`[货币] 拦截奖励预告的提前发放：+${amt}（本回合仅"奖励预告"、无真到手·任务未结算；指令类型 ${cmd.type}。击杀/开箱/卡片等真入账不受影响）`);
      return false;
    }
    return true;
  });
  return { cmds: kept, blocked };
}

/* 可堆叠分类：同名消耗类物品应累加数量而非生成重复条目（装备/法宝/特殊物等"唯一物"不堆叠，
   它们各自有独立的攻防/耐久/杀敌数等，不能合并）。修复"不同回合获得的同名消耗品堆成一堆重复条目"。*/
const STACKABLE_CATS = new Set<ItemCategory>(['消耗品', '材料', '凡物', '丹药', '灵药', '符箓']);
function isStackableCat(rawCategory?: string): boolean {
  return STACKABLE_CATS.has(normalizeCategory(String(rawCategory ?? '')));
}
/* 在 list 中找到一件「同名 + 同（归一化）分类 + 未装备」的可堆叠物品，用于累加数量去重 */
function findStackTarget(list: any[], name: string, rawCategory: string): any | null {
  if (!isStackableCat(rawCategory)) return null;
  const cat = normalizeCategory(rawCategory);
  const key = normName(name);
  if (!key) return null;
  return (list ?? []).find(
    (it) => !it.equipped && normName(it.name) === key && normalizeCategory(String(it.category)) === cat,
  ) ?? null;
}

/* 外观兜底：AI 没填 appearance(生图依据)时，用已有字段合成一段非空视觉描述，杜绝详情页「外观空白」。
   AI 写了就用 AI 的（提示词已强制逐部件描写）；没写才退化成「品质·类型「名」：简介」基本款，至少给生图一个依据。*/
function synthAppearance(item: any, name: string, category: string, grade: string): string {
  const cur = String(item?.appearance ?? '').trim();
  if (cur) return cur;
  const g = String(grade ?? '').trim();
  const c = (String(category ?? item?.subType ?? '').trim()) || '物品';
  const base = `${g ? g + '品质·' : ''}${c}「${name}」`;
  const intro = String(item?.intro ?? item?.desc ?? '').trim();
  return (intro ? `${base}：${intro}` : base).slice(0, 200);
}

/* 删除原因归类（供「最近删除」展示"为什么删"）：
   - consumeItem 消耗殆尽 → 一律 used（被使用/消耗）
   - destroyItem → 按 AI 给的 reason 关键词分 used / broken，缺省 broken（损坏·丢弃·失去）
   reason 优先用 AI 原话，缺则按类型合成一句。 */
function classifyDeletion(cmd: 'consume' | 'destroy', rawReason?: unknown): { kind: 'used' | 'broken'; reason: string } {
  const r = String(rawReason ?? '').trim();
  if (cmd === 'consume') return { kind: 'used', reason: r || '使用后消耗殆尽' };
  const usedKw = /使用|用掉|用尽|用完|喝|吃|服用|服下|开启|打开|激活|启动|引爆|点燃|消耗|耗尽|释放|投掷|掷出|抛出|扔出/;
  const kind: 'used' | 'broken' = r && usedKw.test(r) ? 'used' : 'broken';
  return { kind, reason: r || (kind === 'used' ? '使用后消失' : '损坏 / 丢弃 / 失去') };
}

/* ── 物品演化底层重构 · 第0期「单一闸门」──
 * 所有物品指令都从这里过：① 同批次精确去重 → ② 闸门预检(解析目标到稳定 id / 拦截重复创建 / 定位失败)
 * → ③ 应用（解析到的 id 已注入指令，applyOneItemCommand 据此确定性命中，不再二次模糊匹配）→ ④ 记账本。
 * 每条返回结构化结果(ItemEditResult)，调用方可据失败项回喂 AI 自纠(buildItemFeedback)。
 * 旧调用方只传 commands 即可（ctx 缺省 auto），返回值可忽略——行为向后兼容。 */
export function applyItemCommands(
  commands: ItemCommand[],
  ctx: LedgerCtx = { source: 'auto', turn: useItems.getState().itemTurn },
): ItemEditResult[] {
  const results: ItemEditResult[] = [];
  if (commands.length === 0) return results;
  // 同一批内：装备类 name|品级 → 首个 NPC 持有者，用于拦截「同一件装备被复制发给多个 NPC」(如玩家给一个队友买套装、AI 却塞进每个人包里)
  const npcEquipDupCtx = new Map<string, string>();
  const batch = newBatch();
  for (const cmd of commands) {
    const op = opOf(cmd.type);
    const ref = refOf(cmd);
    try {
      // ① 同批次精确重复（解析/复读把同一条逻辑指令出现两次）→ 跳过
      if (isBatchDup(batch, cmd)) {
        recordItem(ctx, op, ref, 'dup', '同批次重复指令');
        results.push({ ok: true, op, ref, skipped: true, reason: 'dup' });
        continue;
      }
      // ② 闸门预检
      const pre = preflightItemEdit(cmd, op, ctx);
      if (pre.decision === 'skip') {
        recordItem(ctx, op, ref, 'dup', pre.detail, pre.uid);
        results.push({ ok: true, op, ref, skipped: true, reason: 'dup', uid: pre.uid, detail: pre.detail });
        continue;
      }
      if (pre.decision === 'fail') {
        recordItem(ctx, op, ref, 'fail', pre.detail);
        results.push({ ok: false, op, ref, reason: 'not_found', detail: pre.detail, nearest: pre.nearest });
        continue;
      }
      // ③ 应用（每条都取最新状态：否则同一批里第2条 createItem 看不到第1条刚加的物品）
      applyOneItemCommand(pre.cmd ?? cmd, useItems.getState(), npcEquipDupCtx);
      recordItem(ctx, op, ref, 'applied', undefined, pre.uid);
      results.push({ ok: true, op, ref, uid: pre.uid });
    } catch (e: any) {
      recordItem(ctx, op, ref, 'error', String(e?.message ?? e));
      results.push({ ok: false, op, ref, reason: 'error', detail: String(e?.message ?? e) });
      console.warn('[Item] 应用指令失败:', cmd, e);
    }
  }
  return results;
}

interface Preflight { decision: 'apply' | 'skip' | 'fail'; cmd?: ItemCommand; uid?: string; detail?: string; nearest?: string; }

/** 取某持有者的背包（B1=玩家，其余=对应 NPC 的持有物）。*/
function bagOf(owner: string): any[] {
  if (owner === 'B1') return useItems.getState().items;
  return (useNpc.getState().npcs[owner]?.items as any[]) ?? [];
}

/** 失败反馈用：返回 bag 里"最接近"查询的一个名字（含/被含优先，否则首个），无则 undefined。*/
function nearestItemName(bag: any[], query?: string): string | undefined {
  const q = normName(query);
  if (!q || !bag?.length) return undefined;
  const hit = bag.find((it) => { const k = normName(it.name); return k && (k.includes(q) || q.includes(k)); });
  return (hit ?? bag[0])?.name;
}

/** 装备近似同物判重（供创建闸门"拦截重复创建"）：同名(归一去装饰) + 品级宽松吻合 → 视为重复。
    effect/combatStat 不再作硬性条件——AI 重提同一件装备时描述/效果每次都变，若要求全等会漏判成"新物"→重复生成(治"提一下就多两把·月影残心×3")。
    装备名多为专有名词，同名即同物；品级宽松(任一空或互相包含)区分「金色 vs 金色·顶级」(同物·判重)与「金色 vs 红色」(升级·放行)。
    本判定只用于 skip(不新建·不删物)，非破坏性、误判风险低。*/
function findIdenticalItem(bag: any[], name: string, grade: string, _effect: string, _combatStat: string): any | null {
  const n = normName(name), g = normName(grade);
  if (!n) return null;
  return (bag ?? []).find((it) => {
    if (normName(it.name) !== n) return false;
    const ig = normName(it.gradeDesc);
    return !g || !ig || ig === g || ig.includes(g) || g.includes(ig);   // 品级宽松包含
  }) ?? null;
}

/** 闸门预检：按操作类型解析目标到稳定 id / 拦截重复创建 / 定位失败。
 *  - apply：可应用（cmd 可能被替换成"已注入解析 id+准确名"的版本，uid=解析到的实例 id）
 *  - skip ：重复创建，跳过（uid=已存在那件的 id）
 *  - fail ：目标定位失败，跳过且回喂 AI（nearest=最接近项） */
function preflightItemEdit(cmd: ItemCommand, op: ItemOp, ctx?: LedgerCtx): Preflight {
  const d: any = cmd.data ?? {};
  switch (op) {
    case 'currency': {
      // 跨阶段双计去重：同回合同 (币种|金额|原因) 已发放过 → 跳过（防正文+物品阶段把同一笔奖励发两遍）。
      // 成长点数(技能点/潜能点…)由 applyOneItemCommand 自行拒发，这里不拦；只对真·货币去重。
      const amount = Number(d.amount ?? 0);
      const key = currencyDupKey(normalizeCurrencyType(d.type ?? d.grade), amount, d.reason);
      if (key && ctx && isCurrencyApplied(ctx.turn, key)) {
        return { decision: 'skip', uid: key, detail: '本回合已发放同款货币（防跨阶段双计）' };
      }
      return { decision: 'apply', uid: key ?? undefined };   // uid=key → 记进账本供后续同回合判重
    }
    case 'create': {
      const item = d.item ?? d;
      const owner = resolveOwner(d.owner ?? item.owner ?? 'B1');
      const name = String(item['1'] ?? item.name ?? '').trim();
      if (!name) return { decision: 'apply' };                       // 名缺失交由 applyOneItemCommand 兜底/忽略
      if (isResourcePseudoItem({ name })) return { decision: 'apply' };  // 货币伪物品自有处理，不在此判重
      const cat = String(item['2'] ?? item.category ?? '');
      if (!isEquippable(cat)) return { decision: 'apply' };           // 可堆叠类靠 store 堆叠合并，不在闸门判重
      const grade = String(item['3'] ?? item.grade ?? item.quality ?? '');
      const dup = findIdenticalItem(
        bagOf(owner), name, grade,
        String(item['4'] ?? item.effect ?? ''),
        String(item.combatStat ?? item.attack ?? item.defense ?? ''),
      );
      if (dup) return { decision: 'skip', uid: dup.id, detail: `已存在近似同物「${dup.name}」(${owner})，拦截重复创建` };
      return { decision: 'apply' };
    }
    // 持有者相关、apply 阶段支持 NPC 的：consume/destroy/equip/unequip
    case 'consume':
    case 'destroy':
    case 'equip':
    case 'unequip': {
      const owner = resolveOwner(d.owner ?? 'B1');
      const givenName: string | undefined = d.name ?? d['1'] ?? d.itemName;
      const bag = bagOf(owner);
      const found = pickTargetItem(bag, d.itemId, givenName);
      if (!found) {
        return { decision: 'fail', detail: `未在${owner === 'B1' ? '背包' : owner + ' 储存'}定位到目标`, nearest: nearestItemName(bag, givenName ?? d.itemId) };
      }
      return { decision: 'apply', cmd: { ...cmd, data: { ...d, itemId: found.id, name: found.name } }, uid: found.id };
    }
    // apply 阶段仅支持主角(B1)的：updateItem/updateItemQuantity
    case 'update':
    case 'updateQty': {
      const givenName: string | undefined = d.name ?? d['1'] ?? d.itemName;
      const bag = useItems.getState().items;
      const found = pickTargetItem(bag, d.itemId, givenName);
      if (!found) {
        return { decision: 'fail', detail: '背包未定位到要更新的物品', nearest: nearestItemName(bag, givenName ?? d.itemId) };
      }
      return { decision: 'apply', cmd: { ...cmd, data: { ...d, itemId: found.id, name: found.name } }, uid: found.id };
    }
    case 'transfer': {
      const givenName: string | undefined = d.name ?? d['1'] ?? d.itemName;
      if (d.from === 'B1') {
        const bag = useItems.getState().items;
        const found = pickTargetItem(bag, d.itemId, givenName);
        if (!found) return { decision: 'fail', detail: '转出失败：背包未定位到该物品', nearest: nearestItemName(bag, givenName ?? d.itemId) };
        return { decision: 'apply', cmd: { ...cmd, data: { ...d, itemId: found.id, name: found.name } }, uid: found.id };
      }
      if (d.to === 'B1' && d.from && d.from !== 'B1') {
        const owner = resolveOwner(String(d.from));
        const bag = bagOf(owner);
        const found = pickTargetItem(bag, d.itemId, givenName);
        if (!found) return { decision: 'fail', detail: `转入失败：来源 ${owner} 未定位到该物品`, nearest: nearestItemName(bag, givenName ?? d.itemId) };
        return { decision: 'apply', cmd: { ...cmd, data: { ...d, itemId: found.id, name: found.name } }, uid: found.id };
      }
      return { decision: 'apply' };
    }
    default:
      return { decision: 'apply' };  // currency / other：无目标可解析，直接应用（同批次去重已在上游处理）
  }
}

/** 校验/归一「攻防字段 combatStat」的机器可读性（确定性·无 API）：
 *  ① 全角数字 ０-９ → 半角、全角范围/分隔符归一，让 derivedStats.parseCombatStat 读得出；
 *  ② 装备类给了 combatStat 却不含任何半角数字（中文数字「八十」/纯文字）→ parseCombatStat 读不出、
 *     会静默回退按品级估算（卡面写明的攻防被忽略）→ 打 warn 让 F12 可见。不擅自改写文字、不丢数据。*/
function sanitizeCombatStat(raw: any, ctx: { name?: string; category?: string }): any {
  if (raw == null) return raw;
  const s = String(raw)
    .replace(/[０-９]/g, (d) => '0123456789'['０１２３４５６７８９'.indexOf(d)])
    .replace(/[～〜]/g, '~').replace(/／/g, '/').replace(/　/g, ' ');
  if (s.trim() && isEquippable(ctx.category) && !/\d/.test(s)) {
    console.warn(`[Item] combatStat 机器不可读（无阿拉伯数字，derivedStats 将回退品级估算、卡面攻防被忽略）：「${ctx.name ?? ''}」combatStat="${s}"——应写「攻击力/防御力 + 阿拉伯数字」`);
  }
  return s;
}

function applyOneItemCommand(cmd: ItemCommand, store: any, npcEquipDupCtx?: Map<string, string>): void {
  const { type, data } = cmd;

  switch (type) {
    case 'createItem': {
      const item = data.item ?? data;
      // 防御：AI 偶把对象塞进本该是字符串的字段（如 effect:{name,effect}），渲染时会触发 React 整页崩。强制字符串化可显示字段。
      for (const k of ['1', '2', '4', 'name', 'gradeDesc', 'quality', 'effect', 'appearance', 'acquisition', 'notes', 'origin', 'subType', 'combatStat', 'attack', 'defense', 'durability', 'requirement', 'affix', 'score', 'intro', 'killCount', 'category']) {
        const v = (item as any)[k];
        if (v != null && typeof v !== 'string' && typeof v !== 'number') {
          (item as any)[k] = typeof v === 'object' ? String((v as any).name ?? (v as any).text ?? (v as any).desc ?? (v as any).value ?? JSON.stringify(v)) : String(v);
        }
      }
      const owner: string = resolveOwner(data.owner ?? item.owner ?? 'B1');

      if (!item['1'] && !item.name) break;
      const name: string = item['1'] ?? item.name ?? '未知物品';

      // 货币/点数被 createItem 成物品的拦截（确定性护栏）：乐园币/魂币/技能点/潜能点… 是数值资源、不能当物品。
      // 但"任务世界开宝箱得乐园币"等场景，AI 常按容器规则「用 createItem 入账内容物」直接 createItem 乐园币 →
      // 旧逻辑要么变死条目、要么(本护栏初版)被丢弃，两种钱包都不涨（用户报"开箱得乐园币不进货币、不会第一时间更新"）。
      // 故这里改为【转换而非丢弃】：货币(乐园币/魂币) 按 quantity 直接计入主角钱包（applyAllUpdates 同步应用→第一时间到账）；
      // 成长点数(技能点/黄金技能点/潜能点/进阶点/属性点) 只在【世界结算】发放，物品阶段一律不补 → 仍拒绝、不计。
      if (isResourcePseudoItem({ name })) {
        const isPoint = /技能点|潜能点|进阶点|属性点/.test(name);   // 含 黄金技能点 / 真实属性点
        const amt = parseInt(String(item['5'] ?? item.quantity ?? '0').replace(/[^\d]/g, ''), 10) || 0;
        if (!isPoint && amt > 0 && owner === 'B1') {
          const ccy = normalizeCurrencyType(name);                  // 乐园币 / 灵魂钱币
          store.adjustCurrency(ccy, amt, `正文获得·${name}`);        // 开箱/掉落等直接入账 → 进流水
          console.log(`[Item] 「${name}」是货币 → 直接计入钱包 +${amt} ${ccy}（不建成物品死条目）`);
        } else {
          console.warn(`[Item] 拒绝把货币/点数「${name}」createItem 成物品（${isPoint ? '点数只在【世界结算】发放' : amt <= 0 ? '数量缺失/为0、无法计入' : 'NPC 货币不计入主角钱包'}；已忽略死条目）`);
        }
        break;
      }

      // 品级收敛（一物一档·纯前端护栏）：剥技能品级词 + 折叠「紫色/史诗」复合品级，评分优先定档
      const rawGrade = item['3'] ?? item.grade ?? item.quality ?? '';
      const ng = normalizeGradeLabel(rawGrade, { score: item.score, grade: (item.numeric as any)?.grade });
      if (ng.changed) console.log(`[Item] 品级收敛: 「${rawGrade}」→「${ng.grade}」(${name})`);
      const normGrade = ng.grade;

      // 非玩家物品 → 写入 NPC 持有物而非玩家背包
      if (owner !== 'B1') {
        const npcStore = useNpc.getState();
        // 确保 NPC 记录存在（用于在 NPC 面板显示）
        if (!npcStore.npcs[owner]) {
          npcStore.upsertNpc(owner, defaultNpcRecord(owner));
        }
        const npcQty = parseInt(item['5'] ?? item.quantity ?? '1') || 1;
        const npcRawCat = item['2'] ?? item.category ?? '其他物品';
        // 同名可堆叠消耗品 → 累加数量，避免不同回合重复生成
        const npcStack = findStackTarget(npcStore.npcs[owner]?.items ?? [], name, String(npcRawCat));
        if (npcStack) {
          npcStore.updateNpcItem(owner, npcStack.id, { quantity: (npcStack.quantity || 1) + npcQty });
          console.log(`[Item] NPC ${owner} 堆叠 ${name} +${npcQty} → 共 ${(npcStack.quantity || 1) + npcQty}`);
          break;
        }
        // 跨 NPC 同款装备拦截（仅同一批 createItem 内、仅装备类）：同一件 name+品级 的装备本批已发给别的 NPC → 跳过，
        // 防「给一个队友买/获得一套装备，AI 却把同款复制塞进每个在场 NPC 的包里」。可堆叠消耗品不受限（多人各持同款药剂合理）。
        if (npcEquipDupCtx && isEquippable(String(npcRawCat))) {
          const dupKey = `${name.replace(/\s+/g, '').toLowerCase()}|${normGrade}`;
          const firstOwner = npcEquipDupCtx.get(dupKey);
          if (firstOwner && firstOwner !== owner) {
            console.warn(`[Item] 跨NPC同款装备拦截：「${name}」(${normGrade}) 本轮已归 ${firstOwner}，跳过重复发给 ${owner}`);
            break;
          }
          if (!firstOwner) npcEquipDupCtx.set(dupKey, owner);
        }
        // 是否重复生成交由 AI 判断（同 id 会累加数量；新 id 同名则按 AI 意图新建）
        const npcGivenId: string | undefined = item['0'] ?? item.id;
        npcStore.addNpcItem(owner, {
          id:         npcGivenId ?? `I_${owner}_${Date.now()}`,
          name,
          category:   item['2'] ?? item.category ?? '其他物品',
          gradeDesc:  normGrade,
          effect:     item['4'] ?? item.effect ?? '',
          quantity:   parseInt(item['5'] ?? item.quantity ?? '1') || 1,
          equipped:   false,
          appearance: synthAppearance(item, name, String(npcRawCat), normGrade),
          acquisition: data.acquisition ?? data.reason,
          notes:      data.reason,
          tags:       Array.isArray(item.tags) ? item.tags : undefined,
          origin:      item.origin,
          subType:     item.subType ?? item.subtype,
          combatStat:  sanitizeCombatStat(item.combatStat ?? item.attack ?? item.defense, { name, category: String(npcRawCat) }),
          durability:  item.durability,
          requirement: item.requirement ?? item.require,
          affix:       item.affix,
          score:       item.score != null ? String(item.score) : undefined,
          intro:       item.intro ?? item.desc,
          killCount:   item.killCount != null ? String(item.killCount) : (item.kills != null ? String(item.kills) : undefined),
          numeric:    item.numeric,
          addedAt:    Date.now(),
        });
        console.log(`[Item] NPC ${owner} 物品: ${name} x${item['5'] ?? 1}（已写入NPC档案）`);
        break;
      }

      // owner === 'B1' → 写入玩家背包（原有逻辑）
      const category = normalizeCategory(item['2'] ?? item.category ?? item.type ?? '其他物品');
      const qty = parseInt(item['5'] ?? item.quantity ?? '1') || 1;
      // 同名可堆叠消耗品 → 累加数量，避免不同回合重复生成同名条目（装备/唯一物不堆叠）
      const stackTarget = findStackTarget(store.items, name, category);
      if (stackTarget) {
        store.updateItem(stackTarget.id, {
          quantity: (stackTarget.quantity || 1) + qty,
          effect: stackTarget.effect || (item['4'] ?? item.effect ?? ''),
          appearance: stackTarget.appearance || synthAppearance(item, name, category, normGrade),
        });
        console.log(`[Item] 堆叠 ${name} +${qty} → 共 ${(stackTarget.quantity || 1) + qty}`);
        break;
      }
      // 是否重复生成交由 AI 判断（同 id 走更新累加；新 id 同名则按 AI 意图新建，不再机械复用 id 去重）
      const wantId: string | undefined = item['0'] ?? item.id;
      store.addItem({
        id: wantId,
        name,
        category,
        gradeDesc: normGrade,
        effect: item['4'] ?? item.effect ?? '',
        quantity: qty,
        equipped: false,
        tags: Array.isArray(item.tags) ? item.tags : [],
        appearance: synthAppearance(item, name, category, normGrade),
        acquisition: data.acquisition ?? data.reason,
        notes: data.reason,
        origin:      item.origin,
        subType:     item.subType ?? item.subtype,
        combatStat:  sanitizeCombatStat(item.combatStat ?? item.attack ?? item.defense, { name, category }),
        durability:  item.durability,
        requirement: item.requirement ?? item.require,
        affix:       item.affix,
        score:       item.score != null ? String(item.score) : undefined,
        intro:       item.intro ?? item.desc,
        killCount:   item.killCount != null ? String(item.killCount) : (item.kills != null ? String(item.kills) : undefined),
      });
      console.log(`[Item] 创建物品: ${name} x${item['5'] ?? 1}`);
      break;
    }

    case 'consumeItem': {
      const owner: string = resolveOwner(data.owner ?? 'B1');
      const qty = data.quantity ?? 1;
      // ★ 优先按物品名定位（AI 常臆造 itemId，名字更可靠）：name → itemId(按id) → itemId(按名)
      const givenName: string | undefined = data.name ?? data['1'] ?? data.itemName;
      if (owner !== 'B1') {
        const npcStore = useNpc.getState();
        const bag = npcStore.npcs[owner]?.items ?? [];
        const nitem = pickTargetItem(bag, data.itemId, givenName);
        if (!nitem) { console.warn(`[Item] NPC ${owner} 未找到要消耗的物品（name=${givenName} id=${data.itemId}）`); break; }
        if (nitem.locked) { console.warn(`[Item] 拒绝消耗 NPC ${owner} 已锁定物品「${nitem.name}」（玩家锁定·防误删）`); break; }
        if (nitem.equipped) { console.warn(`[Item] 拒绝消耗 NPC ${owner} 已装备物品「${nitem.name}」（需先卸下，防误删穿戴装备）`); break; }
        npcStore.consumeNpcItem(owner, nitem.id, qty);
        console.log(`[Item] NPC ${owner} 消耗 ${nitem.name} x${qty}`);
        break;
      }
      const item = pickTargetItem(store.items, data.itemId, givenName);
      if (item) {
        if (item.locked) { console.warn(`[Item] 拒绝消耗已锁定物品「${item.name}」（玩家锁定·防误删，需先解锁）`); break; }
        // ★ 已装备物品不应被"消耗"（消耗品不会处于装备态）——多为 AI 幻觉，拒绝以防穿戴装备无故消失
        if (item.equipped) { console.warn(`[Item] 拒绝消耗已装备物品「${item.name}」（需先 uneq 卸下）`); break; }
        if ((item.quantity ?? 1) - qty <= 0) { store.binItem(item, classifyDeletion('consume', data.reason)); console.log(`[Item] 消耗 ${item.name} 用尽 → 移入最近删除（可恢复）`); }
        else { store.consumeItem(item.id, qty); console.log(`[Item] 消耗 ${item.name} x${qty}`); }
      } else { console.warn(`[Item] 未找到要消耗的物品（name=${givenName} id=${data.itemId}）`); }
      break;
    }

    case 'destroyItem': {
      const owner: string = resolveOwner(data.owner ?? 'B1');
      const givenName: string | undefined = data.name ?? data['1'] ?? data.itemName;
      if (owner !== 'B1') {
        const npcStore = useNpc.getState();
        const bag = npcStore.npcs[owner]?.items ?? [];
        const nitem = pickTargetItem(bag, data.itemId, givenName);
        if (!nitem) { console.warn(`[Item] NPC ${owner} 未找到要销毁的物品（name=${givenName} id=${data.itemId}）`); break; }
        if (nitem.locked) { console.warn(`[Item] 拒绝销毁 NPC ${owner} 已锁定物品「${nitem.name}」（玩家锁定·防误删）`); break; }
        // 销毁=物品从世界消失（丢弃/卖掉/损毁/被夺走）：已装备也直接移除，装备槽随之清空（移除即等于先卸下）
        npcStore.removeNpcItem(owner, nitem.id);
        console.log(`[Item] NPC ${owner} 销毁 ${nitem.name}${nitem.equipped ? '（已自动从装备栏移除）' : ''}`);
        break;
      }
      const item = pickTargetItem(store.items, data.itemId, givenName);
      if (item) {
        if (item.locked) { console.warn(`[Item] 拒绝销毁已锁定物品「${item.name}」（玩家锁定·防误删，需先解锁）`); break; }
        // 销毁：若正穿戴，先自动卸下；不直接抹掉，改移入「最近删除」回收站（可恢复，满 3 回合自动清除），防 AI 误删
        if (item.equipped) { try { store.unequipItem(item.id); } catch { /* */ } console.log(`[Item] 销毁前自动卸下已装备物品「${item.name}」`); }
        store.binItem(item, classifyDeletion('destroy', data.reason));
        console.log(`[Item] 销毁 ${item.name}（→ 最近删除）`);
      } else { console.warn(`[Item] 未找到要销毁的物品（name=${givenName} id=${data.itemId}）`); }
      break;
    }

    // transferSpiritStones 是预设仍在使用的货币指令（旧名），按 transferCurrency 同样处理，
    // 货币种类由 grade/type 字段判定（缺省=乐园币）。曾被忽略导致乐园币/灵魂钱币不更新。
    case 'transferSpiritStones':
    case 'transferCurrency': {
      const amount: number = data.amount ?? 0;
      // 成长点数（属性点/真实属性点/技能点/黄金技能点/潜能点）只在【结算任务】世界结算时由结算路径发放，物品阶段一律拒发
      if (isProgressionPointGrade(data.type ?? data.grade)) {
        console.warn(`[Item] 忽略物品阶段发放点数「${String(data.type ?? data.grade)}」：属性点/技能点/黄金技能点/潜能点只在【结算任务】世界结算时发放`);
        break;
      }
      const type = normalizeCurrencyType(data.type ?? data.grade);
      const rsn = String(data.reason ?? data.note ?? '').trim();   // AI 可在指令里带 reason → 进货币流水
      if (data.to === 'B1' || data.from === null || data.from === undefined) {
        store.adjustCurrency(type, amount, rsn || '正文入账（奖励/交易/掉落）');
        console.log(`[Item] 获得 +${amount} ${type}`);
      }
      if (data.from === 'B1' || data.to === null || data.to === undefined) {
        store.adjustCurrency(type, -amount, rsn || '正文支出（消费/给予）');
        console.log(`[Item] 支出 -${amount} ${type}`);
      }
      break;
    }

    case 'equipItem': {
      const owner: string = resolveOwner(data.owner ?? 'B1');
      const givenName: string | undefined = data.name ?? data['1'] ?? data.itemName;
      if (owner !== 'B1') {
        // NPC 自动装备开关：关闭时忽略 AI 对 NPC 的 equipItem（物品留在 NPC 储存空间）
        if (!useSettings.getState().allowAutoEquipNpc) { console.log(`[Item] 已关闭 NPC 自动装备，忽略 ${owner} 装备指令`); break; }
        // NPC 装备 → 标记 NPC 持有物的 equipped 字段
        const npcStore = useNpc.getState();
        const bag = npcStore.npcs[owner]?.items ?? [];
        const nitem = (givenName ? bag.find((x) => x.name === givenName) : undefined)
          ?? bag.find((x) => x.id === data.itemId) ?? bag.find((x) => x.name === data.itemId);
        if (!nitem) { console.warn(`[Item] NPC ${owner} 未找到要装备的物品（name=${givenName} id=${data.itemId}）`); break; }
        if (!isEquippable(nitem.category) || isResourcePseudoItem(nitem)) { console.warn(`[Item] 拒绝装备 NPC ${owner}「${nitem.name}」：${isResourcePseudoItem(nitem) ? '货币/点数类资源，不可装备' : nitem.category + ' 非装备类'}`); break; }
        // 按分类校验槽位：AI 槽位与分类不符（如武器→饰品槽）时自动改到正确槽
        const slot = resolveEquipSlot(nitem as any, bag as any, buildSlotString(data));
        npcStore.equipNpcItem(owner, nitem.id, slot);
        console.log(`[Item] NPC ${owner} 装备 ${nitem.name} → ${slot}`);
        break;
      }
      // 主角自动装备开关：关闭时忽略 AI 对主角的 equipItem（物品留背包，玩家在装备面板手动穿戴）
      if (!useSettings.getState().allowAutoEquip) { console.log('[Item] 已关闭自动装备，主角装备指令忽略（请在装备面板手动穿戴）'); break; }
      const item = (givenName ? findItemByName(store, givenName) : undefined)
        ?? findItemById(store, data.itemId) ?? findItemByName(store, data.itemId);
      if (item) {
        // ★ 只有装备类可上装备栏：拒绝把 重要物品/消耗品/材料 等装上去
        if (!isEquippable(item.category) || isResourcePseudoItem(item)) { console.warn(`[Item] 拒绝装备「${item.name}」：${isResourcePseudoItem(item) ? '货币/点数类资源，不可装备' : item.category + ' 非装备类'}`); break; }
        // ★ 装备需求门槛：主角有效六维未达 requirement → 拒绝穿戴（与装备面板同规则；物品留背包）
        const unmet = unmetRequirements(item.requirement, getPlayerEffectiveAttrs());
        if (unmet.length) { console.warn(`[Item] 拒绝装备「${item.name}」：属性未达需求 ${unmet.map((u) => `${u.label}${u.need}(现${u.have})`).join('、')}`); break; }
        // 按分类校验槽位：AI 槽位与分类不符（如武器→饰品槽）时自动改到正确槽
        const slot = resolveEquipSlot(item, store.items, buildSlotString(data));
        store.equipItem(item.id, slot);
        console.log(`[Item] 装备 ${item.name} → ${slot}`);
      } else { console.warn(`[Item] 未找到要装备的物品（name=${givenName} id=${data.itemId}）`); }
      break;
    }

    case 'unequipItem': {
      const owner: string = resolveOwner(data.owner ?? 'B1');
      if (owner !== 'B1') {
        const npcStore = useNpc.getState();
        npcStore.unequipNpcItem(owner, data.itemId);
        console.log(`[Item] NPC ${owner} 卸下 ${data.itemId}`);
        break;
      }
      const item = pickTargetItem(store.items, data.itemId, data.name ?? data['1'] ?? data.itemName);
      if (item) {
        store.unequipItem(item.id);
        console.log(`[Item] 卸下 ${item.name}`);
      }
      break;
    }

    case 'updateItemQuantity': {
      // 身份安全：按 name+id 解析到唯一实例（幻觉 id 不再改错隔壁那件）；解析不到就跳过、不误改
      const item = pickTargetItem(store.items, data.itemId, data.name ?? data['1'] ?? data.itemName);
      if (item) store.updateItem(item.id, { quantity: data.newQuantity });
      else console.warn(`[Item] updateItemQuantity 未定位到物品（name=${data.name ?? data['1']} id=${data.itemId}）——跳过，不改错别的物品`);
      break;
    }

    case 'updateItem': {
      // 身份安全：按 name+id 解析（此前只 findItemById 裸按 id，幻觉 id 会把属性/词缀改到错误的另一件上）
      const item = pickTargetItem(store.items, data.itemId, data.name ?? data['1'] ?? data.itemName);
      if (item) {
        // 兼容两种写法：嵌套 updateItem({itemId, patch:{…}}) / 扁平 updateItem({itemId, name, affix:…})
        // 此前只认 data.patch，AI 写成扁平就整条被丢弃（词缀/属性变化不生效的元凶之一）
        const nested = !!(data.patch && typeof data.patch === 'object');
        const p: any = nested ? data.patch : data;
        const patch: any = {};
        // 同时接受列号('1'..'4')与具名字段；name 仅在嵌套 patch 里才当改名（扁平里的 name 是引用名，不可误当改名）
        if (nested && (p['1'] ?? p.name)) patch.name = p['1'] ?? p.name;
        if (p['2'] ?? p.category) patch.category = normalizeCategory(p['2'] ?? p.category);
        // ★品级/评分锁（治"同一件装备品级随受损/演化在 史诗↔绿色 乱跳"）：品级=物品固有稀有度，
        //   只由前端强化/觉醒/宝石(确定性系统·直接 store.updateItem，不走本 AI 指令路径)改；AI 演化绝不改已有物品的品级/评分。
        //   受损/使用只体现在 耐久度/杀敌数/攻防叙述，绝不降/升稀有度。仅当物品【原本缺品级/评分】(异常)时才许 AI 补一次。
        const gradeIn = p['3'] ?? p.gradeDesc ?? p.quality;
        if (gradeIn) {
          const ng = normalizeGradeLabel(gradeIn, { score: item.score ?? p.score, grade: (p.numeric as any)?.grade }).grade;
          if (!item.gradeDesc || !String(item.gradeDesc).trim()) patch.gradeDesc = ng;
          else if (ng !== item.gradeDesc) console.warn(`[Item] 品级锁：忽略把「${item.name}」品级改成「${ng}」，保持固有「${item.gradeDesc}」（受损/使用不改稀有度）`);
        }
        if (p['4'] ?? p.effect) patch.effect = p['4'] ?? p.effect;
        // ↓ 这些具名字段此前被静默丢弃——装备强化收尾刷「词缀(affix)/效果(effect)」全靠它们
        if (p.affix) patch.affix = p.affix;
        if (p.appearance) patch.appearance = p.appearance;
        if (p.intro) patch.intro = p.intro;
        if (p.score && (!item.score || !String(item.score).trim())) patch.score = p.score;   // 评分随品级一起锁（评分决定品级档·改评分=变相改品级）；仅原本缺评分才补
        if (p.combatStat) patch.combatStat = sanitizeCombatStat(p.combatStat, { name: item.name, category: item.category });
        if (p.durability) patch.durability = p.durability;
        if (p.requirement) patch.requirement = p.requirement;
        if (p.subType) patch.subType = p.subType;
        if (p.origin) patch.origin = p.origin;
        if (p.notes) patch.notes = p.notes;
        if (p.acquisition) patch.acquisition = p.acquisition;
        if (p.killCount != null) {
          // 杀敌数支持「+N」/「+=N」增量（AI 不必知道总数，只报本轮击杀）；裸数字则按绝对总数
          const kc = String(p.killCount).trim();
          const rel = kc.match(/^\+\s*=?\s*(\d+)$/);
          patch.killCount = rel
            ? String((parseInt(String(item.killCount ?? '0'), 10) || 0) + parseInt(rel[1], 10))
            : kc;
        }
        // 强制把所有字段转成字符串：AI 偶把 effect/affix 等写成数字或对象，否则渲染时 (x).trim()/.replace() 会整页崩
        for (const k of Object.keys(patch)) {
          const v = patch[k];
          if (v != null && typeof v !== 'string') patch[k] = typeof v === 'object' ? String((v as any).name ?? (v as any).text ?? (v as any).desc ?? (v as any).value ?? JSON.stringify(v)) : String(v);
        }
        if (Object.keys(patch).length) store.updateItem(item.id, patch);
      } else console.warn(`[Item] updateItem 未定位到物品（name=${data.name ?? data['1']} id=${data.itemId}）——跳过，绝不把属性改到错误的另一件物品上`);
      break;
    }

    case 'transferItem': {
      const qty = data.quantity ?? 1;
      const givenName: string | undefined = data.name ?? data['1'] ?? data.itemName;

      // ── 玩家转出（交易/赠予/以物易物给出去）：等同一次"离手"，必须安全 + 可恢复 ──
      // 旧实现三坑（导致"正文没提的武器被悄悄吞掉、最近删除里也查不到、只能回滚"）：
      //   ① 只按 itemId 裸查 findItemById → AI 写错 id 就删错另一件（删了 B 而非 A）；
      //   ② 走 store.consumeItem 绕过 binItem → 不进「最近删除」、玩家无法恢复；
      //   ③ 不查 locked / equipped。
      // 改为与 consumeItem / destroyItem 同款护栏：pickTargetItem 按名+模糊定位、拒锁定、用尽走 binItem（可恢复）。
      if (data.from === 'B1') {
        const item = pickTargetItem(store.items, data.itemId, givenName);
        if (!item) { console.warn(`[Item] 转出失败：未定位到玩家物品（name=${givenName} id=${data.itemId}）——不动背包，宁可不转也不删错`); break; }
        if (item.locked) { console.warn(`[Item] 拒绝转出已锁定物品「${item.name}」（玩家锁定·防误删）`); break; }
        const used = (item.quantity ?? 1) - qty <= 0;          // 是否整件转走（数量清零）
        const moveQty = used ? (item.quantity ?? 1) : qty;
        if (used && item.equipped) { try { store.unequipItem(item.id); } catch { /* */ } console.log(`[Item] 转出前自动卸下已装备物品「${item.name}」`); }
        // 收方是真实 NPC → 把物品真正转进其储存空间（而非凭空消失）
        const toOwner = data.to && data.to !== 'B1' ? resolveOwner(String(data.to)) : null;
        if (toOwner) {
          try {
            const npcStore = useNpc.getState();
            if (!npcStore.npcs[toOwner]) npcStore.upsertNpc(toOwner, defaultNpcRecord(toOwner));
            const { id: _i, equipped: _e, equipSlot: _s, locked: _l, ...rest } = item as any;
            npcStore.addNpcItem(toOwner, { ...rest, equipped: false, quantity: moveQty });
          } catch { /* 收方挂接失败不阻断转出 */ }
        }
        // 整件转走 → 进「最近删除」（带原因、可恢复，治"只能回滚"）；部分转走 → 仅扣数量
        if (used) { store.binItem(item, { kind: 'used', reason: data.reason ?? (toOwner ? `转给 ${toOwner}` : '交易 / 转给他人') }); console.log(`[Item] 转出「${item.name}」→ 最近删除（可恢复）`); }
        else { store.consumeItem(item.id, qty); console.log(`[Item] 转出「${item.name}」x${qty}（剩 ${(item.quantity ?? 1) - qty}）`); }
        break;
      }

      // ── 转入玩家（从某 NPC 处获得）：从来源 NPC 包取出 → 加进玩家背包；绝不去削减玩家已有物品 ──
      // 旧实现 store.updateItem({quantity: Math.min(...)}) 会把玩家某件已有物品的数量"砍小"（潜在静默丢失），已废弃。
      if (data.to === 'B1') {
        const fromOwner = data.from && data.from !== 'B1' ? resolveOwner(String(data.from)) : null;
        if (fromOwner) {
          const npcStore = useNpc.getState();
          const bag = npcStore.npcs[fromOwner]?.items ?? [];
          const src = pickTargetItem(bag, data.itemId, givenName);
          if (src) {
            npcStore.removeNpcItem(fromOwner, src.id);
            const { id: _i, equipped: _e, equipSlot: _s, locked: _l, ...rest } = src as any;
            store.addItem({ ...rest, equipped: false, quantity: qty });
            console.log(`[Item] ${fromOwner} → B1 移交「${src.name}」x${qty}`);
            break;
          }
        }
        console.warn(`[Item] transferItem→B1 未定位来源物品（from=${data.from} id=${data.itemId} name=${givenName}），已忽略（不改动现有背包；若是新获得请用 createItem）`);
        break;
      }
      break;
    }
  }
}

function findItemById(store: any, id?: string): any | null {
  if (!id) return null;
  return store.items.find((it: any) => it.id === id) ?? null;
}

/* 名称模糊相等（归一化去标点后 相等 / 互相包含）：用于校验 itemId 指向的物品名字是否对得上 */
function nameLike(a?: string, b?: string): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
/* 解析销毁/消耗的目标物品：AI 常臆造 itemId，或把物品名误塞进 itemId 字段（漏填 name）。规则——
   ① itemId 命中、且名字与给定 name 相符（或未给 name）→ 用它；
   ② itemId 没命中（多为幻觉 id 或其实是个名字）→ name 与 itemId 都当作"可能的名字"做模糊匹配兜底；
   ③ 仍找不到 → 返回 null（宁可不删，也不按幻觉 id 删错你的装备/武器）；只有完全没给 name/itemId 时才退回 byId。 */
export function pickTargetItem(items: any[], itemId?: string, name?: string): any | null {
  const byId = itemId ? (items ?? []).find((x: any) => x.id === itemId) : null;
  if (byId && (!name || nameLike(byId.name, name))) return byId;
  // name 与 itemId 双查：AI 常把物品名误写进 itemId 且漏填 name，故 itemId 也当作可能的名字模糊匹配（id 格式串匹配不到中文名，安全）
  const byName = fuzzyFindItem(items, name, itemId);
  if (byName) return byName;
  return (name || itemId) ? null : byId;
}

/* 名称归一化：去空白 + 去常见标点/间隔符，跨回合"荒野行者·战术背心" vs "荒野行者战术背心"也能判为同物去重 */
function normName(s?: string): string {
  // 剥空白/间隔点/标点 + 装饰括号【】〔〕「」『』（）()〈〉 + 结构助词 的之——与 itemStore.dedupeByName 的归一口径一致，
  // 让 AI 重提时给物品名加的装饰（如「【月影残心】」vs「月影残心」）归一后相等，findIdenticalItem 才能判出重复（治"提一下就多两把")。
  return (s ?? '').replace(/[\s·•・\-—_,，.。、|｜【】〔〕「」『』〈〉（）()的之]/g, '').trim().toLowerCase();
}
function findItemByName(store: any, name?: string): any | null {
  if (!name) return null;
  const exact = store.items.find((it: any) => it.name === name);
  if (exact) return exact;
  const key = normName(name);
  if (!key) return null;
  return store.items.find((it: any) => normName(it.name) === key) ?? null;
}

/* 去掉名称里的括注/来源标记：（哥布林掉落）【…】(…)〔…〕[…]，用于消耗/销毁时的宽松匹配 */
function stripAnno(s?: string): string {
  return (s ?? '').replace(/[（(【〔[][^）)】〕\]]*[）)】〕\]]/g, '').trim();
}
/* 更"狠"的核心名：在 normName 基础上再去掉连接性助词（的/之/型/款/版）+ 数量/包装量词，
   用于最后一轮相似度匹配（"劣质的击晕器"→"劣质击晕器"）。不改 normName，避免影响精确去重/堆叠。*/
function coreName(s?: string): string {
  return normName(s).replace(/[的之型款版]/g, '');
}
/* 取字符 bigram 集合（≤1字时退化为单字符集合），用于 Jaccard 相似度 */
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length <= 1) { if (s) set.add(s); return set; }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
/* 宽松查找（仅用于 consume/destroy 等"找一件已存在物品来移除"的场景，不用于 createItem 去重，避免误并）：
   精确名 → 归一化名 → 去括注后归一化 → 包含匹配（取最长物品名）。
   解决 AI 把"白色宝箱（哥布林掉落）"当物品名、而背包里存的是"白色宝箱"导致找不到的问题。 */
function fuzzyFindItem(items: any[], ...queries: (string | undefined)[]): any | null {
  const list = items ?? [];
  // 第一轮：每个 query 走 精确 / 归一化
  for (const q of queries) {
    if (!q) continue;
    const exact = list.find((it) => it.name === q);
    if (exact) return exact;
    const key = normName(q);
    if (key) { const n = list.find((it) => normName(it.name) === key); if (n) return n; }
  }
  // 第二轮：去括注后精确 / 包含匹配（要求物品名 ≥2 字，取最长名以防误匹配短名）
  for (const q of queries) {
    if (!q) continue;
    const qb = normName(stripAnno(q));
    if (!qb || qb.length < 2) continue;
    const byBase = list.find((it) => normName(stripAnno(it.name)) === qb);
    if (byBase) return byBase;
    const contains = list
      .filter((it) => { const k = normName(it.name); return k.length >= 2 && (qb.includes(k) || normName(q).includes(k)); })
      .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0];
    if (contains) return contains;
  }
  // 第三轮：反向包含（物品名 含 query，如"止血喷雾"→"次级止血喷雾"；AI 常省略品级/前缀词）。取最短匹配名=最贴近 query 的那件。
  for (const q of queries) {
    if (!q) continue;
    const qb = normName(stripAnno(q));
    if (!qb || qb.length < 2) continue;
    const rev = list
      .filter((it) => { const k = normName(it.name); return k.length >= 2 && k.includes(qb); })
      .sort((a, b) => (a.name?.length ?? 0) - (b.name?.length ?? 0))[0];
    if (rev) return rev;
  }
  // 第四轮：字符 bigram 相似度兜底（容忍助词/语序/轻微改写："劣质的击晕器"→"劣质击晕器"）。
  // 取相似度最高且 ≥0.5 的物品；需与次高分拉开差距（≥0.12）或唯一高分，避免在多件相近物品间误删。
  {
    const qsets = queries.filter(Boolean).map((q) => bigrams(coreName(q!))).filter((s) => s.size);
    if (qsets.length) {
      let best: any = null, bestScore = 0, second = 0;
      for (const it of list) {
        const ib = bigrams(coreName(it.name));
        let sc = 0;
        for (const qs of qsets) sc = Math.max(sc, jaccard(qs, ib));
        if (sc > bestScore) { second = bestScore; bestScore = sc; best = it; }
        else if (sc > second) { second = sc; }
      }
      if (best && bestScore >= 0.5 && (bestScore - second >= 0.12 || second === 0)) return best;
    }
  }
  return null;
}

/* 可装备分类白名单：只有装备类（武器/防具/饰品 + 特殊装备/法宝/功法/技能书）能上装备栏；
   重要物品/消耗品/材料/工具/凡物/丹药/符箓/灵药/阵具/其他物品 等一律不可装备。 */
const EQUIPPABLE_CATS = new Set(['武器', '防具', '饰品', '特殊物品', '法宝', '功法']);
export function isEquippable(category?: string): boolean {
  return EQUIPPABLE_CATS.has(String(category ?? '').trim());
}

function buildSlotString(data: any): string {
  if (data.slot === 'armor' && data.armorPart) return `armor:${data.armorPart}`;
  if (data.slot === 'weapon' && data.weaponHand) return `weapon:${data.weaponHand}`;
  if (data.slot === 'treasure' && data.slotIndex !== undefined) return `treasure:#${data.slotIndex + 1}`;
  if (data.slot === 'accessory' && data.slotIndex !== undefined) return `accessory:#${data.slotIndex + 1}`;
  if (data.slot === 'technique' && data.slotIndex !== undefined) return `technique:${data.slotIndex}`;
  return data.slot ?? '';
}

// 将各种别名归一化为合法分类
const CATEGORY_MAP: Record<string, ItemCategory> = {
  // 装备类
  '武器': '武器',
  '防具': '防具', '护甲': '防具', '护具': '防具', '盔甲': '防具', '法衣': '防具',
    '内甲': '防具', '披风': '防具', '内衣': '防具', '战甲': '防具',
  '饰品': '饰品',
  // 消耗品 — 轮回乐园新分类（也接收旧丹药/符箓别名）
  '消耗品': '消耗品', '药剂': '消耗品', '药水': '消耗品', '炸弹': '消耗品', '道具卡': '消耗品',
    '丹药': '消耗品', '灵兽丹': '消耗品', '药丸': '消耗品', '灵丹': '消耗品',
    '符箓': '消耗品', '灵符': '消耗品', '符纸': '消耗品', '符宝': '消耗品', '卷轴': '消耗品',
  // 材料
  '材料': '材料', '灵药': '材料', '灵草': '材料', '灵植': '材料', '仙草': '材料',
    '药苗': '材料', '灵种': '材料', '矿石': '材料', '兽皮': '材料', '晶石': '材料',
  // 工具
  '工具': '工具', '炼金锅': '工具', '锻造炉': '工具', '医疗器械': '工具',
    '阵具': '工具', '阵盘': '工具', '阵旗': '工具', '阵图': '工具', '禁制盘': '工具',
  // 重要物品
  '重要物品': '重要物品', '任务物品': '重要物品', '令牌': '重要物品', '契约': '重要物品',
    '通行凭证': '重要物品', '地图': '重要物品', '情报': '重要物品',
  // 特殊物品
  '特殊物品': '特殊物品', '技能书': '特殊物品', '知识卷轴': '特殊物品',
    '图纸': '特殊物品', '配方': '特殊物品', '天赋碎片': '特殊物品',
    '功法': '特殊物品',   // 旧版功法归入特殊物品
  // 旧版法宝 — 无上下文时归其他，保持旧存档可读
  '法宝': '法宝', '法器': '法宝', '灵宝': '法宝', '古宝': '法宝',
  // 凡物
  '凡物': '凡物', '凡俗物品': '凡物',
};

function normalizeCategory(raw: string): ItemCategory {
  const trimmed = raw.trim();
  return (CATEGORY_MAP[trimmed] as ItemCategory) ?? '其他物品';
}

/* ════════════════════════════════════════════
   角色指令（addSkill / deSkill / addTrait / deTrait）
   格式：funcName("charId", payload)
   payload 是 JSON 对象 或 带引号的字符串
════════════════════════════════════════════ */

export type CharCommandType = 'addSkill' | 'deSkill' | 'addTrait' | 'deTrait' | 'addTalent' | 'deTalent' | 'addDeed' | 'addMemory' | 'addTitle' | 'deTitle' | 'equipTitle' | 'addAchievement' | 'deAchievement' | 'addSubProfession' | 'deSubProfession' | 'addRecipe' | 'deRecipe' | 'bumpSubProf' | 'bumpRecipe';

export interface CharCommand {
  type: CharCommandType;
  charId: string;
  payload: unknown;  // Skill 对象 | Trait 对象 | id/name 字符串
  raw: string;
}

// 匹配 funcName("charId", {...}) 或 funcName("charId", "string")
const CHAR_CMD_RE = /\b(addSkill|deSkill|addTrait|deTrait|addTalent|deTalent|addDeed|addMemory|addTitle|deTitle|equipTitle|addAchievement|deAchievement|addSubProfession|deSubProfession|addRecipe|deRecipe|bumpSubProf|bumpRecipe)\s*\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*?\}|"[^"]*")\s*\)/g;

function parseCharBlock(block: string): CharCommand[] {
  const cmds: CharCommand[] = [];
  CHAR_CMD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHAR_CMD_RE.exec(block)) !== null) {
    const type   = m[1] as CharCommandType;
    const charId = m[2];
    const rawPayload = m[3].trim();
    const payload = rawPayload.startsWith('{')
      ? lenientJsonParse(rawPayload)   // 容忍裸键(name: 而非 "name":)/单引号/尾逗号
      : rawPayload.replace(/^"|"$/g, '');
    if (payload === undefined) { console.warn('[Char] 指令解析失败:', m[0]); continue; }
    cmds.push({ type, charId, payload, raw: m[0] });
  }
  return cmds;
}

export function parseAllCharCommands(text: string): CharCommand[] {
  return [...extractUpstoreBlocks(text).flatMap(parseCharBlock), ...parseEditChars(text)];   // <upstore> 与 <edit> 等效合流
}

/* ════════════════════════════════════════════
   将 CharCommand 应用到 characterStore
════════════════════════════════════════════ */

/* ════════════════════════════════════════════
   NPC 指令（add / de）
   add("C1", {"4":"...", "12":"..."})  — 列覆盖式增量更新
   de("C1")                            — 软删除/离场
   注意：用负向断言避免吞掉 addSkill/addTrait/deSkill/deTrait
════════════════════════════════════════════ */

export type NpcCommandType = 'add' | 'de';

export interface NpcCommand {
  type: NpcCommandType;
  id: string;
  payload?: Record<string, unknown>;
  raw: string;
}

// add(?!…) 确保不匹配 addSkill/addTrait/addTalent/addTitle/addAchievement/addSubProfession/addRecipe
const NPC_ADD_RE = /\badd(?!Skill|Trait|Talent|Title|Achievement|SubProfession|Recipe)\s*\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
// de(?![A-Za-z]) 确保不匹配 deSkill/deTrait（后面必须紧跟非字母）
const NPC_DE_RE  = /\bde(?![A-Za-z])\s*\(\s*"([^"]+)"\s*\)/g;

function parseNpcBlock(block: string): NpcCommand[] {
  const cmds: NpcCommand[] = [];

  NPC_ADD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NPC_ADD_RE.exec(block)) !== null) {
    const id = m[1];
    const payload = lenientJsonParse(m[2]);   // 容忍裸键/单引号/尾逗号
    if (payload !== undefined) cmds.push({ type: 'add', id, payload, raw: m[0] });
    else console.warn('[NPC] add 指令 JSON 解析失败:', m[0]);
  }

  NPC_DE_RE.lastIndex = 0;
  while ((m = NPC_DE_RE.exec(block)) !== null) {
    cmds.push({ type: 'de', id: m[1], raw: m[0] });
  }

  return cmds;
}

export function parseAllNpcCommands(text: string): NpcCommand[] {
  return [...extractUpstoreBlocks(text).flatMap(parseNpcBlock), ...parseEditNpcs(text)];   // <upstore> 与 <edit> 等效合流
}

/* 第1期闸门（NPC）：同批次精确去重 + 账本审计 + 结构化结果；身份/重定向仍由 *Raw 内层处理（零侵入）。
 * 旧调用方只传 cmds 即可（ctx 缺省 auto），返回值可忽略——向后兼容。 */
export function applyNpcCommands(
  cmds: NpcCommand[],
  ctx: EvoCtx = { source: 'auto', turn: useItems.getState().itemTurn },
): EvoResult[] {
  const results: EvoResult[] = [];
  if (cmds.length === 0) return results;
  const batch = new Set<string>();
  for (const c of cmds) {
    const op = c.type;
    const ref = npcRef(c.id, c.payload);
    try {
      const key = npcDigest(c.type, c.id, c.payload);
      if (batch.has(key)) {
        recordEvo('npc', ctx, op, ref, 'dup', '同批次重复指令');
        results.push({ ok: true, entity: 'npc', op, ref, skipped: true, reason: 'dup' });
        continue;
      }
      batch.add(key);
      applyNpcCommandsRaw([c]);   // 委托内层（含同名重定向/非法ID规范化/软删），行为不变
      recordEvo('npc', ctx, op, ref, 'applied');
      results.push({ ok: true, entity: 'npc', op, ref });
    } catch (e: any) {
      recordEvo('npc', ctx, op, ref, 'error', String(e?.message ?? e));
      results.push({ ok: false, entity: 'npc', op, ref, reason: 'error', detail: String(e?.message ?? e) });
    }
  }
  return results;
}

function applyNpcCommandsRaw(cmds: NpcCommand[]): void {
  if (cmds.length === 0) return;
  for (const c of cmds) {
    try {
      const store = useNpc.getState();   // 每条都取最新，能看到同批前面的新建，避免批内重复
      if (c.type === 'add') {
        let id = c.id;
        // 防重复：当本条是"新建"（目标 id 尚不存在）且 payload 里的姓名与某个既有真实角色相同时，
        // 重定向到既有角色（视为重新登场/更新），而不是另建一个同名 NPC。
        const rawName = String((c.payload as any)?.['1'] ?? (c.payload as any)?.['name'] ?? '');
        const nm = rawName.split('|')[0].trim();
        if (nm && !store.npcs[id]) {
          const exist = Object.values(store.npcs).find(
            (r) => !r.isDead && r.name && r.name !== r.id && r.name.trim() === nm && (r.realm || r.personality || r.background),
          );
          if (exist && exist.id !== id) {
            console.warn(`[NPC] add("${id}") 与既有同名角色「${nm}」(${exist.id}) 重复，重定向到 ${exist.id}（防重复建档）`);
            id = exist.id;
          }
        }
        // 规范化：AI 自创的非法 ID（如 P_Aesc）若是全新角色，改用下一个空闲 C 编号——
        // 否则后续所有短指令(character.C\d+ / hp.C\d+ …)都匹配不到它，更新会被静默丢弃。
        if (!isNpcId(id) && !store.npcs[id]) {
          const used = new Set(Object.keys(store.npcs));
          let k = 1; while (used.has(`C${k}`)) k++;
          console.warn(`[NPC] add("${id}") 使用非法ID，改用空闲编号 C${k}`);
          id = `C${k}`;
        }
        store.applyColumns(id, c.payload ?? {});
        console.log(`[NPC] add ${id}:`, c.payload);
      } else {
        store.removeNpc(c.id);
        console.log(`[NPC] de ${c.id} → 离场(B区)`);
      }
    } catch (e) {
      console.warn('[NPC] 指令应用失败:', c, e);
    }
  }
}

/* ════════════════════════════════════════════
   势力指令：addFaction("F1",{...命名键...}) / deFaction("F1")
════════════════════════════════════════════ */
export interface FactionCommand { type: 'add' | 'de'; id: string; payload?: Record<string, unknown>; raw: string; }
const FAC_ADD_RE = /\baddFaction\s*\(\s*"([^"]+)"\s*,\s*(\{[\s\S]*?\})\s*\)/g;
const FAC_DE_RE  = /\bdeFaction\s*\(\s*"([^"]+)"\s*\)/g;
function parseFactionBlock(block: string): FactionCommand[] {
  const cmds: FactionCommand[] = []; let m: RegExpExecArray | null;
  FAC_ADD_RE.lastIndex = 0;
  while ((m = FAC_ADD_RE.exec(block)) !== null) {
    const payload = lenientJsonParse(m[2]);
    if (payload !== undefined) cmds.push({ type: 'add', id: m[1], payload, raw: m[0] });
    else console.warn('[Faction] add JSON 解析失败:', m[0]);
  }
  FAC_DE_RE.lastIndex = 0;
  while ((m = FAC_DE_RE.exec(block)) !== null) cmds.push({ type: 'de', id: m[1], raw: m[0] });
  return cmds;
}
export function parseAllFactionCommands(text: string): FactionCommand[] {
  return [...extractUpstoreBlocks(text).flatMap(parseFactionBlock), ...parseEditFactions(text)];   // <upstore> 与 <edit> 等效合流
}
/* 第2期闸门（势力）：同批次精确去重 + 账本审计 + 结构化结果。de 为软删(移出当前世界·同 NPC)，故不做 not_found 检测。
 * 旧调用方只传 cmds 即可（ctx 缺省 auto），返回值可忽略——向后兼容。 */
export function applyFactionCommands(
  cmds: FactionCommand[],
  ctx: EvoCtx = { source: 'auto', turn: useItems.getState().itemTurn },
): EvoResult[] {
  const results: EvoResult[] = [];
  if (cmds.length === 0) return results;
  const batch = new Set<string>();
  for (const c of cmds) {
    const op = c.type;
    const ref = npcRef(c.id, c.payload);   // 复用通用 id+名 引用（payload['1']/name）
    try {
      const key = npcDigest(c.type, c.id, c.payload);
      if (batch.has(key)) {
        recordEvo('faction', ctx, op, ref, 'dup', '同批次重复指令');
        results.push({ ok: true, entity: 'faction', op, ref, skipped: true, reason: 'dup' });
        continue;
      }
      batch.add(key);
      applyFactionCommandsRaw([c]);
      recordEvo('faction', ctx, op, ref, 'applied');
      results.push({ ok: true, entity: 'faction', op, ref });
    } catch (e: any) {
      recordEvo('faction', ctx, op, ref, 'error', String(e?.message ?? e));
      results.push({ ok: false, entity: 'faction', op, ref, reason: 'error', detail: String(e?.message ?? e) });
    }
  }
  return results;
}

function applyFactionCommandsRaw(cmds: FactionCommand[]): void {
  if (cmds.length === 0) return;
  const store = useFaction.getState();
  for (const c of cmds) {
    try {
      if (c.type === 'add') { store.applyColumns(c.id, c.payload ?? {}); console.log(`[Faction] add ${c.id}`); }
      else { store.removeFaction(c.id); console.log(`[Faction] de ${c.id} → 移出当前世界`); }
    } catch (e) { console.warn('[Faction] 指令应用失败:', c, e); }
  }
}

/* ════════════════════════════════════════════
   领地指令（单一基地）：
   <upstore> unlockTerritory / setTerritory / addBuilding / upgradeBuilding /
            deBuilding / addTerritoryEffect / deTerritoryEffect /
            addMember / removeMember / storeItem / takeItem
   <state>   territory.progress|level|appearance|name|passiveOutput
   applyTerritoryCommands(text) 一站式解析+应用，返回应用条数
════════════════════════════════════════════ */
function parseJsonArg(raw: string): any | null {
  const v = lenientJsonParse(raw);   // 容忍裸键/单引号/尾逗号
  return v === undefined ? null : v;
}

export function applyTerritoryCommands(text: string): number {
  const store = useTerritory.getState();
  let n = 0;
  const blocks = extractUpstoreBlocks(text).join('\n');
  let m: RegExpExecArray | null;

  const objCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm);
    return out;
  };
  const idObjCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*"([^"]+)"\\s*(?:,\\s*(\\{[\\s\\S]*?\\}))?\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm);
    return out;
  };
  const idArgCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*"([^"]+)"\\s*(?:,\\s*(-?\\d+))?\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm);
    return out;
  };

  try {
    // 开辟 / 概况
    for (const mm of objCall('unlockTerritory')) {
      const d = parseJsonArg(mm[1]); if (!d) continue;
      store.unlock({ name: d.name, appearance: d.appearance }); n++;
    }
    for (const mm of objCall('setTerritory')) {
      const d = parseJsonArg(mm[1]); if (!d) continue;
      store.setTerritory({ name: d.name, appearance: d.appearance, level: d.level, passiveOutput: d.passiveOutput });
      n++;
    }
    // 建筑
    for (const mm of objCall('addBuilding')) {
      const d = parseJsonArg(mm[1]); if (!d || !d.name) continue;
      store.upsertBuilding({ name: String(d.name), level: d.level, effect: d.effect, appearance: d.appearance, description: d.description ?? d.desc });
      n++;
    }
    for (const mm of objCall('upgradeBuilding')) {
      const d = parseJsonArg(mm[1]); if (!d || !d.name || d.level == null) continue;
      store.setBuildingLevel(String(d.name), Number(d.level)); n++;
    }
    for (const mm of idArgCall('deBuilding')) { store.removeBuilding(mm[1]); n++; }
    for (const mm of idArgCall('removeBuilding')) { store.removeBuilding(mm[1]); n++; }
    // 领地效果
    for (const mm of objCall('addTerritoryEffect')) {
      const d = parseJsonArg(mm[1]); if (!d || !d.name) continue;
      store.upsertEffect({ name: String(d.name), desc: d.desc ?? d.effect ?? '', source: d.source }); n++;
    }
    for (const mm of idArgCall('deTerritoryEffect')) { store.removeEffect(mm[1]); n++; }
    // 成员（关联 NPC C-id）
    for (const mm of idObjCall('addMember')) {
      const d = mm[2] ? parseJsonArg(mm[2]) : {};
      store.addMember(mm[1], { role: d?.role, note: d?.note ?? d?.desc }); n++;
    }
    for (const mm of idArgCall('removeMember')) { store.removeMember(mm[1]); n++; }
    // 仓库
    for (const mm of objCall('storeItem')) {
      const d = parseJsonArg(mm[1]); if (!d || !d.name) continue;
      store.storeItem({
        name: String(d.name), quantity: d.quantity ?? d.qty, category: d.category,
        gradeDesc: d.gradeDesc ?? d.quality, effect: d.effect, desc: d.desc ?? d.description, appearance: d.appearance,
      });
      n++;
    }
    for (const mm of idArgCall('takeItem')) { store.takeItem(mm[1], mm[2] != null ? Number(mm[2]) : undefined); n++; }
    // 去重自愈：把"用名字误当 id"的成员归位到 C-id 并合并；仓库同名物资合并（修 AI 反复生成的重复条目）
    store.reconcileMembers(useNpc.getState().npcs);
    store.dedupeStorage();
  } catch (e) { console.warn('[Territory] upstore 指令应用失败:', e); }

  // ── <state> 短指令 ──
  const stateText = extractStateBlocks(text).join('\n') || text;
  const progRe = /\bterritory\.progress\s*(=|\+=|-=)\s*(-?\d+(?:\.\d+)?)/g;
  while ((m = progRe.exec(stateText))) {
    const v = Number(m[2]);
    if (m[1] === '=') store.setProgress(v);
    else store.addProgress(m[1] === '+=' ? v : -v);
    n++;
  }
  const lvRe = /\bterritory\.level\s*(=|\+=|-=)\s*(\d+)/g;
  while ((m = lvRe.exec(stateText))) {
    const cur = useTerritory.getState().level;
    const v = Number(m[2]);
    store.setLevel(m[1] === '=' ? v : m[1] === '+=' ? cur + v : cur - v);
    n++;
  }
  const apRe = /\bterritory\.appearance\s*=\s*"([^"]*)"/g;
  while ((m = apRe.exec(stateText))) { store.setTerritory({ appearance: m[1] }); n++; }
  const nmRe = /\bterritory\.name\s*=\s*"([^"]*)"/g;
  while ((m = nmRe.exec(stateText))) { store.setTerritory({ name: m[1] }); n++; }
  const poRe = /\bterritory\.passiveOutput\s*=\s*"([^"]*)"/g;
  while ((m = poRe.exec(stateText))) { store.setTerritory({ passiveOutput: m[1] }); n++; }

  return n;
}

/* ════════════════════════════════════════════
   冒险团指令（仅主角单一冒险团）：
   <upstore> establishTeam / addTeamMember / removeTeamMember / addTeamPerk /
            deTeamPerk / startAssessment / resolveAssessment / addTeamDeed / setTeam
   <state>   team.exp / team.activity / team.rank / team.name
   applyTeamCommands(text) 一站式解析+应用，返回应用条数
════════════════════════════════════════════ */
const TEAM_RANK_SET = new Set(['E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS']);
export function applyTeamCommands(text: string): number {
  const store = useTeam.getState();
  let n = 0;
  const blocks = extractUpstoreBlocks(text).join('\n');
  let m: RegExpExecArray | null;
  const objCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*(\\{[\\s\\S]*?\\})\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm); return out;
  };
  const idObjCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*"([^"]+)"\\s*(?:,\\s*(\\{[\\s\\S]*?\\}))?\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm); return out;
  };
  const idArgCall = (fn: string): RegExpExecArray[] => {
    const re = new RegExp(`\\b${fn}\\s*\\(\\s*"([^"]+)"\\s*\\)`, 'g');
    const out: RegExpExecArray[] = []; let mm: RegExpExecArray | null;
    while ((mm = re.exec(blocks)) !== null) out.push(mm); return out;
  };
  const pj = (raw: string): any | null => { const v = lenientJsonParse(raw); return v === undefined ? null : v; };

  try {
    for (const mm of objCall('establishTeam')) { const d = pj(mm[1]); store.establish({ name: d?.name }); n++; }
    for (const mm of objCall('setTeam')) { const d = pj(mm[1]); if (d) { store.setTeam({ name: d.name, disbanded: d.disbanded }); n++; } }
    for (const mm of idObjCall('addTeamMember')) { const d = mm[2] ? pj(mm[2]) : {}; store.upsertMember(mm[1], { role: d?.role, note: d?.note }); n++; }
    for (const mm of idArgCall('removeTeamMember')) { store.removeMember(mm[1]); n++; }
    for (const mm of objCall('addTeamPerk')) { const d = pj(mm[1]); if (d?.name) { store.upsertPerk({ name: String(d.name), desc: d.desc ?? d.effect ?? '', source: d.source }); n++; } }
    for (const mm of idArgCall('deTeamPerk')) { store.removePerk(mm[1]); n++; }
    for (const mm of objCall('startAssessment')) { const d = pj(mm[1]); const tr = String(d?.targetRank ?? '').toUpperCase(); if (TEAM_RANK_SET.has(tr)) { store.startAssessment(tr as TeamRank, !!d?.isEstablish); n++; } }
    for (const mm of objCall('resolveAssessment')) { const d = pj(mm[1]); const r = String(d?.result ?? '').toLowerCase(); if (r === 'pass' || r === 'fail' || r === 'disband') { store.resolveAssessment(r); n++; } }
    for (const mm of objCall('addTeamDeed')) {
      const d = pj(mm[1]); if (!d) continue;
      const desc = d.description ?? d.desc ?? (typeof d === 'string' ? d : '');
      if (desc) { store.appendDeed({ time: d.time ?? '', location: d.location ?? '', description: desc }); n++; }
    }
  } catch (e) { console.warn('[Team] upstore 指令应用失败:', e); }

  // ── <state> 短指令 ──
  const stateText = extractStateBlocks(text).join('\n') || text;
  const expRe = /\bteam\.exp\s*(=|\+=|-=)\s*(-?\d+(?:\.\d+)?)/g;
  while ((m = expRe.exec(stateText))) { const v = Number(m[2]); if (m[1] === '=') store.setExp(v); else store.addExp(m[1] === '+=' ? v : -v); n++; }
  const actRe = /\bteam\.activity\s*(=|\+=|-=)\s*(-?\d+(?:\.\d+)?)/g;
  while ((m = actRe.exec(stateText))) { const v = Number(m[2]); store.addActivity(m[1] === '=' ? (v - useTeam.getState().activity) : m[1] === '+=' ? v : -v); n++; }
  const rankRe = /\bteam\.rank\s*=\s*"?(SSS|SS|S|A|B|C|D|E)"?/g;
  while ((m = rankRe.exec(stateText))) { store.setRank(m[1] as TeamRank); n++; }
  const nmRe = /\bteam\.name\s*=\s*"([^"]*)"/g;
  while ((m = nmRe.exec(stateText))) { store.setTeam({ name: m[1] }); n++; }
  const asRe = /\bteam\.assessment\s*=\s*"?(pass|passed|fail|failed|disband)"?/g;
  while ((m = asRe.exec(stateText))) { const r = m[1].startsWith('pass') ? 'pass' : m[1] === 'disband' ? 'disband' : 'fail'; store.resolveAssessment(r as any); n++; }

  return n;
}

// 注：第二参数 narrative 目前未被函数体使用——原是「全新副职业须正文有明确习得动作才建」的判据，
// 副职业改「配方星图」后只能由树加（已屏蔽正文 addSubProfession），该判据失效；以 _ 前缀标记有意保留入参槽，
// 调用方仍可传（被忽略），将来若要恢复正文级守卫可在此接回。
/** de* 指令的目标集合大小（删除前后比对判定"是否真的删到了东西"）；非可测 de* 返回 null。*/
function charTargetCount(charId: string, type: string): number | null {
  const ch: any = useCharacters.getState().characters[charId];
  switch (type) {
    case 'deSkill':          return ch?.skills?.length ?? 0;
    case 'deTrait':
    case 'deTalent':         return ch?.traits?.length ?? 0;
    case 'deTitle':          return ch?.titles?.length ?? 0;
    case 'deSubProfession':  return ch?.subProfessions?.length ?? 0;
    case 'deRecipe':         return (ch?.subProfessions ?? []).reduce((n: number, p: any) => n + (p.recipes?.length ?? 0), 0);
    case 'deAchievement':    return /^B\d+$/.test(charId) ? (usePlayer.getState().achievements?.length ?? 0) : null;
    default:                 return null;
  }
}

/* 第1期闸门（角色）：同批次精确去重 + 账本审计 + de* 目标不存在检测 + 结构化结果。
 * 内层逻辑(addSkill/deSkill/addTitle/副职业/配方/成就/事迹…)由 *Raw 原样承接，零侵入。
 * 旧调用方传 (cmds[, narrative]) 即可，返回值可忽略——向后兼容。 */
export function applyCharacterCommands(
  commands: CharCommand[],
  _narrative?: string,
  ctx: EvoCtx = { source: 'auto', turn: useItems.getState().itemTurn },
): EvoResult[] {
  const results: EvoResult[] = [];
  if (commands.length === 0) return results;
  const batch = new Set<string>();
  for (const cmd of commands) {
    const op = cmd.type;
    const ref = charRef(cmd.charId, cmd.payload);
    try {
      const key = charDigest(cmd.type, cmd.charId, cmd.payload);
      if (batch.has(key)) {
        recordEvo('char', ctx, op, ref, 'dup', '同批次重复指令');
        results.push({ ok: true, entity: 'char', op, ref, skipped: true, reason: 'dup' });
        continue;
      }
      batch.add(key);
      const isDe = op.startsWith('de');
      const before = isDe ? charTargetCount(cmd.charId, op) : null;
      applyCharacterCommandsRaw([cmd], _narrative);   // 委托内层，行为不变
      if (isDe && before != null) {
        const after = charTargetCount(cmd.charId, op);
        if (after != null && after === before) {   // 删除前后数量不变 = 没删到 = 目标不存在
          recordEvo('char', ctx, op, ref, 'fail', '目标不存在/未移除');
          results.push({ ok: false, entity: 'char', op, ref, reason: 'not_found' });
          continue;
        }
      }
      recordEvo('char', ctx, op, ref, 'applied');
      results.push({ ok: true, entity: 'char', op, ref });
    } catch (e: any) {
      recordEvo('char', ctx, op, ref, 'error', String(e?.message ?? e));
      results.push({ ok: false, entity: 'char', op, ref, reason: 'error', detail: String(e?.message ?? e) });
    }
  }
  return results;
}

function applyCharacterCommandsRaw(commands: CharCommand[], _narrative?: string): void {
  if (commands.length === 0) return;
  const store = useCharacters.getState();

  for (const cmd of commands) {
    try {
      const { type, charId, payload } = cmd;

      if (type === 'addSkill') {
        const d: any = payload;
        // NPC 技能是否新增/更新交由 AI（演化预设）判断，不再机械拦截
        store.addSkill(charId, {
          id:            d['0'] ?? d.id ?? `S_${charId}_${Date.now()}`,
          name:          d['1'] ?? d.name ?? '未知技能',
          level:         d['2'] ?? d.level ?? '',
          cooldown:      d['3'] ?? d.cooldown,
          desc:          d['4'] ?? d.desc ?? d.description ?? '',
          layers:        d['5'] ?? d.layers,
          effect:        d['6'] ?? d.effect ?? '',
          layerProgress: d['7'] ?? d.layerProgress,
          cost:          d['8'] ?? d.cost,
          layerEffects:  d['9'] ?? d.layerEffects,
          // 固定格式补充字段（命名键）
          skillType:     d.skillType ?? d.type,
          rarity:        d.rarity ?? d.tier,
          target:        d.target,
          damage:        d.damage,
          attrBonus:     d.attrBonus ?? d.attr,
          tags:          Array.isArray(d.tags) ? d.tags : undefined,
          note:          d.note ?? d.remark ?? d['备注'],
          numeric:       d.numeric,
        });
        console.log(`[Char] addSkill ${charId}: ${d['1'] ?? d.name}`);
      }

      else if (type === 'deSkill') {
        store.removeSkill(charId, payload as string);
        console.log(`[Char] deSkill ${charId}: ${payload}`);
      }

      // addTalent 为天赋首选指令；addTrait 为向后兼容别名，二者同通道
      else if (type === 'addTrait' || type === 'addTalent') {
        const d: any = payload;
        // NPC 天赋是否新增/更新交由 AI（演化预设）判断，不再机械拦截
        store.addTrait(charId, {
          name:     d.name ?? d['0'] ?? '未知天赋',
          desc:     d.desc ?? d.description ?? d['1'] ?? '',
          source:   d.source,
          effect:   d.effect ?? d['2'] ?? '',
          rarity:   d.rarity ?? d.tier ?? d.grade ?? 'C',
          category: d.category ?? d.type,
          level:    d.level,
          attrBonus: d.attrBonus ?? d.attr,
          note:     d.note ?? d.remark ?? d['备注'],
          numeric:  d.numeric,
        });
        console.log(`[Char] ${type} ${charId}: ${d.name}`);
      }

      else if (type === 'deTrait' || type === 'deTalent') {
        store.removeTrait(charId, payload as string);
        console.log(`[Char] ${type} ${charId}: ${payload}`);
      }

      else if (type === 'addTitle') {
        const d: any = payload;
        const name = d.name ?? d['0'];
        if (!name) { console.warn('[Char] addTitle 缺少名称，跳过'); continue; }
        store.addTitle(charId, {
          name,
          obtainedTime: d.obtainedTime ?? d.time,
          rarity:       d.rarity ?? d.tier ?? 'C',
          source:       d.source,
          effect:       d.effect,
          desc:         d.desc ?? d.description,
          equipped:     d.equipped === true || d.equipped === 'true',
        });
        console.log(`[Char] addTitle ${charId}: ${name}`);
      }

      else if (type === 'deTitle') {
        store.removeTitle(charId, payload as string);
        console.log(`[Char] deTitle ${charId}: ${payload}`);
      }

      else if (type === 'equipTitle') {
        store.equipTitle(charId, payload as string);
        console.log(`[Char] equipTitle ${charId}: ${payload}`);
      }

      // 成就（仅主角 B*；NPC 不建模成就）
      else if (type === 'addAchievement') {
        if (!/^B\d+$/.test(charId)) { continue; }
        const d: any = payload;
        const id = d.id ?? d['0'] ?? d.name;
        if (!id) { console.warn('[Char] addAchievement 缺少 id/name，跳过'); continue; }
        usePlayer.getState().addAchievement({
          id:        String(id),
          name:      d.name ?? '未命名成就',
          desc:      d.desc ?? d.description ?? '',
          category:  d.category ?? '其他',
          type:      d.type ?? '普通',
          rarity:    d.rarity ?? d.tier ?? '白色',
          hidden:    d.hidden === true || d.hidden === 'true',
          condition: d.condition ?? d.unlock ?? '',
          unlockTime: d.unlockTime ?? d.time,
        });
        console.log(`[Char] addAchievement ${charId}: ${id}`);
      }

      else if (type === 'deAchievement') {
        if (/^B\d+$/.test(charId)) usePlayer.getState().removeAchievement(payload as string);
      }

      else if (type === 'addSubProfession') {
        // 【铁则】副职业只能由主角在「副职业配方树」上点亮该树而获得——绝不由正文/AI 凭空添加。这里一律屏蔽。
        const d: any = payload;
        console.warn(`[Char] 已屏蔽正文/AI 添加副职业（副职业只能经副职业配方树获得）: ${d?.name ?? cmd.raw}`);
        continue;
      }
      else if (type === 'deSubProfession') {
        if (/^B\d+$/.test(charId)) store.removeSubProfession(charId, payload as string);
      }
      else if (type === 'addRecipe') {
        if (!/^B\d+$/.test(charId)) { continue; }   // 副职业仅主角
        const d: any = payload;
        const prof = d.prof ?? d.subProfession ?? d.profession;
        if (!prof || !d.name) { console.warn('[Char] addRecipe 缺少 prof/name'); continue; }
        store.addRecipe(charId, prof, {
          id: d.id ?? `R_${charId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          name: d.name, tier: d.tier, progress: d.progress,
          materials: d.materials, output: d.output, desc: d.desc,
        });
        console.log(`[Char] addRecipe ${charId}/${prof}: ${d.name}`);
      }
      else if (type === 'deRecipe') {
        if (!/^B\d+$/.test(charId)) { continue; }   // 副职业仅主角
        const d: any = payload;
        if (typeof d === 'string') { const [p, nm] = d.split('::'); if (p && nm) store.removeRecipe(charId, p, nm); }
        else if (d.prof && d.name) store.removeRecipe(charId, d.prof, d.name);
      }
      else if (type === 'bumpRecipe') {
        // 练习/制作某配方：仅配方熟练度 += delta（副职业熟练度=树上潜能点，不再随正文 bump）
        if (!/^B\d+$/.test(charId)) { continue; }   // 副职业仅主角
        const d: any = payload;
        const prof = d.prof ?? d.subProfession ?? d.profession;
        const name = d.name ?? d.recipe;
        const delta = Number(d.delta ?? d.progress ?? d.amount);
        if (prof && name && Number.isFinite(delta) && delta !== 0) {
          store.bumpRecipe(charId, prof, name, delta);
          console.log(`[Char] bumpRecipe ${charId}/${prof}/${name}: ${delta > 0 ? '+' : ''}${delta}`);
        } else { console.warn('[Char] bumpRecipe 缺少 prof/name/delta', d); }
      }
      else if (type === 'bumpSubProf') {
        // 【铁则】副职业熟练度 = 在副职业配方树上耗费的潜能点（前端机械派生）——绝不由正文/AI bump。屏蔽。
        console.warn('[Char] 已屏蔽正文/AI 调整副职业总熟练度（副职业熟练度只来自配方树潜能点）');
        continue;
      }

      else if (type === 'addDeed') {
        const d: any = payload;
        const deed = {
          time:        (typeof d === 'object' ? d.time ?? d['0'] : '') ?? '',
          location:    (typeof d === 'object' ? d.location ?? d['1'] : '') ?? '',
          description: typeof d === 'string' ? d : (d.description ?? d['2'] ?? ''),
        };
        if (!deed.description) { console.warn('[Char] addDeed 缺少描述，跳过:', cmd.raw); continue; }
        if (/^[CG]\d+$/.test(charId)) {
          useNpc.getState().appendDeed(charId, deed);          // NPC → npcStore
        } else if (/^F\d+$/.test(charId)) {
          useFaction.getState().appendDeed(charId, deed);       // 势力 → factionStore
        } else {
          usePlayer.getState().appendPlayerDeed(deed);          // 主角(B*) → playerStore
        }
        console.log(`[Char] addDeed ${charId}: ${deed.description}`);
      }

      else if (type === 'addMemory') {
        const d: any = payload;
        const entry = {
          time:     (typeof d === 'object' ? d.time ?? d['0'] : '') ?? '',
          location: (typeof d === 'object' ? d.location ?? d['1'] : '') ?? '',
          content:  typeof d === 'string' ? d : (d.content ?? d.description ?? d['2'] ?? ''),
        };
        if (!entry.content) { console.warn('[Char] addMemory 缺少内容，跳过:', cmd.raw); continue; }
        store.appendMemory(charId, entry);                      // → characterStore.shortTerm
        console.log(`[Char] addMemory ${charId}: ${entry.content}`);
      }

    } catch (e) {
      console.warn('[Char] 指令应用失败:', cmd, e);
    }
  }
}
