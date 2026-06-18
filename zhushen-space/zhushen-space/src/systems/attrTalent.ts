import { useSettings, resolveApiChain } from '../store/settingsStore';
import { usePlayer } from '../store/playerStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import type { Trait } from '../store/characterStore';
import { ATTR_TALENT_GEN_RULE } from '../promptRules';

/* 真实属性·加点与里程碑天赋（主角 B1 + NPC Cx 共用，纯前端确定性 + 一次 AI 生成）。
   - 加点消耗「真实属性点」(realAttrPoints)，每 1 点让该属性的真实属性 +1（＝基础属性 +80，trueAttr=floor(基础/80)）。
   - 当某属性的真实属性跨过里程碑 20/80/120 时，调主角演化 API 生成 4 个该属性专属的「逆天级」天赋供玩家四选一。*/

export const REAL_ATTR_STEP = 80;                 // 每 1 真实属性 ＝ 80 基础属性（与 derivedStats.trueAttr 对齐）
export const ATTR_MILESTONES = [20, 80, 120];     // 真实属性里程碑：触发四选一逆天天赋

/* 本次加点是否跨过某个里程碑（真实属性从 oldTrue 升到 newTrue）；返回跨过的里程碑值，未跨过返回 null。*/
export function crossedMilestone(oldTrue: number, newTrue: number): number | null {
  for (const m of ATTR_MILESTONES) if (oldTrue < m && newTrue >= m) return m;
  return null;
}

function extractJsonArray(text: string): string {
  let s = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = s.indexOf('['), j = s.lastIndexOf(']');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return s;
}

export interface AttrTalentOpts {
  attrLabel: string;   // 力量/敏捷/体质/智力/魅力/幸运
  milestone: number;   // 20 / 80 / 120
  trueValue: number;   // 跨过后的真实属性值
  charName: string;
  charTier: string;    // 阶位（一阶~无上之境）
  isPlayer: boolean;
}

/* 调主角演化 API 生成 4 个该属性的逆天级天赋候选（玩家四选一）。失败抛错由 UI 兜。*/
export async function generateAttrTalents(o: AttrTalentOpts): Promise<Omit<Trait, 'addedAt'>[]> {
  const ss = useSettings.getState();
  const ps = usePlayer.getState();
  const legacy = ps.playerUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : ps.playerApi;
  const chain = resolveApiChain('player', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（设置→主角演化→API设置 或 综合设置→正文生成）');
  const who = o.isPlayer ? `主角「${o.charName || '主角'}」` : `契约者「${o.charName || '该角色'}」`;
  const grade = o.milestone >= 120 ? 'SSS' : o.milestone >= 80 ? 'SS' : 'S';
  const userMsg = `【角色】${who}　阶位:${o.charTier || '—'}\n【突破属性】${o.attrLabel}\n【当前真实${o.attrLabel}】${o.trueValue}（已达里程碑 ${o.milestone}）\n\n请围绕【${o.attrLabel}】铸造 4 个逆天级天赋供其挑选，按系统要求只输出 JSON 数组（4 个天赋对象）。里程碑 ${o.milestone} ＝ ${grade} 级强度起步，务必各具一格、丰富多样。`;
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: ATTR_TALENT_GEN_RULE },
    { role: 'user', content: userMsg },
  ], { timeoutMs: 150000 });
  const raw: any = lenientJsonParse(extractJsonArray(content ?? ''));
  const arr: any[] = Array.isArray(raw) ? raw : (Array.isArray(raw?.options) ? raw.options : []);
  return arr.filter((x) => x && x.name).slice(0, 4).map((x) => ({
    name: String(x.name).trim(),
    desc: x.desc ? String(x.desc).trim() : '',
    effect: x.effect ? String(x.effect).trim() : '',
    rarity: String(x.rarity ?? grade).trim(),
    category: x.category ? String(x.category).trim() : '属性类',
    source: x.source ? String(x.source).trim() : `真实${o.attrLabel}·里程碑${o.milestone}淬炼`,
    level: x.level ? String(x.level).trim() : undefined,
    attrBonus: x.attrBonus ? String(x.attrBonus).trim() : undefined,
  }));
}
