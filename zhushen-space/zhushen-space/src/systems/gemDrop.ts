import { ITEM_GRADES, type InventoryItem } from '../store/itemStore';
import { TIERS, normalizeTier, realmFromLevel } from './derivedStats';
import { generateGem } from './gemEngine';

/* ════════════════════════════════════════════
   正文击杀强敌 → 结算掉落宝石（纯前端确定性，无 AI）。
   ⚠只在**击杀高阶 / 强敌**时才可能掉落——弱小杂兵（游魂/杂鱼/喽啰…）一律不掉，且每回合最多 1 颗。
   （早期版本用宽松关键词命中"任何击杀"，导致"开门都会爆 / 杀个游魂爆两颗"，已收紧成下面的强敌门控。）
   - 判定：① <击杀结算> 块里出现"越阶"击杀（打赢高于自己阶位的强敌）→ 算；
            ② 或 击杀动词的近旁（±45字）出现强敌词、且近旁无弱敌词 → 算。
   - 命中门控后再按掉率掷 1 次；明确 boss/首领级提高掉率。品级随主角阶位/等级缩放。
   参考 ARPG 里"只有精英/首领掉宝石"的设计；与赌坊/副本 ROLL 同为前端确定性掉落。
════════════════════════════════════════════ */

export interface GemDropConfig {
  enabled: boolean;
  rate: number;        // 击杀强敌后的掉率 0~1
  maxPerTurn: number;  // 单回合最多掉几颗（默认 1·防"爆一堆"）
}
export const GEM_DROP_DEFAULT: GemDropConfig = { enabled: true, rate: 0.4, maxPerTurn: 1 };

type Rng = () => number;

/** 击杀动词。 */
const KILL_SRC = '斩杀|击杀|枭首|诛杀|杀死|格杀|击毙|轰杀|斩落|屠戮|了结|终结|一剑封喉|斩首|绞杀|镇杀|灭杀|重创致死|命丧|殒命于|授首';
/** 强敌 / 高阶敌人指示词（近旁出现才可能掉落）。 */
const STRONG_ENEMY_RE = /首领|头目|BOSS|Boss|boss|精英|强敌|劲敌|强者|高手|霸主|魔王|魔头|魔君|魔将|魔尊|妖王|妖尊|妖圣|枭雄|王者|统领|统帅|领主|尊者|大能|宗师|巨擘|真君|老祖|至尊|大将|守护者|守卫者|巨兽|凶兽|上位|高阶|越阶|大妖|古神|神将|不朽|名震|大魔|恐怖的存在|一方霸主|强大的敌|悍将|劲卒之王/;
/** 弱小敌人（这类击杀不掉落）。 */
const WEAK_ENEMY_RE = /游魂|野鬼|小鬼|杂鱼|喽啰|小卒|虾兵|蟹将|野狗|流寇|蝼蚁|乌合|散兵|残兵|小妖|小怪|杂役|走狗|爪牙|路人|平民|村民|寻常|普通(?:的)?(?:士兵|敌|怪|妖)/;
/** 强 boss 级（掉率翻倍）。 */
const BOSS_RE = /首领|头目|BOSS|Boss|boss|魔王|妖王|霸主|领主|魔尊|妖尊|至尊|老祖|大能|古神|统帅/;
/** 主角/我方被击杀——命中则不触发掉落（避免"主角被强者击杀/斩杀"误判成主角击杀强敌）。
 *  真实叙述多为「你被魔王击杀」（被+凶手+动词），故匹配 主角/你 + 被 + 邻近击杀动词，或直白的死亡词。 */
const SELF_DEATH_RE = /(主角|我方|你|自己|吾)[^。！？\n]{0,16}被[^。！？\n]{0,12}(击杀|斩杀|杀死|诛杀|击毙|轰杀|格杀|斩落|杀|斩|重创致死|一击毙命|打死|灭杀|抹杀|枭首)|(主角|我方|你|自己)[^，。！？\n]{0,10}(阵亡|殒命|陨落|重伤不治|气绝身亡|当场毙命)/;

/** 本回合是否发生了「击杀高阶/强敌」（弱敌不算）。 */
export function hasHighTierKill(narrative: string): boolean {
  const t = String(narrative ?? '');
  if (!t) return false;
  if (SELF_DEATH_RE.test(t)) return false;
  // ① <击杀结算> 块里"越阶"击杀（打赢高于自己阶位的强敌）→ 直接算
  const block = t.match(/<击杀结算>([\s\S]*?)<\/击杀结算>/i);
  if (block && /越阶/.test(block[1])) return true;
  // ② 击杀动词近旁（±45字）有强敌词、且近旁无弱敌词 → 算高阶击杀
  const re = new RegExp(KILL_SRC, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const win = t.slice(Math.max(0, m.index - 45), Math.min(t.length, m.index + 45));
    if (STRONG_ENEMY_RE.test(win) && !WEAK_ENEMY_RE.test(win)) return true;
  }
  return false;
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

/** 掷本回合掉落：仅在击杀强敌时可能掉；返回可直接 addItem 的宝石物品（已标 acquisition='击杀掉落'）。 */
export function rollGemDrops(
  narrative: string,
  opts: { tier?: string; level?: number; config?: GemDropConfig; rng?: Rng },
): Omit<InventoryItem, 'id' | 'addedAt'>[] {
  const cfg = opts.config ?? GEM_DROP_DEFAULT;
  if (!cfg.enabled) return [];
  if (!hasHighTierKill(narrative)) return [];   // ⚠只有击杀高阶/强敌才可能掉
  const rng = opts.rng ?? Math.random;
  const boss = BOSS_RE.test(String(narrative ?? ''));
  const rate = Math.max(0, Math.min(0.95, boss ? cfg.rate * 1.8 : cfg.rate));
  const out: Omit<InventoryItem, 'id' | 'addedAt'>[] = [];
  const n = Math.max(1, cfg.maxPerTurn);
  for (let i = 0; i < n; i++) {
    if (rng() >= rate) continue;
    const gem = generateGem(gemDropGrade(opts.tier, opts.level, rng), rng).item;
    out.push({ ...gem, acquisition: '击杀掉落', tags: [...(gem.tags ?? []), '掉落'] });
  }
  return out;
}
