/* 事件核心的启动载入 / 读档重播编排（阶段1·把 npc-core/items-core/wallet 搬去 IndexedDB 的配套）。
   ─ 续玩（普通 reload/F5/陈旧chunk自愈）：从 IDB 载入三核心，保留审计连续性。
   ─ 读档 / 新游戏：saveManager 先 flagCoresReseed()，本处 preload 时**清 IDB、留空** → 本回合
     seedNpcsIfEmpty/seedItemsIfEmpty/… 从恢复后的现场 store 重播影子基线。
   这样把"清核心"放到 reload【之后】做，避开 loadSlot 里"异步演化阶段还在跑、会把旧值重新落库"的竞态
   （= 旧核心 vs 新 store 假数量漂移的根因）。 */
import { preloadNpcCore } from './npcCore';
import { preloadItemCore } from './itemCore';
import { preloadWalletCore } from './walletCore';
import { resetEventCoresIdb } from './coreKv';
import { setResumeFlag, getResumeFlag, clearResumeFlag } from '../resumeFlag';

const RESEED_FLAG = 'drpg-cores-reseed';

/** saveManager 读档/新游戏 reload 前调用：标记"重启后清空三核心、从现场 store 重播"。 */
export function flagCoresReseed(): void { setResumeFlag(RESEED_FLAG); }

/** App 启动 await：正常续玩→从 IDB 载入三核心；带 reseed 标志（刚读档/新游戏）→清 IDB 留空待本回合重播。 */
export async function preloadEventCores(): Promise<void> {
  if (getResumeFlag(RESEED_FLAG)) {
    clearResumeFlag(RESEED_FLAG);
    try { await resetEventCoresIdb(); } catch { /* */ }
    return;   // 三核心留空 → seedIfEmpty 从现场 store 重播基线
  }
  try { await Promise.all([preloadNpcCore(), preloadItemCore(), preloadWalletCore()]); } catch { /* */ }
}
