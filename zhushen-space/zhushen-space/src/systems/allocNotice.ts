/* 主角前端加点 → 正文一次性事件缓冲。
   背景：属性点/真实属性点由玩家在「属性面板」自行加点消耗（前端确定性结算），正文 AI 看不到这个动作，
   于是会凭旧记忆反复提示"你还有 N 点属性点未用"，与面板真实余额(已是 0)矛盾。
   方案：PlayerSidebar.confirmAlloc 确认加点后 pushAllocNotice 一条人类可读说明；
   App.callApi 在下一次主线叙事调用时 drainAllocNotices 取出注入(一次性)后清空——
   让正文"知道"这次淬炼并据此自然叙述，同时不在输入框留痕。
   模块级(不持久)：加点→发送通常即时；即便刷新丢失，serializePlayerCard 注入的权威余额仍兜底纠偏，
   只损失一次叙述风味，不影响数值正确性。 */
let pending: string[] = [];

export function pushAllocNotice(note: string): void {
  const t = (note ?? '').trim();
  if (t) pending.push(t);
}

/** 取出全部待注入事件并清空（一次性消费）。无则返回空数组。 */
export function drainAllocNotices(): string[] {
  if (!pending.length) return [];
  const out = pending;
  pending = [];
  return out;
}

/** 仅查看不清空（调试/诊断用）。 */
export function peekAllocNotices(): string[] {
  return pending.slice();
}
