/* 物品演化底层重构 · 第0期「单一闸门」的纯逻辑件
 *
 * 这里只放**不依赖 store/解析器**的纯函数 + 账本写入薄封装 + 反馈文案，便于单测、避免与 stateParser 形成循环依赖。
 * 真正的"解析目标→稳定 id / 拦截重复 / 应用"在 stateParser.applyItemCommands（那里有 pickTargetItem 等现成件）。
 *
 * 提供：
 *  - opOf / refOf / digestOf —— 把一条物品指令归一成 操作类型 / 人类可读引用 / 逻辑身份摘要
 *  - newBatch / isBatchDup —— 同批次精确去重（同一条逻辑指令被解析或复读两次）
 *  - recordItem —— 写一条账本事件（失败绝不阻断主流程）
 *  - buildItemFeedback —— 把未生效的编辑汇成一段回喂自纠文案（仿"数据库脚本"的 SQL_ERROR_FEEDBACK）
 */
import { useLedger, type LedgerOutcome } from './ledgerStore';

export type ItemOp =
  | 'create' | 'consume' | 'destroy' | 'currency'
  | 'equip' | 'unequip' | 'updateQty' | 'update' | 'transfer' | 'other';

export interface LedgerCtx {
  source: string;
  turn: number;
}

export interface ItemEditResult {
  ok: boolean;
  op: ItemOp;
  ref: string;
  uid?: string;
  skipped?: boolean;
  reason?: 'dup' | 'not_found' | 'invalid' | 'error';
  detail?: string;
  nearest?: string;
}

/** 指令最小形状（避免 import stateParser.ItemCommand 造成类型循环）。*/
type CmdLike = { type: string; data?: any };

const OP_MAP: Record<string, ItemOp> = {
  createItem: 'create',
  consumeItem: 'consume',
  destroyItem: 'destroy',
  transferSpiritStones: 'currency',
  transferCurrency: 'currency',
  equipItem: 'equip',
  unequipItem: 'unequip',
  updateItemQuantity: 'updateQty',
  updateItem: 'update',
  transferItem: 'transfer',
};

export function opOf(type: string): ItemOp {
  return OP_MAP[type] ?? 'other';
}

/** 名称归一化：去标点/空格 + 去「的/之」等虚词（与 itemStore/stateParser 同口径）。*/
const norm = (x: unknown) =>
  String(x ?? '').replace(/[\s·•・\-—_,，.。、|｜【】（）()的之]/g, '').trim().toLowerCase();

/** 一条物品指令的人类可读引用（名 > id），用于账本与反馈展示。*/
export function refOf(cmd: CmdLike): string {
  const d = cmd.data ?? {};
  const item = d.item ?? d;
  const s = String(
    d.name ?? item?.name ?? item?.['1'] ?? d.itemName ?? d.itemId ?? d.type ?? d.grade ?? '',
  ).trim();
  return s || '?';
}

/** 指令的"逻辑身份"摘要：用于**同批次**精确去重（同一条指令被解析两次/AI 复读一行）。*/
export function digestOf(cmd: CmdLike): string {
  const op = opOf(cmd.type);
  const d = cmd.data ?? {};
  const item = d.item ?? d;
  switch (op) {
    case 'create':
      return [
        'create',
        norm(item?.['1'] ?? item?.name),
        norm(item?.['3'] ?? item?.grade ?? item?.quality),
        norm(d.owner ?? item?.owner ?? 'B1'),
        norm(item?.['4'] ?? item?.effect),
      ].join('|');
    case 'currency':
      return [
        'currency',
        norm(d.type ?? d.grade),
        Number(d.amount ?? 0),
        norm(d.to),
        norm(d.from),
        norm(d.reason),
      ].join('|');
    default:
      return [
        op,
        norm(d.name ?? item?.['1'] ?? d.itemName),
        norm(d.itemId),
        norm(d.owner),
        Number(d.quantity ?? d.newQuantity ?? 0),
      ].join('|');
  }
}

export function newBatch(): Set<string> {
  return new Set<string>();
}

/** 同批次精确重复（同一条逻辑指令出现两次）→ 返回 true 并登记；首次出现返回 false。*/
export function isBatchDup(batch: Set<string>, cmd: CmdLike): boolean {
  const k = digestOf(cmd);
  if (batch.has(k)) return true;
  batch.add(k);
  return false;
}

/** 写一条物品账本事件（任何失败都吞掉，账本绝不阻断主流程）。*/
export function recordItem(
  ctx: LedgerCtx,
  op: ItemOp,
  ref: string,
  outcome: LedgerOutcome,
  detail?: string,
  uid?: string,
): void {
  try {
    useLedger.getState().append({ turn: ctx.turn, source: ctx.source, entity: 'item', op, ref, uid, outcome, detail });
  } catch {
    /* 账本写入失败可忽略 */
  }
}

/* ── 货币跨阶段双计去重（history-based）──
 * 同一回合同一笔奖励被正文 + 物品阶段各发一次 → 钱包翻倍。这里按 (canonType|amount|reason) 给每笔"已发放"货币
 * 记一个 key 进账本事件的 uid;同回合再来同 key 就跳过。**要求 reason 非空**——否则两笔无理由的同额奖励会被误并。 */
export function currencyDupKey(canonType: string, amount: number, reason?: unknown): string | null {
  const r = String(reason ?? '').trim();
  if (!canonType || !(amount > 0) || !r) return null;   // 无金额/无原因 → 不去重（宁可漏防双计，也不误并两笔不同奖励）
  return `${canonType}|${amount}|${norm(r)}`;
}

/** 本回合是否已发放过同 key 的货币（账本里有 entity=item·op=currency·outcome=applied·uid===key）。*/
export function isCurrencyApplied(turn: number, key: string): boolean {
  try {
    return useLedger.getState().eventsOfTurn(turn)
      .some((e) => e.entity === 'item' && e.op === 'currency' && e.outcome === 'applied' && e.uid === key);
  } catch { return false; }
}

/** 物品阶段同回合重跑(回滚)时，清掉本阶段记的货币事件，让重跑能重新发放（narrative 等其它来源的货币事件保留，仍正确抑制重发）。*/
export function purgeItemPhaseCurrency(turn: number): void {
  try {
    useLedger.getState().purge((e) =>
      e.turn === turn && e.entity === 'item' && e.op === 'currency' && (e.source === 'item-phase' || e.source === 'item-phase-retry'));
  } catch { /* 忽略 */ }
}

/* ── 货币"所得漏登"对账（差分对账·防"正文得到乐园币但不入账"）──
 * 扫正文里**明确获得**的货币（排除花费/扣除语义），与本回合账本里的货币入账对账；
 * 某币种正文写了获得、本回合却无任何入账事件 → 返回一段回喂让 AI 补登。turn 已与 turnCountRef 同步，可单回合精确对账。 */
const CUR_CANON = (s: string): string => (/魂|灵魂/.test(s) ? '灵魂钱币' : '乐园币');
export function detectUnregisteredCurrencyGains(narrative: string, turn: number): string {
  if (!narrative) return '';
  // 用 new RegExp 运行时构造(规避打包器对含中文的正则字面量的转换隐患)·逐币种判定。
  // 只匹配"获得"语义：获得类动词 + 邻近(≤14字) 数额 + 币种，或 币种 + ＋数额；不含 花/付/扣 等支出。
  const GAIN = '获得|得到|拿到|到手|赚|奖励|发放|入账|领取|获取|进账|所得';
  const CURS: [string, string][] = [['乐园币', '乐园币'], ['灵魂钱币|魂币|魂钱币', '灵魂钱币']];
  const wanted = new Set<string>();
  for (const [alias, canon] of CURS) {
    // 用单引号串拼接构造(避免模板串里 \\ 被打包器二次处理导致正则失配)
    const reGain = new RegExp('(?:' + GAIN + ')[^。；！？\\n]{0,14}?\\d[\\d,]{0,8}\\s*(?:' + alias + ')');
    const rePlus = new RegExp('(?:' + alias + ')\\s*[＋+]\\s*\\d');
    if (reGain.test(narrative) || rePlus.test(narrative)) wanted.add(canon);
  }
  if (wanted.size === 0) return '';
  let applied: Set<string>;
  try {
    applied = new Set(
      useLedger.getState().eventsOfTurn(turn)
        .filter((e) => e.entity === 'item' && e.outcome === 'applied' && /乐园币|灵魂钱币|魂币|魂钱币/.test(String(e.ref ?? '')))
        .map((e) => CUR_CANON(String(e.ref))),
    );
  } catch { return ''; }
  const missing = [...wanted].filter((c) => !applied.has(c));
  if (missing.length === 0) return '';
  return `# 正文明确写到主角获得了「${missing.join('、')}」，但本轮没有任何入账记录。请用 cur.add <币种> <数额>（或 transferCurrency）把正文里写明的获得数额补登入账——金额以正文为准，别多给。`;
}

/** 把未生效的物品编辑汇成一段紧凑反馈，供物品阶段重发自纠。无失败返回空串。*/
export function buildItemFeedback(results: ItemEditResult[]): string {
  const fails = results.filter((r) => !r.ok);
  if (fails.length === 0) return '';
  const lines = fails.map((r) => {
    const what = `${r.op}「${r.ref}」`;
    if (r.reason === 'not_found') {
      return `- ${what}未生效：背包/储存里找不到这件物品${r.nearest ? `（最接近的是「${r.nearest}」）` : ''}。请用与清单**完全一致**的物品全名重发；若它确实已不存在，则不要再对它操作。`;
    }
    if (r.reason === 'error') return `- ${what}未生效：处理出错（${r.detail ?? '未知'}）。`;
    return `- ${what}未生效：${r.detail ?? '校验未通过'}。`;
  });
  return `# 上一轮有 ${fails.length} 条物品指令未生效。请**只**针对下列问题重发修正后的指令（不要重复已成功的部分）：\n${lines.join('\n')}`;
}
