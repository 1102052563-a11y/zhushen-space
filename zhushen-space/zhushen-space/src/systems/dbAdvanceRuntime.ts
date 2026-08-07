/* 数据库推进（Stitches）运行态 · 读档/回退的回滚规则 ─────────────────────────
   `drpg-dbadvance` 一个键里装着两类东西：
     · **配置**：preset / presetName / enabled / useRecall —— 全局的，与具体存档解绑，读档不该回滚；
     · **运行态**：lastTabletop({{tabletop}} 桌面态) / lastStage / lastScene / lastRecall —— 跨回合传递的
       剧情记忆，属于**这条时间线**，读档/回退必须跟着回滚。
   不回滚运行态的后果：回档后推进管线仍拿着**被回退掉的那几回合**的桌面态 → 规划层"还记得"已作废的剧情；
   且 App.runDbAdvancePipeline 的 `tabletop || st.lastTabletop` 兜底会让它一轮轮自我延续，重试多少次都一样
   （用户报「回档后推进还记着之前内容」的根因，2026-08-07 修）。
   本模块只做纯合并（无 store 依赖，可单测）；注册进 saveManager.STORES + restoreStores 调用见 saveManager.ts。 */
import { decompressMaybe, compressWithMark, isCompressed } from './compressedStorage';
import { logWarn } from '../utils/log';

export const DBADV_KEY = 'drpg-dbadvance';
/** 随时间线回滚的运行态字段（其余字段=配置，保留当前值）。 */
export const DBADV_RUNTIME_KEYS = ['lastTabletop', 'lastStage', 'lastScene', 'lastRecall'] as const;

/** 读档/回退时该写回 `drpg-dbadvance` 的值：以【当前值】为底（保住预设/开关），
 *  只把运行态换成存档快照里的那份；存档没带（本次修复前存的旧档/回退点）→ 运行态清空——
 *  宁可空桌面重新起步，也不带着"未来"的记忆。返回 null = 无需写（本机没配置且存档也没带）。 */
export function mergeDbAdvanceRuntime(savedJson: string | undefined | null, currentRaw: string | null): string | null {
  try {
    const curPlain = decompressMaybe(currentRaw);
    const cv = curPlain ? JSON.parse(curPlain) : null;
    if (!cv?.state) return savedJson ?? null;   // 本机还没有推进配置 → 直接用存档值（没有要保的配置）
    const savedPlain = savedJson != null ? decompressMaybe(savedJson) : null;
    const sv = savedPlain ? JSON.parse(savedPlain) : null;
    for (const k of DBADV_RUNTIME_KEYS) cv.state[k] = typeof sv?.state?.[k] === 'string' ? sv.state[k] : '';
    const merged = JSON.stringify(cv);
    return (currentRaw && isCompressed(currentRaw)) ? compressWithMark(merged) : merged;   // 本 store 走 lzStorage：压缩存回压缩
  } catch (e) { logWarn('dbAdvanceRuntime.merge', e); }
  return savedJson ?? null;
}
