import { ITEM_GRADES, type InventoryItem } from '../store/itemStore';
import { TIERS, normalizeTier, realmFromLevel } from './derivedStats';
import { generateGem } from './gemEngine';

/* ════════════════════════════════════════════
   正文击杀 → 结算掉落宝石（纯前端确定性，无 AI）。
   - 侦测本回合正文里主角/我方的击杀数（优先 <击杀结算> 结算块行数，无则保守关键词兜底）。
   - 每个击杀按掉落率独立掷骰；命中则按主角当前阶位/等级烘焙一颗对应品级宝石入背包。
   - 掉落品级随主角成长水涨船高，偶有跳档惊喜；强敌（首领/精英）显著提高掉率。
   参考 ARPG 的击杀掉落 + magic-find；与赌坊/副本 ROLL 同为前端确定性掉落。
════════════════════════════════════════════ */

export interface GemDropConfig {
  enabled: boolean;
  rate: number;        // 单次击杀的基础掉率 0~1
  maxPerTurn: number;  // 单回合最多掉几颗（防刷屏）
}
export const GEM_DROP_DEFAULT: GemDropConfig = { enabled: true, rate: 0.16, maxPerTurn: 3 };

type Rng = () => number;

/** 强敌关键词 → 提高掉率（首领/精英战更容易爆宝石）。 */
const BOSS_RE = /首领|头目|BOSS|Boss|boss|精英|强者|霸主|魔王|魔头|枭雄|王者|统领|巨兽|领主/;
/** 强力击杀动词（关键词兜底用）。 */
const KILL_RE = /斩杀|击杀|枭首|诛杀|杀死|格杀|击毙|轰杀|斩落|屠戮|了结|终结|一剑封喉|削首|斩首|绞杀|镇杀|灭杀/g;
/** 主角/我方死亡词——命中则关键词兜底不触发掉落（避免"主角被击杀"误判成主角击杀）。 */
const SELF_DEATH_RE = /(主角|我方|你|自己)[^，。！？\n]{0,12}(死亡|阵亡|被杀|被击杀|被斩杀|殒命|陨落|重伤不治)/;

/** 本回合主角/我方击杀数（优先 <击杀结算> 块行数，无块则保守关键词兜底）。上限 8。 */
export function countPlayerKills(narrative: string): number {
  const t = String(narrative ?? '');
  const m = t.match(/<击杀结算>([\s\S]*?)<\/击杀结算>/i);
  if (m) {
    const lines = m[1].trim().split('\n').map((s) => s.trim()).filter(Boolean);
    return Math.min(Math.max(0, lines.length - 1), 8);   // 首行是表头，其余每行一个被击杀者
  }
  // 关键词兜底：主角自身死亡则不触发；否则按强力击杀动词计数（保守封顶 2，掉率再兜一层）
  if (SELF_DEATH_RE.test(t)) return 0;
  const hits = (t.match(KILL_RE) || []).length;
  return hits ? Math.min(hits, 2) : 0;
}

/** 主角成长进度档（0=一阶 … 13=无上之境）；取阶位与等级派生阶位的较大者。 */
function progressIndex(tier?: string, level?: number): number {
  const byTier = TIERS.indexOf((normalizeTier(tier) || '') as typeof TIERS[number]);
  const byLevel = level != null ? TIERS.indexOf(realmFromLevel(level) as typeof TIERS[number]) : -1;
  return Math.max(0, byTier, byLevel);
}

/** 掉落宝石品级：中心随主角进度，±1 浮动，偶尔跳档惊喜；夹进 15 档。 */
export function gemDropGrade(tier: string | undefined, level: number | undefined, rng: Rng = Math.random): string {
  const idx = progressIndex(tier, level);   // 0-13
  let num = idx + 1;                         // 1-14
  const r = rng();
  if (r < 0.12) num += 2;                    // 稀有跳档
  else if (r < 0.45) num += 1;
  else if (r > 0.9) num -= 1;
  num = Math.max(1, Math.min(15, num));
  return ITEM_GRADES[num - 1];
}

/** 掷本回合掉落：返回可直接 addItem 的宝石物品（已标 acquisition='击杀掉落'）。 */
export function rollGemDrops(
  narrative: string,
  opts: { tier?: string; level?: number; config?: GemDropConfig; rng?: Rng },
): Omit<InventoryItem, 'id' | 'addedAt'>[] {
  const cfg = opts.config ?? GEM_DROP_DEFAULT;
  if (!cfg.enabled) return [];
  const kills = countPlayerKills(narrative);
  if (kills <= 0) return [];
  const rng = opts.rng ?? Math.random;
  const boss = BOSS_RE.test(String(narrative ?? ''));
  const rate = boss ? Math.min(0.9, cfg.rate * 3) : Math.max(0, Math.min(1, cfg.rate));
  const out: Omit<InventoryItem, 'id' | 'addedAt'>[] = [];
  const n = Math.min(kills, Math.max(1, cfg.maxPerTurn));
  for (let i = 0; i < n; i++) {
    if (rng() >= rate) continue;
    const gem = generateGem(gemDropGrade(opts.tier, opts.level, rng), rng).item;
    out.push({ ...gem, acquisition: '击杀掉落', tags: [...(gem.tags ?? []), '掉落'] });
  }
  return out;
}
