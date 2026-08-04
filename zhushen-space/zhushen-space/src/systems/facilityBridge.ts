import { pushSceneNotice, pushGrowthNotice, pushFacilityGranted } from './allocNotice';
import { pushToast } from '../store/toastStore';

/* ════════════════════════════════════════════
   设施 → 正文 统一接入口（facilityBridge）

   背景：90+ 功能里十几个「玩法设施」（赌坊/深渊/交易/仓库/工坊/丰碑…）玩完什么都不给正文留痕，
   AI 凭旧记忆 OOC；而已接通报的设施（开箱/合成/产业/派遣…）各自手拼 pushSceneNotice 字符串，
   守卫语口径不一、pushFacilityGranted 时挂时漏（竞技场/深渊/扭蛋的发放曾全都没登记 → 物品阶段重复建档）。

   方案：设施出结果时调**一个函数**，内部扇出到三条既有桥（allocNotice.ts）：
   - summary  → pushSceneNotice（一次性「仅知晓」通报，进 <前置须知>）
   - granted  → pushFacilityGranted（本回合已确定性入库的物品名 → 物品阶段绝不再 createItem）
   - growth   → pushGrowthNotice（需要正文**入戏交代**的成长：称号/觉醒/习得，比"仅知晓"强一档）
   守卫语统一拼接，新设施照调即合规。全部纯字符串、零 API 成本。
════════════════════════════════════════════ */

export interface FacilityOutcome {
  /** 设施名（通报前缀），如 '赌坊' / '幽冥地牢' / '交易行'。 */
  source: string;
  /** 一句话结果（不含前缀与守卫语）。 */
  summary: string;
  /** 本回合已由前端确定性发放、入库的物品名（防物品阶段重复建档）。 */
  granted?: string[];
  /** 需要正文入戏交代的成长事件（可多条）。 */
  growth?: string | string[];
  /** 覆盖默认守卫语（少数场景需要定制，如"勿改写物品名称"）。 */
  guard?: string;
  /** 同时弹一条全局 toast（P4）：给**面板没开着也会发生**的后台事件用（交易行离线成交/托管归还/
      派遣酬劳/来宾补发）——面板内的操作自带界面反馈，勿开此项防噪音。 */
  toast?: boolean;
}

const DEFAULT_GUARD = '数值已由前端结算，正文知晓并保持一致即可，勿重复发放/结算，勿改写涉及物品的名称与效果';

/* P4·回合洞察「设施动态」区的数据源：本窗口（上次发送以来）的设施动作一览。
   peek 不清空——captureTurnSnapshot 会对同回合反复抓取并覆盖，清空交给 App.callApi 在新回合开始时做
   （与 <前置须知> 的 drain 同窗口语义）。上限 20 条防长挂机膨胀。 */
let facilityLog: string[] = [];
export function peekFacilityLog(): string[] { return facilityLog.slice(); }
export function clearFacilityLog(): void { facilityLog = []; }

/** 设施出结果统一上报：一次调用扇出 场外通报 + 发放登记 + 成长交代。失败静默（通报绝不阻断设施本身）。 */
export function reportFacilityOutcome(o: FacilityOutcome): void {
  try {
    if (o.granted?.length) pushFacilityGranted(o.granted);
    const s = (o.summary ?? '').trim();
    if (s) pushSceneNotice(`【场外·${o.source}】${s}（${o.guard ?? DEFAULT_GUARD}）。`);
    if (s) facilityLog = [...facilityLog.slice(-19), `【${o.source}】${s.length > 120 ? s.slice(0, 120) + '…' : s}`];
    if (s && o.toast) pushToast('ok', `【${o.source}】${s.length > 90 ? s.slice(0, 90) + '…' : s}`);
    const growths = Array.isArray(o.growth) ? o.growth : o.growth ? [o.growth] : [];
    for (const g of growths) { const t = (g ?? '').trim(); if (t) pushGrowthNotice(t); }
  } catch { /* 桥失败不阻断设施结算 */ }
}
