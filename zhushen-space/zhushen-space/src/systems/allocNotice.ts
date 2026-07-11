/* 场外操作 → 正文一次性通报缓冲（原「加点通报」已泛化为通用「场外通报」）。
   背景：玩家在面板里做的**确定性场外操作**（手动加点 / 合成 / 强化 / 赌坊 / 商店 / 兑换 / 花费货币…），
   正文 AI 看不到这个动作，于是凭旧记忆 OOC——典型：玩家把乐园币花到 5000，正文却仍以为有 10000。
   方案：这些操作各自 push 一条通报；App.callApi 组装正文时 `drainSceneNotices` 取出 → 注入**最深处**的
   `<前置须知>` 块（一次性消费）。正文读到后只需**知晓并保持后续一致**，不据此另行生成/结算/质疑/重播。
   模块级不持久：场外操作通常紧接着就发送；即便刷新丢失，结构化档案注入的权威数值仍兜底纠偏，只损失一次叙述风味。 */

let pending: string[] = [];   // 已格式化的整句通报（加点 / 合成 / 强化物品事件…）
const coin: Record<string, { net: number; reasons: Set<string> }> = {};   // 货币按币种聚合（防赌坊逐笔刷屏）
let growthPending: string[] = [];   // 「需入戏交代」的成长事件（星图习得技能/天赋、精进升级…）——与"仅知晓"的场外操作不同：正文应用一小段叙述交代主角如何习得，让职业成长与剧情连上

/** 记一条「需入戏交代」的成长通报（技能树点亮技能/天赋、精进升级…）→ 正文应叙述主角如何获得，非仅知晓。去重。 */
export function pushGrowthNotice(note: string): void { const t = (note ?? '').trim(); if (t && !growthPending.includes(t)) growthPending.push(t); }
/** 取出并清空本回合成长通报。 */
export function drainGrowthNotices(): string[] { const out = [...growthPending]; growthPending = []; return out; }
/** 仅查看不清空（调试/测试用）。 */
export function peekGrowthNotices(): string[] { return growthPending.slice(); }

/* 本回合已由「设施」（开箱/合成/福袋…）**确定性发放、且已入背包**的物品名。
   背景：开箱等设施把产物直接 addItem 入库，并（可选）让正文入戏交代"主角取出了这些之物"。
   但物品演化阶段会读正文、把"获得的物品"再 createItem 一遍 → 同一件变两条（尤其正文把名字写漂了、dedupeByName 漏合并）。
   方案：设施发放时登记这些名字；callApi 每回合把它们取进 ref，物品阶段据此**绝不 createItem 这些名字**（提示词 + 代码闸门双保险）。*/
let facilityGranted: string[] = [];
/** 登记本回合由设施确定性发放、已入库的物品名（物品阶段勿再建）。去重。 */
export function pushFacilityGranted(names: string[]): void {
  for (const n of names) { const t = (n ?? '').trim(); if (t && !facilityGranted.includes(t)) facilityGranted.push(t); }
}
/** 取出并清空本回合设施发放名单（callApi 开头调一次，存进 ref 供本回合各阶段读）。 */
export function drainFacilityGranted(): string[] { const out = [...facilityGranted]; facilityGranted = []; return out; }
/** 仅查看不清空。 */
export function peekFacilityGranted(): string[] { return facilityGranted.slice(); }

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
