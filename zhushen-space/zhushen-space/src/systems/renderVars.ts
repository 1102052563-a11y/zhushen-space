import { useSettings } from '../store/settingsStore';
import { usePlayer } from '../store/playerStore';
import { makePromptExpandCtx, expandPromptText } from './promptExpand';
import { hasTableTemplates } from './tableTemplate';

/* ── 🧩 渲染期变量（P2·借鉴 ST-PT render phase 思想·默认关）──────────────────
   楼层**显示时**把 {{getvar::名}} / ${名} / <if var> / {{include}} 等就地替换成当前值：
   · 仅显示层——chatDb 里的原文永不改写；
   · 缓存天然失效：展开产物作为 toHtmlWithImagesCached 的输入文本，值变→文本变→sig 变→重渲；
   · ⚠确定性：random 用 msgId 播种（mulberry32）——同一楼层重复渲染结果恒定，绝不闪变；
   · 展开口径同玩家文本通道：不清残留 + 未知变量原样保留（绝不吃正文里的合法花括号）；
   · 值变了但旧楼没重渲时显示暂旧，下次重渲（流式/开关面板/翻页）自动刷新——绝不给旧楼加订阅（打字卡顿铁律）。 */

function mulberry32(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderPhaseExpand(msgId: number, text: string): string {
  try {
    if (!text || !useSettings.getState().renderVars) return text;
    if (!text.includes('{{') && !text.includes('${') && !hasTableTemplates(text)) return text;   // 快路径：无标记零开销
    const nm = usePlayer.getState().profile?.name || '主角';
    const ctx = makePromptExpandCtx({ user: nm, char: nm, random: mulberry32(Math.imul(msgId || 1, 2654435761)) });
    return expandPromptText(text, ctx, false, true);
  } catch { return text; }
}
