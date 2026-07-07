/* 场外操作 → 正文一次性通报缓冲（原「加点通报」已泛化为通用「场外通报」）。
   背景：玩家在面板里做的**确定性场外操作**（手动加点 / 合成 / 强化 / 赌坊 / 商店 / 兑换 / 花费货币…），
   正文 AI 看不到这个动作，于是凭旧记忆 OOC——典型：玩家把乐园币花到 5000，正文却仍以为有 10000。
   方案：这些操作各自 push 一条通报；App.callApi 组装正文时 `drainSceneNotices` 取出 → 注入**最深处**的
   `<前置须知>` 块（一次性消费）。正文读到后只需**知晓并保持后续一致**，不据此另行生成/结算/质疑/重播。
   模块级不持久：场外操作通常紧接着就发送；即便刷新丢失，结构化档案注入的权威数值仍兜底纠偏，只损失一次叙述风味。 */

let pending: string[] = [];   // 已格式化的整句通报（加点 / 合成 / 强化物品事件…）
const coin: Record<string, { net: number; reasons: Set<string> }> = {};   // 货币按币种聚合（防赌坊逐笔刷屏）

/** 记一条场外操作通报（整句·人类可读）。 */
export function pushSceneNotice(note: string): void {
  const t = (note ?? '').trim();
  if (t) pending.push(t);
}
/** @deprecated 语义已泛化，等价 pushSceneNotice；保留名以兼容 PlayerSidebar 等旧调用点。 */
export const pushAllocNotice = pushSceneNotice;

/** 记一笔**场外**货币变动（按币种累加、收集缘由）。⚠正文 `<state>` 驱动的货币变动**不要**记（AI 自己就知道）——
 *  itemStore.adjustCurrency 默认记，stateApply 那几处传 silent 跳过。 */
export function noteCurrencyChange(type: string, delta: number, reason?: string): void {
  const d = Number(delta) || 0; if (!d) return;
  const c = coin[type] ?? (coin[type] = { net: 0, reasons: new Set<string>() });
  c.net += d;
  const r = (reason ?? '').trim(); if (r) c.reasons.add(r);
}

/** 取出本回合全部场外通报（整句 + 按币种聚合的货币行·含当前余额）并清空。wallet=当前钱包权威值（用于播报最新余额）。 */
export function drainSceneNotices(wallet?: Record<string, number>): string[] {
  const out = [...pending];
  for (const type of Object.keys(coin)) {
    const c = coin[type];
    if (c.net) {
      const bal = wallet?.[type];
      const reasons = [...c.reasons].join('、') || '场外结算';
      out.push(`【场外·货币】${type} ${c.net > 0 ? '+' : ''}${c.net}（${reasons}）${bal != null ? `，当前 ${type} = ${bal}` : ''}`);
    }
    delete coin[type];
  }
  pending = [];
  return out;
}
/** @deprecated 语义已泛化，等价 drainSceneNotices；保留名以兼容 App.callApi 等旧调用点。 */
export const drainAllocNotices = drainSceneNotices;

/** 仅查看不清空（调试/诊断用）。 */
export function peekSceneNotices(): string[] { return pending.slice(); }
export const peekAllocNotices = peekSceneNotices;
