import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useFaction } from '../store/factionStore';
import { useMisc } from '../store/miscStore';
import { useCombat } from '../store/combatStore';
import { useCharacters } from '../store/characterStore';
import { useItems } from '../store/itemStore';
import { useMp, type MpTurn } from '../store/multiplayerStore';
import { effectiveAttrs, withAttrDelta } from './attrBonus';
import { fullMaxHp, fullMaxEp, realAttrMult, attrCapForTier, ratioOf } from './derivedStats';
import { playerTreeAttrBonus } from '../store/skillTreeStore';
import { playerTeamAttrBonus, playerTeamPerkAbilities } from '../store/adventureTeamStore';

// 联机·快照与多人回合拼装。
// MVP 设计：共享的是「正文」（房主权威，算完广播）；各玩家自己的角色状态留在本地，提交行动时附带一张精简卡。

// 我的角色卡（队伍面板展示 + 房主拼进提示词作参考）
export function buildPlayerSnapshot() {
  try {
    const p: any = usePlayer.getState().profile || {};
    const base = p.attrs || {};
    const c: any = useCharacters.getState().characters['B1'] || {};
    const equipped = (useItems.getState().items || []).filter((it: any) => it.equipped);
    // 有效六维 = 基础 + 技能树 + 团队 + 装备(含宝石) + 技能/天赋加成（与单机 buildCombatant('B1') 同口径，联机战力一致）
    const baseTT = withAttrDelta(withAttrDelta(base, playerTreeAttrBonus()), playerTeamAttrBonus());
    const a: any = effectiveAttrs(baseTT, c.skills, c.traits, equipped as any, attrCapForTier(p.tier, p.level));
    const teamPerk = playerTeamPerkAbilities();
    const rmP = realAttrMult(p.tier, p.level);   // 四阶起 HP/EP×5（联机与单机一致）
    const maxHp = fullMaxHp(baseTT, equipped as any, c.skills, [...(c.traits || []), ...teamPerk], rmP, ratioOf(p));
    const maxEp = fullMaxEp(baseTT, equipped as any, c.skills, [...(c.traits || []), ...teamPerk], rmP, ratioOf(p));
    const stat = `力${a.str ?? '?'} 敏${a.agi ?? '?'} 体${a.con ?? '?'} 智${a.int ?? '?'} 魅${a.cha ?? '?'} 幸${a.luck ?? '?'}`;
    const head = [p.tier, p.profession].filter(Boolean).join('·');
    return {
      name: p.name || '',
      tier: p.tier || '',
      profession: p.profession || '',
      race: p.race || '',
      raceDetail: p.raceDetail || '',
      gender: p.gender || '',
      personality: p.personality || '',
      personalityDetail: p.personalityDetail || '',
      appearance: p.appearance || '',
      attrs: a,           // 有效六维
      maxHp, maxEp,       // 算好的 HP/EP 上限，供联机战斗 combatant 直接用
      line: [head, stat].filter(Boolean).join(' '),
      skills: c.skills || [],     // 联机战斗里来宾放技能（房主据此结算）+ 正文档案展示
      traits: c.traits || [],     // 天赋（正文档案展示）
      equipment: equipped.map((it: any) => ({ name: it.name, slot: it.equipSlot || it.category, gradeDesc: it.gradeDesc, effect: it.effect, combatStat: it.combatStat })),
      items: (useItems.getState().items || []).filter((it: any) => !it.equipped).map((it: any) => { const { image, ...rest } = it; return rest; }),   // 联机战斗道具（房主据此结算用道具）
    };
  } catch {
    return { name: '', line: '' };
  }
}

// 房主：把在座来宾的角色档案(技能/天赋/职业/装备/性格/外观/种族)拼成块，注入房主正文，让 AI 准确刻画队友
export function buildPartyProfiles(): string {
  try {
    const mp = useMp.getState();
    if (mp.status !== 'connected' || mp.role !== 'host') return '';
    const cards = (mp.cards || []).map((c) => c.snapshot).filter(Boolean) as any[];
    if (!cards.length) return '';
    const blocks = cards.map((s) => {
      const lines: string[] = [];
      lines.push(`◆ ${s.name || '队友'}${s.race ? `（${s.race}）` : ''}`);
      const id = [s.gender, s.tier, s.profession].filter(Boolean).join(' · ');
      if (id) lines.push(`身份：${id}`);
      if (s.raceDetail) lines.push(`种族详情：${s.raceDetail}`);
      if (s.appearance) lines.push(`外观：${s.appearance}`);
      const persona = [s.personality, s.personalityDetail].filter(Boolean).join('；');
      if (persona) lines.push(`性格：${persona}`);
      if (s.line) lines.push(`六维：${s.line}`);
      const sk = (s.skills || []).map((x: any) => x?.name).filter(Boolean);
      if (sk.length) lines.push(`技能：${sk.join('、')}`);
      const tr = (s.traits || []).map((x: any) => x?.name).filter(Boolean);
      if (tr.length) lines.push(`天赋：${tr.join('、')}`);
      const eq = (s.equipment || []).map((x: any) => x?.name).filter(Boolean);
      if (eq.length) lines.push(`装备：${eq.join('、')}`);
      return lines.join('\n');
    });
    return `【联机·同行队友档案（以下角色由真人玩家操控，请严格按其设定准确刻画其言行/能力/外观/种族，勿张冠李戴、勿替他们擅自决策）】\n${blocks.join('\n\n')}`;
  } catch {
    return '';
  }
}

// 联机专用正文规则（建房时房主可勾选启用，强化多人叙事一致性 / 真人队友不被当 NPC / 各控各角色）
export const MP_NARRATIVE_RULE = `【联机·多人正文铁则（本局为多名真人玩家组队，务必严格遵守）】
1. 本回合输入会列出每位玩家各自的行动——请**分别回应每个人**的行动与结果，给每个角色合理戏份，勿只写其中一人、勿漏人。
2. 同行队友全部由**真人玩家操控**：严格按其档案(种族/职业/性格/外观/技能/天赋)刻画；对白与即时小反应可代写，但**重大抉择/关键行动要留白给该玩家**，不得替他们擅自决定。
3. **绝不把真人队友当 NPC**：不为他们新建 NPC 档案、不削弱其主角地位、不抢他们的关键决定。
4. 多人共处同一场景与时间线：保持各人位置/状态一致，别对同一事件给两人写出互相矛盾的结果。
5. 善用各角色名带出对白与配合，强化组队临场感。`;

export function mpNarrativeRule(): string {
  const mp = useMp.getState();
  if (mp.status !== 'connected' || mp.role !== 'host' || !mp.mpPresetOn) return '';
  return MP_NARRATIVE_RULE;
}

// 房主回合提示：指引 AI 处理多人同回合
export const MP_PARTY_HINT =
  '（请把以上视为同处一地的同伴各自的行动，统一推进本回合剧情，并分别回应每个人的行动与结果，不要替某人编造他未声明的行动。）';

// 房主：把「房主本回合行动」+「队友已提交的行动」拼成一条多人回合输入。
// 无队友行动时原样返回房主输入 → 单人时行为与原来完全一致（零副作用）。
export function buildPartyTurnText(
  hostText: string,
  inputs: MpTurn['inputs'] | undefined,
  hostName: string,
): string {
  // 行动署名一律用「真实角色名」(座位卡 snapshot.name，按 seatId 反查)，而非开房/进房时填的花名。
  // 否则花名(如默认「道友」)会被 AI 当成一个谁都不认识的新角色塞进正文 → 幻影队友 bug。
  const cards = useMp.getState().cards || [];
  const realBySeat = (seatId: string, fallback: string) =>
    cards.find((c) => c.seatId === seatId)?.snapshot?.name || fallback;

  const lines: string[] = [];
  const ht = (hostText || '').trim();
  if (ht) lines.push(`- ${hostName || '房主'}（房主）：${ht}`);
  for (const [seatId, v] of Object.entries(inputs || {})) {
    const t = (v?.text || '').trim();
    if (t) lines.push(`- ${realBySeat(seatId, v?.name || '队友')}：${t}`);
  }
  if (lines.length <= 1) return hostText; // 没有队友行动 → 退化为普通单人输入
  return `【多人组队·本回合全队行动】\n${lines.join('\n')}\n\n${MP_PARTY_HINT}`;
}

// ───────────────────────────────────────────────────────────
// 世界态同步（Phase 2）：房主把共享世界(NPC/势力/世界状态)序列化广播，来宾打补丁进本地 store。
// 来宾首次应用前自动备份自己的世界，离开/关房时还原 → 不污染来宾单机存档（硬刷新除外）。

// 递归剥离内联大图（avatar/image 等字段 + data: URL），保留 http(s) 图片 URL（小、来宾可加载）
function stripMedia(v: any): any {
  if (Array.isArray(v)) return v.map(stripMedia);
  if (v && typeof v === 'object') {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/^(avatar|image|portrait|banner|img|cover|pic)$/i.test(k)) continue;
      if (typeof val === 'string' && val.startsWith('data:')) continue;
      o[k] = stripMedia(val);
    }
    return o;
  }
  return v;
}

// 同步的 misc「世界状态」字段（总结/记忆/配置不同步）
const MISC_SYNC_KEYS = ['tasks', 'archivedTasks', 'worldEvents', 'weather', 'weatherFxCss', 'weatherFxKey', 'paradiseTime', 'worldTime', 'worldName'] as const;
function pickMisc(m: any) {
  const o: any = {};
  for (const k of MISC_SYNC_KEYS) o[k] = m[k];
  return o;
}

// 房主：序列化共享世界
export function buildWorldSnapshot() {
  try {
    return {
      npcs: stripMedia(useNpc.getState().npcs),
      factions: stripMedia(useFaction.getState().factions),
      misc: stripMedia(pickMisc(useMisc.getState())),
    };
  } catch {
    return null;
  }
}

let worldBackup: { npcs: any; factions: any; misc: any } | null = null;

// 来宾：把房主世界打补丁进本地（首次应用前先备份来宾自己的世界）
export function applyWorldSnapshot(world: any) {
  if (!world) return;
  try {
    if (worldBackup === null) {
      worldBackup = {
        npcs: useNpc.getState().npcs,
        factions: useFaction.getState().factions,
        misc: pickMisc(useMisc.getState()),
      };
    }
    if (world.npcs) useNpc.setState({ npcs: world.npcs });
    if (world.factions) useFaction.setState({ factions: world.factions });
    if (world.misc) useMisc.setState(world.misc);
  } catch (e) { console.warn('[MP] applyWorldSnapshot 失败', e); }
}

// 来宾离开/关房：还原自己的世界
export function restoreWorldBackup() {
  if (!worldBackup) return;
  try {
    useNpc.setState({ npcs: worldBackup.npcs });
    useFaction.setState({ factions: worldBackup.factions });
    useMisc.setState(worldBackup.misc);
  } catch (e) { console.warn('[MP] restoreWorldBackup 失败', e); }
  try { useCombat.getState().exitCombat(); } catch {}   // 来宾退出 → 清掉房主广播过来的战斗态，避免残留冻结战斗
  try {   // 清掉联机战斗注入的 MP_ 角色技能残留
    const chars = useCharacters.getState().characters; const cleaned: any = {};
    for (const k of Object.keys(chars)) if (!k.startsWith('MP_')) cleaned[k] = chars[k];
    useCharacters.setState({ characters: cleaned });
  } catch {}
  worldBackup = null;
}

// 清掉 characterStore 里联机战斗注入的 MP_ 角色（房主战斗结束/重开战时调，防残留累积）
export function purgeMpCharacters() {
  try {
    const chars = useCharacters.getState().characters; const cleaned: any = {}; let changed = false;
    for (const k of Object.keys(chars)) { if (k.startsWith('MP_')) changed = true; else cleaned[k] = chars[k]; }
    if (changed) useCharacters.setState({ characters: cleaned });
  } catch {}
}
