/* ════════════════════════════════════════════
   委托板 · AI 生成（**手动触发，绝不自动跑**）

   默认委托板走语料库确定性组合（零 token，见 dispatchEngine.rollOfferBoard）。
   这里是玩家主动点「🔮 AI 生成委托」时的路径：读主角 + 冒险团 + 每个成员的真实档案，
   生成贴合这支队伍现状的委托，并**在接单前就把奖励物品完整摊开**（这才是选委托的理由）。

   ── 铁则 ────────────────────────────────────────────────────────
   ① **手动**。没有任何自动调用点。`ensureBoard` 见到 `boardSource==='ai'` 直接让开——
      玩家花 token 换来的板，绝不能被自动委托悄悄顶掉（也是"手动生成不要自动生成"的字面要求）。
   ② **品级前端锁死**。奖励物品的 `gradeDesc` 由 `gradeForTier()` 按委托阶位定档（吃世界阶
      装备品质上限表），锁死后喂给 AI，AI 只填其余字段——照搬开箱的做法，杜绝越级爆品。
   ③ **物品字段照物品演化的固定格式全填**：注入 `ITEM_FIXED_FORMAT_RULE`（含词缀/效果/数值
      三分铁则）+ `ITEM_GRADE_TABLE_RULE` + `EQUIP_CODEX`，与开箱/合成/福袋同一套。外观必填。
   ④ **联网搜索是可选项**：开了才给 Gemini 原生 `tools:[{google_search:{}}]`（同混沌世界/登场判断
      那条 extra 通道）。关着就凭模型已有认知写，**不许声称"已联网核实"**。
════════════════════════════════════════════ */
import { useTeam, BOARD_SIZE, type DispatchOffer, type DispatchReward } from '../store/adventureTeamStore';
import { usePlayer } from '../store/playerStore';
import { useMisc } from '../store/miscStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { ITEM_CATEGORIES } from '../store/itemStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import { flattenAiText } from './flattenAiText';
import { getPrompt } from '../store/promptOverrideStore';
import { DISPATCH_GEN_RULE } from './dispatchPrompts';
import { ITEM_FIXED_FORMAT_RULE, ITEM_GRADE_TABLE_RULE, EQUIP_CODEX } from '../promptRules';
import { powerOf, archOf } from './npcAutonomy';
import { dispatchCandidates, ARCH_LABEL, memberBlockReason } from './dispatchEngine';
import { makeRng, seedFrom } from './autonomyCorpus';

/** 委托阶位 → 奖励品级上限。照【世界阶·装备品质上限】那张表（正文世界书蓝灯铁则），一格不越。 */
const GRADE_CAP_BY_TIER = ['白色', '紫色', '暗紫色', '淡金', '金色', '暗金', '传说级', '史诗级', '圣灵级', '不朽级'];
/** 同表的下一档（低阶委托给个下浮空间，不至于每单都顶格爆品） */
const GRADE_LADDER = ['白色', '绿色', '蓝色', '紫色', '暗紫色', '淡金', '金色', '暗金', '传说级', '史诗级', '圣灵级', '不朽级', '起源', '永恒', '创世'];

/** 按委托阶位定这单奖励的品级：封顶＝世界阶上限，实际值在「上限」与「上限下一档」之间掷一次。 */
export function gradeForTier(tier: number, rng: () => number): { grade: string; cap: string } {
  const cap = GRADE_CAP_BY_TIER[Math.max(1, Math.min(9, Math.round(tier)))] ?? '蓝色';
  const i = GRADE_LADDER.indexOf(cap);
  const grade = i > 0 && rng() < 0.55 ? GRADE_LADDER[i - 1] : cap;   // 45% 顶格、55% 降一档
  return { grade, cap };
}

/* ── 上下文序列化 ── */
function playerBrief(): string {
  const p = usePlayer.getState().profile;
  const m = useMisc.getState();
  return [
    `姓名：${p.name || '主角'}　阶位：${p.tier || '—'}　等级：Lv.${p.level ?? '—'}`,
    `身份：${p.identity || '—'}　职业：${p.profession || '—'}　所属乐园：${p.homeParadise || '—'}`,
    `生物强度：${p.bioStrength || '—'}`,
    `当前世界：${m.worldName || '主神空间'}　主神空间时间：${m.paradiseTime || '—'}${m.worldTime ? `　世界时间：${m.worldTime}` : ''}`,
  ].join('\n');
}

function teamBrief(): string {
  const T = useTeam.getState();
  const cands = dispatchCandidates();
  const roster = cands.length
    ? cands.map((n) => {
      const block = memberBlockReason(n);
      const fat = T.fatigue[n.id] ?? 0;
      return `- ${n.name}（${n.realm || '阶位不详'}｜职业 ${n.profession || '未记'}｜战斗原型 ${ARCH_LABEL[archOf(n)]}｜战力档 ${powerOf(n)}/9｜疲劳 ${fat}${block ? `｜当前${block}` : ''}）`
        + (n.personality ? `\n    性格：${n.personality}` : '')
        + (n.relations ? `\n    关系：${String(n.relations).slice(0, 80)}` : '');
    }).join('\n')
    : '（无可派遣成员）';
  return [
    `团名：${T.name || '（未命名）'}　阶位：${T.rank}　团队经验 ${T.teamExp}/100　活跃度 ${T.activity}/100`,
    `团队效果：${T.perks.length ? T.perks.map((p) => p.name).join('、') : '（无）'}`,
    `可派遣成员（共 ${cands.length} 人，主角不出勤）：\n${roster}`,
  ].join('\n');
}

/* ── 解析 ── */
function parseArray(content: string): Record<string, unknown>[] {
  let t = (content || '').replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '').trim()
    .replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const i = t.indexOf('['), j = t.lastIndexOf(']');
  if (i >= 0 && j > i) t = t.slice(i, j + 1);
  const v = lenientJsonParse(t);
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

const str = (v: unknown, cap: number): string | undefined => {
  const s = flattenAiText(v).trim().slice(0, cap);
  return s || undefined;
};

const ARCH_KEYS = Object.keys(ARCH_LABEL);

function toReward(raw: unknown, lockedGrade: string, tier: number): DispatchReward {
  const r = (raw ?? {}) as Record<string, unknown>;
  let cat = flattenAiText(r.category).trim();
  if (!ITEM_CATEGORIES.includes(cat as never)) cat = '特殊物品';        // 非法类别 → 回落到最不会出错的一档
  const isEquip = ['武器', '防具', '饰品', '宝石', '载具'].includes(cat);
  return {
    name: str(r.name, 40) || `${lockedGrade}·委托酬劳`,
    category: cat,
    gradeDesc: lockedGrade,                                            // ⚠ 品级只认前端锁的那个，AI 写什么都不采信
    subType: str(r.subType, 30),
    origin: str(r.origin, 40),
    combatStat: isEquip ? str(r.combatStat, 50) : undefined,
    durability: isEquip ? str(r.durability, 30) : undefined,
    requirement: isEquip ? str(r.requirement, 60) : undefined,
    attrBonus: str(r.attrBonus, 120),
    score: str(r.score, 60),
    affix: isEquip ? str(r.affix, 240) : undefined,
    effect: str(r.effect, 400),
    activeEffect: str(r.activeEffect, 300),
    activeDuration: str(r.activeDuration, 30),
    intro: str(r.intro, 200),
    appearance: str(r.appearance, 300),
    killCount: cat === '武器' ? '0' : undefined,
    quantity: Math.max(1, Math.min(99, Number(r.quantity) || 1)),
    tags: ['委托奖励', `${tier}阶委托`],
  };
}

export interface GenResult { ok: boolean; n: number; error?: string }

/**
 * 手动生成一板委托。**只被面板按钮调用，没有任何自动触发点。**
 * 成功 → 写进 store 并把 boardSource 标成 'ai'（此后不再被自动委托顶掉）。
 */
export async function generateDispatchBoard(turn: number): Promise<GenResult> {
  const T0 = useTeam.getState();
  if (!T0.established || T0.disbanded) return { ok: false, n: 0, error: '尚未建立冒险团' };
  if (T0.boardBusy) return { ok: false, n: 0, error: '正在生成中' };

  T0.setBoardBusy(true);
  try {
    const ss = useSettings.getState();
    const legacy = T0.dispatchUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : T0.dispatchApi;
    const chain = resolveApiChain('dispatch', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置派遣接口（变量管理→冒险团演化→API 设置）');

    // 槽位：难度阶梯 + 品级锁死，都在前端定死（同开箱）——AI 只负责把内容写实
    const rng = makeRng(seedFrom(turn, 'dispatch-gen'));
    const cands = dispatchCandidates();
    const top = cands.length ? Math.max(...cands.map(powerOf)) : 1;
    const base = Math.max(1, Math.min(9, top));
    const slots = Array.from({ length: BOARD_SIZE }, (_, i) => {
      const tier = Math.max(1, Math.min(9, base - 1 + i));
      const { grade, cap } = gradeForTier(tier, rng);
      return { n: i + 1, tier, grade, cap };
    });
    const slotsText = slots.map((s) =>
      `槽${s.n}：委托阶位＝**${s.tier}阶**（难度按此写，不得偏离）｜奖励品级＝**${s.grade}**（已锁死，照抄进 reward.gradeDesc；该阶位的品级天花板是 ${s.cap}，绝不可越）`,
    ).join('\n');

    const web = T0.dispatchWebSearch;
    const system = [
      getPrompt('DISPATCH_GEN_RULE', DISPATCH_GEN_RULE),
      ITEM_FIXED_FORMAT_RULE,
      ITEM_GRADE_TABLE_RULE,
      getPrompt('EQUIP_CODEX', EQUIP_CODEX),
      web
        ? '【联网搜索·已开启】本次调用已挂载搜索工具：若当前世界是**已发表的知名作品**（同人世界），先检索该作品的真实设定、地点、势力、事件与时间线，据此写委托，让它像是真的发生在那个世界里；若是原创世界或搜不到，就按已给的世界设定写，**严禁编造出处、更不许声称"已联网核实"**。'
        : '【联网搜索·未开启】只凭你已有的高置信认知来写；不确定处留白或模糊带过，**严禁编造设定、不许声称"已联网核实"**。',
    ].join('\n\n');

    const user = [
      '【主角档案】\n' + playerBrief(),
      '【冒险团现状】\n' + teamBrief(),
      `【委托槽·共 ${slots.length} 条，一一对应】\n${slotsText}`,
      `请输出长度为 ${slots.length} 的 JSON 数组（slot 从 1 起，与上表逐条对应）。每条都必须带一件字段填满的 reward。`,
    ].join('\n\n');

    const { content } = await apiChatFallback(chain, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], {
      timeoutMs: 180000,
      label: '派遣委托生成',
      extra: web ? { tools: [{ google_search: {} }] } : undefined,
    });

    const arr = parseArray(content);
    if (!arr.length) throw new Error('AI 未返回有效委托（可重试）');

    const offers: DispatchOffer[] = slots.map((s, i) => {
      const j = arr.find((x) => parseInt(String(x?.slot), 10) === s.n) ?? arr[i] ?? {};
      const arch = flattenAiText(j.arch).trim();
      const okArch = ARCH_KEYS.includes(arch) ? arch : undefined;
      return {
        id: `dpai_${turn}_${s.n}`,
        title: str(j.title, 24) || `${s.tier}阶委托`,
        world: str(j.world, 30) || '未名之地',
        tier: s.tier,
        turns: Math.max(3, Math.min(9, Math.round(Number(j.turns) || 3 + s.tier))),
        slots: Math.max(1, Math.min(4, Math.round(Number(j.slots) || 2))),
        arch: okArch,
        archLabel: okArch ? ARCH_LABEL[okArch as keyof typeof ARCH_LABEL] : undefined,
        minPower: s.tier,
        danger: Math.max(0.2, Math.min(0.95, Number(j.danger) || 0.5)),
        brief: str(j.brief, 200),
        objective: str(j.objective, 150),
        risk: str(j.risk, 150),
        employer: str(j.employer, 40),
        reward: toReward(j.reward, s.grade, s.tier),
        bySearch: web || undefined,
      };
    });

    useTeam.getState().setBoard(offers, turn, 'ai');
    useTeam.getState().setBoardBusy(false);
    return { ok: true, n: offers.length };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[派遣] 委托生成失败:', msg);
    useTeam.getState().setBoardBusy(false, msg.slice(0, 80));
    return { ok: false, n: 0, error: msg };
  }
}
