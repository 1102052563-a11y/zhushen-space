import { useItems } from '../store/itemStore';
import { useCharacters } from '../store/characterStore';
import { useSkillTree } from '../store/skillTreeStore';
import { useMp } from '../store/multiplayerStore';
import { pushSceneNotice } from './allocNotice';
import { pushToast } from '../store/toastStore';

/* ════════════════════════════════════════════
   联机来宾 · 奖励防回滚（drpg-mp-pending / drpg-mp-replay）

   问题：来宾进房 saveSlot('mp-solo-backup') 快照单机态，离房 loadSlot 整档还原 + reload——
   期间入账的讨伐战利货币、ROLL 到的物品、副本豪华奖励（币/物/潜能点/称号）、接受的赠予
   **全部随还原蒸发**（房主无备份不受影响）→ 同一场副本房主拿全套、来宾一场空。

   方案：来宾期间每笔入账在快照体系之外记一份流水——两个 localStorage 键都**不在
   saveManager.STORES 注册表**里，loadSlot 既不还原也不清、天然穿越 reload：
   - drpg-mp-pending：在房期间的流水（进房时清空重记）。
   - drpg-mp-replay：离房促账（pending→replay）后待补发的流水；开机 replayMpPendingOnBoot()
     逐笔重放（此刻单机档已还原、原入账已被回滚，重放即恢复）→ 清空 + 场外通报。

   幂等/防双发：
   - 促账**必须在 loadSlot 之前**（loadSlot 末尾同步 reload，之后的代码不执行）；
   - loadSlot 返回 false（无备份=没回滚）→ discardMpReplay() 丢弃 replay（奖励仍在当前态，补发=双发）；
   - 来宾中途刷新（没走还原）→ 流水停在 pending，开机只重放 replay → 不双发；
     下次进房 clearMpPending() 重记，旧 pending 自然作废（其奖励已随当前态持久化）。
   - 同 id（rewardId/giftId/lootId+物品）只记一次。
════════════════════════════════════════════ */

const PENDING_KEY = 'drpg-mp-pending';
const REPLAY_KEY = 'drpg-mp-replay';
const CAP = 80;   // 极端长局兜底：只保最近 N 笔

export interface MpPendingReward {
  id: string;                              // 去重键
  note: string;                            // 补发说明（通报用）
  currency?: Record<string, number>;       // 币种→数额（乐园币/灵魂钱币/技能点/黄金技能点）
  items?: Record<string, unknown>[];       // addItem 兼容对象
  potentialPoints?: number;
  title?: unknown;                         // addTitle('B1', …) 兼容对象
}

function read(key: string): MpPendingReward[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(key: string, list: MpPendingReward[]): void {
  try { localStorage.setItem(key, JSON.stringify(list.slice(-CAP))); } catch { /* 满盘不阻断 */ }
}

/** 当前是否联机来宾（在房、非房主）。 */
export function mpIsGuest(): boolean {
  try { const s = useMp.getState(); return s.status === 'connected' && !!s.role && s.role !== 'host'; } catch { return false; }
}

/** 来宾侧入账时记一笔（非来宾调用=静默忽略，调用方不必自判）。 */
export function recordMpReward(r: MpPendingReward): void {
  if (!mpIsGuest()) return;
  try {
    const list = read(PENDING_KEY);
    if (list.some((x) => x.id === r.id)) return;   // 同 id 只记一次（relay 回显防双记）
    list.push(r);
    write(PENDING_KEY, list);
  } catch { /* 记账失败不阻断入账本身 */ }
}

/** 进房：清空 pending 重新记（当前单机态刚被快照，旧流水已随态持久化、作废）。 */
export function clearMpPending(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* */ }
}

/** 离房促账：pending → replay（随后调用方跑 loadSlot 回滚+reload，开机补发）。 */
export function promoteMpPending(): void {
  try {
    const list = read(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY);
    if (list.length) write(REPLAY_KEY, [...read(REPLAY_KEY), ...list]);
  } catch { /* */ }
}

/** 还原没发生（无备份/失败）→ 丢弃 replay：奖励仍在当前态里，补发就是双发。 */
export function discardMpReplay(): void {
  try { localStorage.removeItem(REPLAY_KEY); } catch { /* */ }
}

function applyOne(e: MpPendingReward): void {
  const I = useItems.getState();
  for (const [k, v] of Object.entries(e.currency || {})) {
    const n = Number(v) || 0;
    if (n) I.adjustCurrency(k as never, n, `${e.note}（离房补发）`, true);   // silent：随后统一场外通报，防逐笔刷屏
  }
  if (e.potentialPoints) { try { useSkillTree.getState().grantBonusPP('B1', Number(e.potentialPoints) || 0); } catch { /* */ } }
  for (const it of e.items || []) { try { I.addItem(it as never); } catch { /* */ } }
  if (e.title) { try { useCharacters.getState().addTitle('B1', e.title as never); } catch { /* */ } }
}

/** 开机补发（App 挂载时调一次）：重放 replay 流水 → 清空 → 一条场外通报。返回补发笔数。 */
export function replayMpPendingOnBoot(): number {
  const list = read(REPLAY_KEY);
  if (!list.length) return 0;
  localStorage.removeItem(REPLAY_KEY);   // 先清后放：单笔失败也不整批重来（防 reload 循环双发）
  let ok = 0;
  for (const e of list) {
    try { applyOne(e); ok++; } catch (err) { console.warn('[MP] 离房奖励补发失败', e.id, err); }
  }
  if (ok > 0) {
    const notes = [...new Set(list.map((x) => x.note))].slice(0, 4).join('、');
    pushSceneNotice(`【场外·联机结算】联机归来：本次组队所得（${notes} 等 ${ok} 笔）已在离房时由系统补入主角名下（数值已由前端结算）。正文知晓即可，勿重复发放/结算。`);
    pushToast('ok', `【联机结算】组队所得 ${ok} 笔（${notes}）已补入账`);   // 后台补发实时可见（P4 全局 toast）
    console.log(`[MP] 来宾离房奖励补发 ${ok}/${list.length} 笔`);
  }
  return ok;
}
