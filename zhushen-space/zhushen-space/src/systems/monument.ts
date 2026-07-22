// 纪念丰碑 · 业务逻辑（快照 / 入碑 + 生平结语 / 召唤 / 遣散）。
// 范式承袭 systems/assistApply.ts：
//   · 快照在 buildPlayerSnapshot（有效六维 + HP/EP + 技能/天赋/装备/储存，战力一致）之上补齐"全部信息"
//     （称号/成就/副职业/货币/资源/经历/身份字段），存进全局 useMonument（跨存档常驻）。
//   · 召唤 = 物化成本地在场临时队友 NPC（keepForever + partyMember；装备入背包但不 equipped，避免有效六维二次叠加）。
//   · 生平总结 + 结语 = 与「主角演化」共用 API（resolveApiChain('player', …)），后台生成回填，面板订阅自动刷新。
import { usePlayer } from '../store/playerStore';
import { useNpc, type NpcOwnedItem, type NpcRecord } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import { useItems } from '../store/itemStore';
import { useResource } from '../store/resourceStore';
import { useMisc } from '../store/miscStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { useMonument, type MonumentEntry, type MonumentSnapshot } from '../store/monumentStore';
import { buildPlayerSnapshot } from './mpSnapshot';
import { apiChatFallback } from './apiChat';
import { shrinkDataUrl } from './imageGen';
import { bumpAutoSave } from './saveManager';
import { effectiveAttrs } from './attrBonus';
import { attrCapForTier, lvFromRealm } from './derivedStats';
import { MONUMENT_EULOGY_RULE } from '../promptRules';
import { getPrompt } from '../store/promptOverrideStore';   // 预设中心：主提示词 override

function coerceGender(g?: string): '男' | '女' | '' {
  return g === '男' || g === '女' ? g : '';
}

// 卡里的装备/物品 → NPC 持有物。装备一律 equipped:false（展示用，不进有效六维二次叠加）。
function toOwnedItem(raw: any, cid: string, idx: number, isEquip: boolean): NpcOwnedItem {
  return {
    id: `I_${cid}_${idx}`,
    name: String(raw?.name || '未知物品'),
    category: String(raw?.category || raw?.slot || (isEquip ? '装备' : '杂物')),
    gradeDesc: String(raw?.gradeDesc || ''),
    effect: String(raw?.effect || ''),
    quantity: Math.max(1, Math.floor(Number(raw?.quantity ?? raw?.qty ?? 1)) || 1),
    equipped: false,
    equipSlot: raw?.equipSlot || raw?.slot || undefined,
    combatStat: raw?.combatStat || undefined,
    appearance: raw?.appearance || undefined,
    affix: raw?.affix || undefined,
    intro: raw?.intro || undefined,
    notes: isEquip ? '（纪念英灵随身装备）' : undefined,
    addedAt: Date.now(),
  };
}

/** 采集当前主角的**完整面板**快照（"所有信息·不省略"）。preview 与入碑共用；avatar 为原始串，入碑时压缩。 */
export function buildMonumentSnapshot(): MonumentSnapshot {
  const base = buildPlayerSnapshot() as any;   // 复用主角联机卡核心：有效六维 + HP/EP + 技能/天赋/装备/储存(已剥图)
  const p: any = usePlayer.getState().profile || {};
  const c: any = useCharacters.getState().characters['B1'] || {};
  const wallet: any = useItems.getState().currency || {};
  const currencies = Object.entries(wallet)
    .filter(([, v]) => typeof v === 'number')
    .map(([label, amount]) => ({ label, amount: Number(amount) || 0 }));
  const resources = (useResource.getState().resources || []).map((r: any) => ({
    name: String(r?.name || ''), cur: Number(r?.cur) || 0, max: Number(r?.max) || 0,
  }));
  return {
    ...base,
    origin: 'player',
    level: p.level,
    title: (c.titles || []).find((t: any) => t.equipped)?.name || p.title || '',
    identity: p.identity || '',
    arenaRank: p.arenaRank || '',
    homeParadise: p.homeParadise || '',
    preParadiseJob: p.preParadiseJob || '',
    brandLevel: p.brandLevel || '',
    bioStrength: p.bioStrength || '',
    contractorId: p.contractorId || '',
    baseAttrs: { ...(p.attrs || {}) },
    hpRatio: p.hpRatio,
    epRatio: p.epRatio,
    titles: c.titles || [],
    subProfessions: c.subProfessions || [],
    achievements: usePlayer.getState().achievements || [],
    currencies,
    resources,
    background: p.background || '',
    deedLog: p.deedLog || [],
    avatar: p.avatar || '',
  };
}

// 立绘压缩：data: 图压成缩略图；http 图直接引用；无图则空（避免大图撑爆 localStorage）
async function shrinkAvatar(raw: string): Promise<string> {
  try {
    if (raw.startsWith('data:image/')) return await shrinkDataUrl(raw, 256, 0.7);
    if (/^https?:\/\//.test(raw)) return raw;
  } catch { /* 无图就不带立绘 */ }
  return '';
}

/** 把当前主角铭刻入碑：建条目（立即落盘）→ 后台生成生平总结 + 结语回填。返回新条目 id（无主角返回 null）。 */
export async function enshrineCurrentPlayer(): Promise<string | null> {
  const snap = buildMonumentSnapshot();
  if (!snap.name) return null;
  snap.avatar = await shrinkAvatar(usePlayer.getState().profile?.avatar || '');
  const world = (useMisc.getState() as any).worldName || '';
  const turn = (useMisc.getState() as any).turnCount || 0;
  const id = useMonument.getState().enshrine({ snapshot: snap, world, turn });
  generateEulogy(id).catch(() => useMonument.getState().updateEntry(id, { eulogyStatus: 'error' }));
  return id;
}

/** 采集一名 NPC 的**完整面板**快照入碑（"所有信息·不省略"）。有效六维口径同 NpcDetail，装备/储存/技能/天赋/称号/副职业/经历/身份字段全带。 */
export function buildNpcMonumentSnapshot(npcId: string): MonumentSnapshot | null {
  const r: any = useNpc.getState().npcs[npcId];
  if (!r || !r.name) return null;
  const cd: any = useCharacters.getState().characters[npcId] || {};
  const base: any = r.attrs || {};
  const hasAttrs = base && typeof base === 'object' && Object.keys(base).length > 0;
  const tier = (r.realm || '').split('|')[0] || '';
  const identity = (r.realm || '').split('|').slice(1).join('|').trim();
  const equippedItems = (r.items || []).filter((it: any) => it.equipped);
  // 有效六维 = 基础 + 技能/天赋 + 装备（与 NpcDetail 同口径）；召唤时装备不 equipped，避免二次叠加
  const eff: any = hasAttrs
    ? effectiveAttrs(base, cd.skills || [], cd.traits || [], equippedItems as any, attrCapForTier(r.realm, lvFromRealm(r.realm)))
    : undefined;
  const strip = (it: any) => { const { image, ...rest } = it || {}; return rest; };
  const stat = eff ? `力${eff.str ?? '?'} 敏${eff.agi ?? '?'} 体${eff.con ?? '?'} 智${eff.int ?? '?'} 魅${eff.cha ?? '?'} 幸${eff.luck ?? '?'}` : '';
  const head = [tier, r.profession].filter(Boolean).join('·');
  return {
    origin: 'npc',
    name: r.name,
    gender: coerceGender(r.gender),
    tier,
    realm: r.realm || '',
    identity,
    profession: r.profession || '',
    npcTag: r.npcTag || '',
    title: r.title || '',
    bioStrength: r.bioStrength || '',
    age: r.age || '',
    contractorId: r.contractorId || '',
    affiliatedTeam: r.affiliatedTeam || '',
    arenaRank: r.arenaRank || '',
    brandLevel: r.brandLevel || '',
    status: r.status || '',
    review: r.review || '',
    personality: r.personality || '',
    personalityDetail: r.innerThought || '',
    appearance: r.appearanceDetail || r.appearance5 || '',
    attrs: eff || (hasAttrs ? { ...base } : undefined),
    baseAttrs: hasAttrs ? { ...base } : undefined,
    realAttrs: r.realAttrs && Object.keys(r.realAttrs).length ? { ...r.realAttrs } : undefined,
    maxHp: r.maxHp,
    maxEp: r.maxMp,
    hpRatio: r.hpRatio,
    epRatio: r.epRatio,
    line: [head, stat].filter(Boolean).join(' '),
    skills: cd.skills || [],
    traits: cd.traits || [],
    titles: cd.titles || [],
    subProfessions: cd.subProfessions || [],
    equipment: equippedItems.map(strip),
    items: (r.items || []).filter((it: any) => !it.equipped).map(strip),
    background: r.background || '',
    deedLog: (r.deedLog || []) as any[],
    avatar: r.avatar || '',
  };
}

/** 把一名 NPC 铭刻入碑：建条目（立即落盘）→ 后台生成生平总结 + 结语回填。返回新条目 id（无此 NPC 返回 null）。 */
export async function enshrineNpc(npcId: string): Promise<string | null> {
  const snap = buildNpcMonumentSnapshot(npcId);
  if (!snap || !snap.name) return null;
  snap.avatar = await shrinkAvatar((useNpc.getState().npcs[npcId] as any)?.avatar || '');
  const world = (useMisc.getState() as any).worldName || '';
  const turn = (useMisc.getState() as any).turnCount || 0;
  const id = useMonument.getState().enshrine({ snapshot: snap, world, turn });
  generateEulogy(id).catch(() => useMonument.getState().updateEntry(id, { eulogyStatus: 'error' }));
  return id;
}

/** 重新生成某条目的生平总结 + 结语（接口未配/失败后重试用）。 */
export function regenerateEulogy(id: string): void {
  useMonument.getState().updateEntry(id, { eulogyStatus: 'pending' });
  generateEulogy(id).catch(() => useMonument.getState().updateEntry(id, { eulogyStatus: 'error' }));
}

// 把快照拼成人类可读档案，喂给 AI 撰写生平/结语
function buildDossier(snap: MonumentSnapshot): string {
  const L: string[] = [];
  const nm = (a?: any[]) => (a || []).map((x: any) => x?.name || x?.title).filter(Boolean);
  L.push(`姓名：${snap.name}`);
  const idLine = [snap.gender, snap.tier, snap.profession, snap.identity].filter(Boolean).join(' · ');
  if (idLine) L.push(`身份：${idLine}`);
  if (snap.level) L.push(`等级：Lv.${snap.level}`);
  if (snap.race) L.push(`种族：${snap.race}${snap.raceDetail ? `（${snap.raceDetail}）` : ''}`);
  if (snap.homeParadise) L.push(`所属乐园：${snap.homeParadise}`);
  if (snap.preParadiseJob) L.push(`入园前：${snap.preParadiseJob}`);
  if (snap.brandLevel) L.push(`烙印等级：${snap.brandLevel}`);
  if (snap.bioStrength) L.push(`生物强度：${snap.bioStrength}`);
  if (snap.title) L.push(`当前称号：${snap.title}`);
  if (snap.npcTag) L.push(`标签：${snap.npcTag}`);
  if (snap.age) L.push(`年龄：${snap.age}`);
  if (snap.affiliatedTeam) L.push(`隶属：${snap.affiliatedTeam}`);
  if (snap.status && snap.status !== '一切正常') L.push(`当前状态：${snap.status}`);
  if (snap.review) L.push(`旁人评价：${snap.review}`);
  if (snap.line) L.push(`六维：${snap.line}`);
  const persona = [snap.personality, snap.personalityDetail].filter(Boolean).join('；');
  if (persona) L.push(`性格：${persona}`);
  if (snap.appearance) L.push(`外观：${snap.appearance}`);
  const sk = nm(snap.skills); if (sk.length) L.push(`技能：${sk.join('、')}`);
  const tr = nm(snap.traits); if (tr.length) L.push(`天赋：${tr.join('、')}`);
  const ti = nm(snap.titles); if (ti.length) L.push(`称号库：${ti.join('、')}`);
  const sp = nm(snap.subProfessions); if (sp.length) L.push(`副职业：${sp.join('、')}`);
  const ac = nm(snap.achievements); if (ac.length) L.push(`成就：${ac.join('、')}`);
  const eq = nm(snap.equipment); if (eq.length) L.push(`装备：${eq.join('、')}`);
  const cur = (snap.currencies || []).filter((x) => x.amount).map((x) => `${x.label}${x.amount}`);
  if (cur.length) L.push(`财富：${cur.join('、')}`);
  if (snap.background) L.push(`\n背景出身：\n${snap.background}`);
  const deeds = (snap.deedLog || []).map((d: any) => {
    const t = [d?.time, d?.location].filter(Boolean).join('·');
    const txt = d?.content || d?.text || d?.summary || '';
    return txt ? `- ${t ? `[${t}] ` : ''}${txt}` : '';
  }).filter(Boolean);
  if (deeds.length) L.push(`\n生平经历（时间线）：\n${deeds.join('\n')}`);
  return L.join('\n');
}

// 解析 AI 输出的「===生平总结=== / ===结语===」两段（比 JSON 更耐长篇 prose 的换行/引号）
function parseEulogy(text: string): { summary: string; eulogy: string } {
  const t = text || '';
  const sM = t.match(/===\s*生平总结\s*===/);
  const eM = t.match(/===\s*结语\s*===/);
  if (sM && eM && (eM.index ?? 0) > (sM.index ?? 0)) {
    return {
      summary: t.slice((sM.index ?? 0) + sM[0].length, eM.index).trim(),
      eulogy: t.slice((eM.index ?? 0) + eM[0].length).trim(),
    };
  }
  return { summary: t.trim(), eulogy: '' };   // 兜底：整段当生平
}

async function generateEulogy(id: string): Promise<void> {
  const entry = useMonument.getState().entries[id];
  if (!entry) return;
  const ss = useSettings.getState();
  const ps: any = usePlayer.getState();
  // 与主角演化共用 API：同 runPlayerEvolutionPhase 的接口解析口径
  const legacyApi = ps.playerUseSharedApi ? (ss.textUseSharedApi ? ss.api : ss.textApi) : ps.playerApi;
  const chain = resolveApiChain('player', legacyApi);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
    console.warn('[Monument] 主角演化 API 未配置，跳过生平结语生成');
    useMonument.getState().updateEntry(id, { eulogyStatus: 'error' });
    return;
  }
  const dossier = buildDossier(entry.snapshot);
  try {
    const { content } = await apiChatFallback(chain, [
      { role: 'system', content: getPrompt('MONUMENT_EULOGY_RULE', MONUMENT_EULOGY_RULE) },
      { role: 'user', content: `【契约者档案】\n${dossier}\n\n请基于以上档案，按【输出格式】撰写其生平总结与结语。` },
    ], { label: '纪念丰碑·生平结语', timeoutMs: 60000 });
    const { summary, eulogy } = parseEulogy(content);
    if (summary || eulogy) useMonument.getState().updateEntry(id, { summary, eulogy, eulogyStatus: 'done' });
    else useMonument.getState().updateEntry(id, { eulogyStatus: 'error' });
  } catch (e) {
    console.warn('[Monument] 生平结语生成失败：', e);
    useMonument.getState().updateEntry(id, { eulogyStatus: 'error' });
  }
}

/** 召唤一名入碑英灵：物化成本地在场临时队友 NPC，返回 NPC id（失败返回空串）。 */
export function summonMonument(entry: MonumentEntry): string {
  const snap = entry?.snapshot;
  if (!snap || !snap.name) return '';
  const npc = useNpc.getState();
  const world = (useMisc.getState() as any).worldName || '';

  // 去重：该碑已在本世界召唤 → 只确保在场，不重复建档
  const exist = Object.values(npc.npcs).find((r) => r.monumentId === entry.id);
  if (exist) {
    if (!exist.onScene) npc.setScene(exist.id, true);
    npc.upsertNpc(exist.id, { keepForever: true, partyMember: true, partyWorld: world });
    void bumpAutoSave();   // 回合外改动→刷新自动档，防"刷新→继续读自动档"丢失
    return exist.id;
  }

  // 1) 建临时队友骨架（拿到 C-id，自带 partyMember/onScene/realm=阶位|纪念英灵）
  const cid = npc.createPartyMember({
    name: snap.name,
    tier: snap.tier || '',
    job: snap.profession || '',
    persona: snap.personality || '',
    role: '纪念英灵',
    world,
  });

  // 2) 灌入完整面板（有效六维 + HP/EP + 外观 + 立绘 + 身份字段 + 生平/结语并进档案 + 强制在场）
  const a: any = snap.attrs || {};
  const background = [
    snap.race ? `种族：${snap.race}` : '',
    snap.raceDetail || '',
    snap.personalityDetail || '',
    snap.background || '',
    entry.summary ? `【生平】\n${entry.summary}` : '',
    entry.eulogy ? `【结语】\n${entry.eulogy}` : '',
  ].filter(Boolean).join('\n\n');
  const patch: Partial<NpcRecord> = {
    gender: coerceGender(snap.gender),
    appearanceDetail: snap.appearance || '',
    background,
    title: snap.title || '',
    brandLevel: snap.brandLevel || undefined,
    bioStrength: snap.bioStrength || undefined,
    attrs: {
      str: Number(a.str) || 5, agi: Number(a.agi) || 5, con: Number(a.con) || 5,
      int: Number(a.int) || 5, cha: Number(a.cha) || 5, luck: Number(a.luck) || 5,
    },
    hp: snap.maxHp, maxHp: snap.maxHp,
    mp: snap.maxEp, maxMp: snap.maxEp,
    hpRatio: snap.hpRatio,
    epRatio: snap.epRatio,
    realAttrs: (snap.realAttrs as any) || undefined,   // NPC 入碑保留真实属性直加
    avatar: snap.avatar || undefined,
    npcTag: snap.npcTag || '契约者',   // NPC 入碑保留原标签（土著/随从/宠物…）；主角入碑=契约者
    // NPC 专属身份字段一并还原，避免召唤丢信息
    personality: snap.personality || undefined,
    innerThought: snap.personalityDetail || undefined,
    age: snap.age || undefined,
    affiliatedTeam: snap.affiliatedTeam || undefined,
    contractorId: snap.contractorId || undefined,
    arenaRank: snap.arenaRank || undefined,
    status: snap.status && snap.status !== '一切正常' ? snap.status : undefined,
    keepForever: true,                 // 强制在场：reconcileScenePresence/pruneGhostNpcs 都会跳过长期保留角色
    partyMember: true,
    partyWorld: world,
    monumentId: entry.id,
    review: snap.review || `自纪念丰碑召唤的英灵·${snap.name}${snap.tier ? `（${snap.tier}）` : ''}。`,
  };

  // 3) 物品：装备 + 储存空间（装备不 equipped，避免有效六维二次叠加）
  const items: NpcOwnedItem[] = [];
  (snap.equipment || []).forEach((e: any, i: number) => items.push(toOwnedItem(e, cid, i, true)));
  (snap.items || []).forEach((it: any, i: number) => items.push(toOwnedItem(it, cid, 100 + i, false)));
  if (items.length) patch.items = items;

  npc.upsertNpc(cid, patch);

  // 4) 技能/天赋/称号/副职业写进 characterStore（同 materializeAssist；新角色整体写入）
  try {
    useCharacters.setState((s) => ({
      characters: {
        ...s.characters,
        [cid]: {
          id: cid,
          skills: (snap.skills || []) as any,
          traits: (snap.traits || []) as any,
          titles: (snap.titles || []) as any,
          subProfessions: (snap.subProfessions || []) as any,
        },
      },
    }));
  } catch { /* 技能写入失败不阻断召唤 */ }

  void bumpAutoSave();   // 回合外改动→刷新自动档，防"刷新→继续读自动档"丢失（同助战NPC刷新就不见的根因）
  return cid;
}

/** 遣散一名召唤的纪念英灵：硬删除（连带清掉 characterStore 里的技能/天赋孤儿数据）。 */
export function dismissMonument(npcId: string): void {
  try { useNpc.getState().hardRemoveNpc(npcId); } catch { /* */ }
  void bumpAutoSave();   // 遣散也刷新自动档，否则刷新读旧自动档会让已遣散的又回来
}

/** 当前存档里所有「已召唤的纪念英灵」（供面板列出 + 遣散）。 */
export function listSummonedMonuments(): NpcRecord[] {
  return Object.values(useNpc.getState().npcs).filter((r) => !!r.monumentId);
}
