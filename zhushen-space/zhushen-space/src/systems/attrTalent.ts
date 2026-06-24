import { useSettings, resolveApiChain } from '../store/settingsStore';
import { usePlayer } from '../store/playerStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import type { Trait } from '../store/characterStore';
import { ATTR_TALENT_GEN_RULE } from '../promptRules';

/* 真实属性·加点与里程碑天赋（主角 B1 + NPC Cx 共用，纯前端确定性 + 一次 AI 生成）。
   - 普通属性加点消耗「属性点」(attrPoints)，每点 +1 基础属性(attrs)。
   - 真实属性加点消耗「真实属性点」(realAttrPoints)，每点 +1 真实属性·直加分配(realAttrs)。
   - 真实属性显示值 = 基础六维(+装备/技能加成) + realAttrs 直加值（2026-06-24 起不再 ÷80，四阶起六维即真实属性）；
     跨里程碑时调主角演化 API 生成 4 个该属性天赋供四选一。*/

/* 里程碑步长(密→疏)：低段每 20 一个里程碑→一~三阶(基础≤99)也能频繁触发(治"加点没奖励/被动没了")；越高越稀疏，
   防高真实属性时逆天天赋泛滥。生成序列：20,40,60,80,100,150,200,250,300,400,…,1000,1250,1500,…
   想更密/更疏只改这张表即可（below=区间上界，step=该区间步长）。*/
const MILESTONE_STEPS: { below: number; step: number }[] = [
  { below: 100, step: 20 },        // 0~100：每 20（前中期主战区，频繁奖励）
  { below: 300, step: 50 },        // 100~300：每 50
  { below: 1000, step: 100 },      // 300~1000：每 100
  { below: Infinity, step: 250 },  // 1000+：每 250
];
function milestoneStep(v: number): number {
  return (MILESTONE_STEPS.find((t) => v < t.below) ?? MILESTONE_STEPS[MILESTONE_STEPS.length - 1]).step;
}

/* 本次加点跨过的所有里程碑（真实属性从 oldTrue 升到 newTrue，左开右闭）；一次确认可能跨多个。
   例：oldTrue=15, newTrue=105 → [20,40,60,80,100]，逐个触发四选一。未跨过返回 []。
   从 0 按变步长前进收集（步长越高越大，故走到任意高真实属性也只需几十步，guard 兜底防意外死循环）。*/
export function milestonesCrossed(oldTrue: number, newTrue: number): number[] {
  const out: number[] = [];
  let m = 0, guard = 0;
  while (m < newTrue && guard++ < 4000) {
    m += milestoneStep(m);
    if (m > oldTrue && m <= newTrue) out.push(m);
  }
  return out;
}

function extractJsonArray(text: string): string {
  let s = String(text ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const i = s.indexOf('['), j = s.lastIndexOf(']');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return s;
}

export interface AttrTalentOpts {
  attrLabel: string;   // 力量/敏捷/体质/智力/魅力/幸运
  milestone: number;   // 跨过的里程碑值（见 milestonesCrossed·20/40/…/150/500/2000…）
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
  // 等级随里程碑值放大：低段(密)给 A 级强力克制被动，越高越逆天（保留"里程碑越高越离谱"梯度）
  const grade = o.milestone >= 2000 ? 'SSS' : o.milestone >= 500 ? 'SS' : o.milestone >= 150 ? 'S' : 'A';
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
