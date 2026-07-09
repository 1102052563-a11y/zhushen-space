// NPC 演化·API/上下文/序列化助手（从 App.tsx 抽出；只读 store + 入参，无组件 state/ref 耦合）。
import { useNpcEvo } from '../store/npcEvoStore';
import { useEntryJudge } from '../store/entryJudgeStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useNpc, type NpcRecord } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { useCharacters } from '../store/characterStore';
import { apiChatFallback } from './apiChat';
import { serializeEvents } from './miscParser';
import { fullMaxHp, fullMaxEp, effectiveResource, lvFromRealm, ratioOf, npcBaseAttrs } from './derivedStats';
import { bioInnate } from './bioStrength';
export function getNpcApi() {
  const npcEvoState = useNpcEvo.getState();
  const ss = useSettings.getState();
  return npcEvoState.npcUseSharedApi
    ? (ss.textUseSharedApi ? ss.api : ss.textApi)
    : npcEvoState.npcApi;
}

// NPC / 势力演化仍用此截断控 token（可能逐目标并发多次调用）；杂项/领地/冒险团已改发全文
const MAX_NARRATIVE = 6000;
export function trimNarrative(narrative: string) {
  return narrative.length > MAX_NARRATIVE
    ? '…（已截取最后部分）\n' + narrative.slice(-MAX_NARRATIVE)
    : narrative;
}

/* 登场判断的 legacy 回退接口（集成路由 npcEntry 为空时用）：自配接口 / 与正文共用。 */
export function getEntryApi() {
  const ej = useEntryJudge.getState();
  const ss = useSettings.getState();
  return ej.useSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : ej.api;
}

/* 统一的一次 chat/completions 调用，返回正文字符串（接口路由多选→轮流+fallback）*/
export async function npcChatCompletion(systemPrompt: string, userContent: string, feature: 'npc' | 'entry' = 'npc'): Promise<string> {
  const isEntry = feature === 'entry';
  // 登场判断(entry)走独立集成路由 npcEntry（可挂更强的模型判阶位/强度更准）；未配路由则回退到登场判断自配/共享接口，零回归。
  const chain = resolveApiChain(isEntry ? 'npcEntry' : 'npc', isEntry ? getEntryApi() : getNpcApi());
  const ss2 = useSettings.getState();
  const activePreset = ss2.textPresets.find((p) => p.id === ss2.activeTextPresetId) ?? ss2.textPresets[0];
  const extra: Record<string, unknown> = {};
  if (activePreset?.temperature != null) extra.temperature = activePreset.temperature;
  if (activePreset?.max_tokens != null) extra.max_tokens = activePreset.max_tokens;
  if (activePreset?.top_p != null && activePreset.top_p > 0 && activePreset.top_p <= 1) extra.top_p = activePreset.top_p;
  // 联网搜索（仅登场判断·开关在登场判断设置）：给请求体加 Gemini google_search 工具，让模型联网查同人/角色资料后再定档。
  if (isEntry && useEntryJudge.getState().webSearch) extra.tools = [{ google_search: {} }];
  const timeoutSec = isEntry
    ? Math.max(10, useEntryJudge.getState().requestTimeout || 90)
    : Math.max(10, useNpcEvo.getState().settings.scheduling.requestTimeout || 90);
  const { content } = await apiChatFallback(
    chain,
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
    { timeoutMs: timeoutSec * 1000, extra },
  );
  return content;
}

/* NPC 上下文变量（两阶段共用） */
export function buildNpcVars(narrative: string): Record<string, string> {
  const records  = Object.values(useNpc.getState().npcs);
  const onScene  = records.filter((r) => r.onScene && !r.isDead);
  const offScene = records.filter((r) => !r.onScene && !r.isDead);

  // 已建档清单（供"防重复建档"扫描）：带身份特征(阶位/性别/职业身份/简介首词)，让 AI 能按**特征**认出"换了名字的重现角色"，而非只比对姓名——这是治"同一个体被重复建档"的关键。
  const existingIds = ['B1（玩家）', ...records.map((r) => {
    const t = [r.realm, r.gender, r.profession || r.title, (r.background || r.personality || '').replace(/\s+/g, '').slice(0, 12)]
      .filter(Boolean).join('/');
    return `[${r.id}]${r.name}${t ? '(' + t + ')' : ''}`;
  })].join('; ');
  const cNums = records.map((r) => r.id.match(/^C(\d+)$/)?.[1]).filter(Boolean).map(Number);
  const nextNpcId = `C${cNums.length > 0 ? Math.max(...cNums) + 1 : 1}`;

  const onscreenText = onScene.length > 0
    ? onScene.map((r) =>
        `[${r.id}] ${r.name}${r.gender ? '·' + r.gender : ''} 阶位:${r.realm || '未知'} 状态:${r.status} 好感:${r.favor}`
        + (r.personality ? ` 性格:${r.personality}` : '')
        + (r.appearance5 ? ` 外观:${r.appearance5.split('|')[0] ?? ''}` : '')
      ).join('\n')
    : '（本轮暂无在场NPC）';
  const offscreenText = offScene.length > 0
    ? offScene.map((r) =>
        `[${r.id}] ${r.name} 已离场 背景:${(r.background || '—').slice(0, 80)}`
        + (r.deeds ? ` 近况:${r.deeds.split('\n').slice(-2).join('；')}` : '')
      ).join('\n')
    : '（无离场角色）';

  const M = useMisc.getState();
  const curTime = M.worldTime || M.paradiseTime || '';
  const curLoc = M.worldName || '';

  return {
    story_text: narrative, 本轮正文: narrative, user_input: '',
    existing_character_ids: existingIds, all_character_ids: existingIds, next_available_npc_id: nextNpcId,
    onscreen_characters: onscreenText, offscreen_biographies: offscreenText,
    world_factors: '', world_map_pois: '', world_events: serializeEvents(M.worldEvents),
    current_time: curTime, currentTime: curTime, current_location: curLoc, season: '',
    time_location_row: `${curLoc} ${curTime}`.trim(),
    focus_list: '', 重点演化列表: '',
    // 单角色重点演化才会被覆盖；这里先置空，避免预设里的 ${...} 占位符原样泄漏进提示词
    character_snapshot: '', npc_biography: '', character_equipment: '', character_items: '',
    character_gongfa: '', beasts_summary: '（无）', target_narrative_memory: '', npc_perspective_story: '',
    quick_chat_npc: '', item_management_results: '', timeSinceLastEvolution: '', thinking_content: '',
    cultivation_naming_rule: '',
  };
}

export function fillVars(content: string, vars: Record<string, string>): string {
  let out = content;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\$\\{${k}\\}`, 'g'), v ?? '');
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v ?? '');
  }
  return out;
}

/* 目标角色当前档案快照（供重点演化"继续"既有角色，不要重新取名/重建）*/
export function serializeNpcSnapshot(r: NpcRecord): string {
  const cdata = useCharacters.getState().characters[r.id];
  const skills = cdata?.skills ?? [];
  const talents = cdata?.traits ?? [];
  const attrs = r.attrs;
  const curTurn = useMisc.getState().turnCount ?? 0;   // 当前累计回合数（注入快照，让 NPC 演化 AI 据此核算/递减 buff/debuff 倒计时）
  const unnamed = !r.name || r.name === r.id || /^[CG]\d+$/i.test(r.name);   // 姓名仍是占位ID（如 C10/G1）
  const snEqp = (r.items ?? []).filter((it) => it.equipped) as any;
  const snMaxHp = attrs ? fullMaxHp(npcBaseAttrs(r), snEqp, skills, talents, 1, ratioOf(r)) : 0;   // npcBaseAttrs=attrs+真实属性点直加(realAttrs)
  const snMaxEp = attrs ? fullMaxEp(npcBaseAttrs(r), snEqp, skills, talents, 1, ratioOf(r)) : 0;
  const lines = [
    `角色ID: ${r.id}`,
    `姓名: ${unnamed ? `${r.id}（⚠占位ID·尚未正式命名）` : r.name}${r.gender ? ` | 性别:${r.gender}` : ''}`,
    r.age && `年龄: ${r.age}`,
    r.npcTag && `标签: ${r.npcTag}`,
    r.review && `诙谐评价: ${r.review}`,
    r.realm && `阶位/身份(列2): ${r.realm}`,
    r.bioStrength && `生物强度档(登场判断所定·生成/校准六维以此为准): ${r.bioStrength}`,
    r.title && `称号: ${r.title}`,
    r.profession && `职业: ${r.profession}`,
    r.arenaRank && `竞技场排名: ${r.arenaRank}`,
    r.brandLevel && `烙印等级: ${r.brandLevel}`,
    r.contractorId && `契约者ID: ${r.contractorId}`,
    r.affiliatedTeam && `隶属冒险团(列"冒险团"): ${r.affiliatedTeam}`,
    attrs && `生物强度(前端按基础六维机械判定·资质档,勿写): ${bioInnate(attrs, r.realm, lvFromRealm(r.realm))?.label ?? ''}`,
    attrs && `生命HP: ${effectiveResource(r.hp, r.maxHp, snMaxHp)}/${snMaxHp}（上限=体质×20+装备/被动加成，前端自动算，勿写maxHp）`,
    attrs && `蓝量EP: ${effectiveResource(r.mp, r.maxMp, snMaxEp)}/${snMaxEp}（上限=智力×15+装备/被动加成，前端自动算，勿写maxMp）`,
    !attrs && (r.hp != null || r.maxHp != null) && `HP: ${r.hp ?? '?'}/${r.maxHp ?? '?'}`,
    !attrs && (r.mp != null || r.maxMp != null) && `MP/EP: ${r.mp ?? '?'}/${r.maxMp ?? '?'}`,
    r.attrPoints != null && `属性点: ${r.attrPoints}`,
    r.realAttrPoints != null && `真实属性点: ${r.realAttrPoints}`,
    r.skillPoints != null && `技能点: ${r.skillPoints}`,
    attrs && `六维: 力${attrs.str ?? '?'} 敏${attrs.agi ?? '?'} 体${attrs.con ?? '?'} 智${attrs.int ?? '?'} 魅${attrs.cha ?? '?'} 幸${attrs.luck ?? '?'}`,
    !attrs && `⚠该角色暂无六维——请你本回合据【生物强度档 ${r.bioStrength || '按正文表现判档'} / 阶位 ${r.realm || '未知'} / 等级】对照注入的【属性·战力量化表】生成全部六维，用 character.${r.id}.attrs.str / .agi / .con / .int / .cha = N 逐维绝对赋值（核心维顶到该 bs 档峰值，其余按职业偏向递减、短板可低到凡人段；切勿六维全堆满）。幸运 luck 由前端独占，勿写。`,
    attrs && `真实属性口径: 四阶起该 NPC 六维即「真实属性」(勿÷80)，1点真实≈5点普通之效、判定享绝对优先；一~三阶为普通属性(≤99)。`,
    r.personality && `性格(列3): ${r.personality}`,
    `【⚠当前回合数】${curTurn}（每过一回合自动+1。下方「状态(列4)」里任何"过 N 回合结束 / 还剩 N 回合 / 持续 N 回合 / 第 N 回合解除"的倒计时，务必以这个回合数为锚逐回合递减或比对，到点的 buff/debuff 必须清除——别原样复述同一句，详见限时状态·回合倒计时铁则）`,
    r.status && `状态(列4): ${r.status}`,
    (r.statusEffects?.length ?? 0) > 0 && `限时状态(引擎按回合自动过期,勿重复添加): ${r.statusEffects!.map((e) => { const st = e.startTurn ?? curTurn; const rem = e.durationTurns != null ? Math.max(0, e.durationTurns - (curTurn - st)) : null; return `${e.name}${e.durationDesc ? `(${e.durationDesc})` : ''}${rem != null ? `[起于第${st}回合·剩${rem}回合]` : ''}`; }).join('；')}`,
    r.callPlayer && `对你称呼(列7): ${r.callPlayer}`,
    r.background && `背景(列10): ${r.background}`,
    r.innerThought && `内心(列12): ${r.innerThought}`,
    r.selfNarration && `第一人称自述(已生成·沿用·勿重写·勿再输出<自述>块): ${r.selfNarration}`,
    r.relations && `关系(列13): ${r.relations}`,
    `好感(列15): ${r.favor}`,
    `基底外观(常驻长相·最高基准·绝不漂移): ${r.baseAppearance || '（未设定——请据其稳定特征建立，今后保持不变）'}。身高/发色/瞳色/肤色/体型/标志特征一律以此为准；下面的 肖像(列16)/生图提示词(列19)/容貌(列34) 以及生图都【绝不可与之矛盾】——此处写"无肌肉/精瘦"就绝不能描述成肌肉发达/肌肉线条紧绷，写明的瞳色/身高不许擅改。只有正文明确发生【改身高/染发/换瞳/肢体改造/异变/整容】才更新基底外观。`,
    r.appearance5 && `肖像(列16·即时状态,须与基底外观一致): ${r.appearance5}`,
    `生图提示词(列19,有则沿用/仅长期外观变化时更新·须忠实反映上方基底外观,不得编出与之冲突的体型/瞳色/身高): ${r.imageTags || '（未生成,请生成英文NAI tags）'}`,
    r.motiveNow && `当前动机(列27): ${r.motiveNow}`,
    r.appearanceDetail && `容貌(列34·须与基底外观一致): ${r.appearanceDetail}`,
    // ── 已有技能/天赋：让 AI 看到现状，避免每轮重建累积 ──
    `已有技能(${skills.length}): ${skills.length ? skills.map((s) => `${s.id}「${s.name}」${s.level ?? ''}`).join('；') : '（无）'}`,
    `已有天赋(${talents.length}): ${talents.length ? talents.map((t) => `「${t.name}」${t.category ?? ''}·${t.rarity}级`).join('；') : '（无）'}`,
  ].filter(Boolean);
  return `【该角色已由登场判断建档，本阶段只做"补全 + 增量更新"，不要重造】${unnamed ? `
- ⚠**例外·必须命名（最高优先）**：该角色当前姓名(列1)仍是占位ID「${r.id}」，从未正式命名。请**本回合务必**结合正文与其已知档案（身份/阶位/背景/种族/外观），把**列1(姓名)**更新成一个**符合世界观的中文名**——这是唯一允许改动姓名的情形，**必须**输出对应指令，不得以"无变化"略过。` : ''}
- 姓名、阶位(列2)、性格、背景、外观(列16/34)等已确立字段必须**沿用**，禁止重新取名或换成不同的值；只有正文出现明确突破/变故时才更新对应字段。
- 你的职责是补全缺失列（内心/动机/目标/属性/画像tag/性相关列等）与记录本轮真实发生的变化。
- **技能/天赋反累积铁则**：上方「已有技能」「已有天赋」就是该角色的完整清单。**天赋数量不设上限**（旧的"最多3个天赋"限制已解除），技能也不再卡死数量；但只有正文明确写出该角色"学会/领悟/获得"了清单里没有的新技能、或"觉醒/获得"了新天赋时，才允许新增，且必须复用清单中已存在的同名条目ID做更新而非另建。无明确习得证据时，本轮不输出任何 addSkill/addTalent，不要凭空堆叠或重复添加同名。
- 物品/装备不在本阶段生成（由物品管理阶段负责）。
${lines.join('\n')}`;
}
