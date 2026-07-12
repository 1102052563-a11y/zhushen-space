/* 「结算任务」随从勾选·一次性缓冲。
   玩家点【结算任务】时弹窗勾选「本次给哪些随从发点」→ 选择存这里；正文结算落地(applyPlayerProfileCommands 见 <世界结算>)
   时读取，据此发点 + 结算卡点名；用完即清（consume-once）。模块级不持久：结算通常紧接着就发送，
   刷新丢了则回退 null＝按 isSettlingCompanion 自动判定（安全降级）。
   语义三态：null=未手选(自动判定) ｜ []=玩家显式选了「一个都不发」｜ [ids]=玩家勾选的这批。 */
let whitelist: string[] | null = null;

/** 设定本次结算的随从白名单（弹窗确认时调）。传 null 恢复「自动判定」；传数组（含空数组）= 玩家显式选择。 */
export function setSettlementWhitelist(ids: string[] | null): void {
  whitelist = ids == null ? null : [...new Set(ids)];
}
/** 读取当前白名单（发点/注入名单共用）。 */
export function getSettlementWhitelist(): string[] | null {
  return whitelist;
}
/** 清空（结算落地后 consume-once）。 */
export function clearSettlementWhitelist(): void {
  whitelist = null;
}
