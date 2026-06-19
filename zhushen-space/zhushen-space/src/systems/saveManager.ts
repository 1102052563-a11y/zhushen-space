import { saveDb } from './saveDb';
import { replaceAll as replaceChat } from './chatDb';
import { bulkPutImg, clearAllImg } from './imageDb';
import { snapshotImages } from './imageSync';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { useItems } from '../store/itemStore';
import { usePlayer, DEFAULT_PLAYER_PROFILE } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useNpcChat } from '../store/npcChatStore';
import { useNpcEvo } from '../store/npcEvoStore';
import { useFaction } from '../store/factionStore';
import { useFactionEvo } from '../store/factionEvoStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam } from '../store/adventureTeamStore';
import { useImageGen } from '../store/imageGenStore';
import { useTurnInsight } from '../store/turnInsightStore';
import { useCharacters } from '../store/characterStore';
import { useMemory } from '../store/memoryStore';
import { useMisc } from '../store/miscStore';
import { useChannel } from '../store/channelStore';
import { useCosmos } from '../store/cosmosStore';
import { useWorldCodex } from '../store/worldCodexStore';
import { useDm } from '../store/dmStore';
import { useFanfic } from '../store/fanficStore';
import { useFact } from '../store/factStore';
import { useCombat } from '../store/combatStore';
import { useArena } from '../store/arenaStore';
import { useSkillTree } from '../store/skillTreeStore';
import { useCasino } from '../store/casinoStore';
import { useAbyss } from '../store/abyssStore';
import { clearJoySessions } from '../store/joyStore';
import { logWarn } from '../utils/log';
import { writeB1Mirror, clearB1Mirror } from './b1Mirror';

/* ── 持久化 store 单一注册表 ──────────────────────────────────────────────
   一份清单同时驱动「存档快照」(snapshotStores/loadSlot 读写 key 的 localStorage JSON)
   与「新游戏清空」(clearProgress 调 clear)。加新 store 只改这一处,不再两份清单漂移。
   - key：必须与各 store persist 的 name 一致(gameStore 例外,用自定义 writeSave 键)。
   - clear：新游戏要清的「进度」store 才给；不给 clear 的=「配置/预设」store(settings/各 evo 预设/
     image-gen/memory)→ 自动随新游戏保留。clear 即原 clearProgress 里对该 store 的那步,语义不变。 */
const STORES: { key: string; api: any; clear?: () => void }[] = [
  { key: 'zhushen-save-v1', api: useGame, clear: () => useGame.getState().hardReset() },   // gameStore(主角HP/EP/atk/def…)用自定义 writeSave 持久化到 zhushen-save-v1(非 drpg-save)——键必须真实,否则存档抓不到主角血蓝(2026-06-19 修)
  { key: 'drpg-settings',   api: useSettings },   // 配置：新游戏保留
  { key: 'drpg-items',      api: useItems, clear: () => useItems.getState().clearAll() },
  { key: 'drpg-player-evo', api: usePlayer, clear: () => { usePlayer.getState().setProfile({ ...DEFAULT_PLAYER_PROFILE }); usePlayer.setState({ achievements: [] }); } },
  { key: 'drpg-npc',        api: useNpc, clear: () => useNpc.getState().clearAll() },
  { key: 'drpg-npc-chat',   api: useNpcChat, clear: () => useNpcChat.getState().clearAll() },
  { key: 'drpg-npc-evo',    api: useNpcEvo },     // 预设：保留
  { key: 'drpg-faction',    api: useFaction, clear: () => useFaction.getState().clearAll() },
  { key: 'drpg-faction-evo', api: useFactionEvo }, // 预设：保留
  { key: 'drpg-territory',   api: useTerritory, clear: () => useTerritory.getState().clearTerritory() },
  { key: 'drpg-team',        api: useTeam, clear: () => useTeam.getState().clearTeam() },
  { key: 'drpg-image-gen',   api: useImageGen },   // 配置：保留（图片走 IndexedDB 单独清）
  { key: 'drpg-turn-insight', api: useTurnInsight, clear: () => useTurnInsight.getState().clear() },
  { key: 'drpg-characters', api: useCharacters, clear: () => useCharacters.setState({ characters: {} }) },
  { key: 'drpg-memory',     api: useMemory },      // 保留
  { key: 'drpg-misc',       api: useMisc, clear: () => { const m = useMisc.getState(); m.clearMisc(); m.clearNarrativeFacts(); m.setTime({ paradiseTime: '', worldTime: '', worldName: '' }); m.setWeather(''); } },
  { key: 'drpg-channel',    api: useChannel, clear: () => useChannel.getState().clearChannel() },
  { key: 'drpg-cosmos',     api: useCosmos, clear: () => useCosmos.getState().clearCosmos() },
  { key: 'drpg-world-codex', api: useWorldCodex, clear: () => useWorldCodex.getState().clearAll() },
  { key: 'drpg-dm',         api: useDm, clear: () => useDm.getState().clearAll() },
  { key: 'drpg-fanfic',     api: useFanfic, clear: () => useFanfic.getState().clearAll() },
  { key: 'drpg-fact',       api: useFact, clear: () => useFact.getState().clearAll() },
  { key: 'drpg-combat',     api: useCombat, clear: () => useCombat.getState().clearCombat() },
  { key: 'drpg-arena',      api: useArena, clear: () => useArena.getState().clearArena() },
  { key: 'drpg-skilltree',  api: useSkillTree, clear: () => useSkillTree.setState({ progress: {} }) },
  { key: 'drpg-casino',     api: useCasino, clear: () => useCasino.getState().clearCasino() },
  { key: 'drpg-abyss',      api: useAbyss, clear: () => useAbyss.getState().clearAbyss() },
];

export interface SlotPreview { turn: number; playerName: string; location: string; lastText: string }
export interface SaveSlot {
  id: string;
  name: string;
  appVersion: string;
  createdAt: number;
  updatedAt: number;
  preview: SlotPreview;
  data: { stores: Record<string, string>; messages: any[]; images?: Record<string, string> };
}
export type SlotMeta = Omit<SaveSlot, 'data'>;

const APP_VERSION = 'V0.0.1';

/* 读取所有 store 当前持久化的原始 JSON 字符串 */
function snapshotStores(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key } of STORES) {
    const v = localStorage.getItem(key);
    if (v != null) out[key] = v;
  }
  return out;
}

function buildPreview(messages: any[]): SlotPreview {
  const last = [...messages].reverse().find((m) => m.role === 'assistant')?.content ?? '';
  return {
    // 回合数 = 用户发送次数（与状态栏 turnCountRef、读档恢复口径一致）；
    // 不能用 messages.length——那会把 AI 回复也算进去，导致显示翻倍（开局即"回合2"、3回合显示"回合6"）
    turn: messages.filter((m) => m.role === 'user').length,
    playerName: usePlayer.getState().profile.name || '主角',
    location: useMisc.getState().worldName || '',
    lastText: String(last).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 90),
  };
}

/* 新建或覆盖一个存档槽 */
export async function saveSlot(id: string | null, name: string, messages: any[], includeImages = true): Promise<string> {
  const now = Date.now();
  const realId = id ?? `slot_${now}`;
  const existing = id ? await saveDb.get<SaveSlot>(id) : null;
  const slot: SaveSlot = {
    id: realId,
    name: name.trim() || `存档 ${new Date(now).toLocaleString()}`,
    appVersion: APP_VERSION,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    preview: buildPreview(messages),
    // 图片(IndexedDB)取内存最新快照打包进存档；includeImages=false 时不打包——降级用，避免大图把整次保存撑爆 IndexedDB 配额而失败
    data: { stores: snapshotStores(), messages, ...(includeImages ? { images: snapshotImages() } : {}) },
  };
  await saveDb.put(slot);
  return realId;
}

/* ── 自动存档：每回合结束覆盖同一个固定槽 ── */
export const AUTOSAVE_ID = 'autosave';
/* ── 回退点：每次发送前覆盖此槽，记录"上一回合结束时"的完整状态（所有演化+对话+图），供回退/重新生成 ── */
export const UNDO_ID = 'undo-point';
/* ── 滚动自动备份：每回合多留一份**轻量(不含图片)**快照，仅保最近 N 份 ──
   防"单一 autosave 被坏状态一次覆盖光、没有后悔药"。不含图片(图片同设备由 imageDb 现存回填)，
   故体积远小于带图 autosave，可放心多留几份；可在存档面板直接「读取」回滚或「提主角」抽回。 */
export const AUTOSNAP_PREFIX = 'autosnap_';
export const AUTOSNAP_KEEP = 5;
export async function autoSaveSlot(messages: any[]): Promise<void> {
  try { await saveSlot(AUTOSAVE_ID, '⏱ 自动存档', messages); } catch (e) { console.warn('[Save] 自动存档失败:', e); }
  // 滚动备份(轻量·不含图)：留最近 N 份，超出删最旧
  try {
    const now = Date.now();
    await saveSlot(`${AUTOSNAP_PREFIX}${now}`, `🛟 自动备份 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`, messages, false);
    const snaps = (await saveDb.all<SaveSlot>())
      .filter((s) => typeof s.id === 'string' && s.id.startsWith(AUTOSNAP_PREFIX))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const old of snaps.slice(AUTOSNAP_KEEP)) { try { await saveDb.del(old.id); } catch { /* 删旧备份失败忽略 */ } }
  } catch (e) { console.warn('[Save] 滚动备份失败:', e); }
  // 主角镜像兜底(随回合更新；仅 B1 非空时写)
  try { writeB1Mirror(); } catch { /* */ }
}

export async function hasUndoPoint(): Promise<boolean> {
  return !!(await saveDb.get<SaveSlot>(UNDO_ID));
}

export async function listSlots(): Promise<SlotMeta[]> {
  const all = await saveDb.all<SaveSlot>();
  return all
    .filter((s) => s.id !== UNDO_ID)   // 内部回退点不在存档列表显示
    .map(({ data, ...meta }) => meta)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const PENDING_STARTED_KEY = 'drpg-pending-started';

/* 读档时保留「当前」的 API 配置，不被存档里的旧 API 覆盖——API 属设备级全局配置，不该绑定到具体存档。
   做法：每个 store 的持久化 JSON，state 里键名含 "api"(不分大小写：api/textApi/各功能*Api/apiLibrary/apiRoutes/*UseSharedApi) 的字段，用当前值覆盖存档值。*/
function mergeKeepApi(key: string, savedJson: string): string {
  try {
    const cur = localStorage.getItem(key);
    if (!cur) return savedJson;
    const sv = JSON.parse(savedJson), cv = JSON.parse(cur);
    if (sv && cv && sv.state && cv.state) {
      for (const k of Object.keys(cv.state)) if (/api/i.test(k)) sv.state[k] = cv.state[k];
      return JSON.stringify(sv);
    }
  } catch (e) { logWarn('saveManager.mergeKeepApi', e); }
  return savedJson;
}

/* 读取存档：把快照写回 localStorage，对话历史写回 IndexedDB（chatDb），整页 reload。
   reload 让 zustand persist 各 store 与 gameStore（模块初始化时读 localStorage）一并恢复；
   对话历史由 App 挂载时从 chatDb 读回。这是混合持久化下最稳的方案。*/
export async function loadSlot(id: string): Promise<boolean> {
  const slot = await saveDb.get<SaveSlot>(id);
  if (!slot) return false;
  // 读档时 store 写回策略：
  // - 快照里有 → 写回（API 字段保当前）。
  // - 快照里没有 → **只清【较新功能的进度缓存】**（防上一局的 潜能点/筹码/深渊进度 等泄漏进读入的旧档）；
  //   **核心存档（主角技能/天赋/副职业·背包·NPC·主角档案·HP/EP 等）绝不因快照缺失而清空**——
  //   否则读个缺这些键的旧档/回退点就会把当前的技能天赋副职业全抹掉（"读档后技能丢失"的根因，已修）。
  const CLEAR_ON_MISSING = new Set(['drpg-skilltree', 'drpg-casino', 'drpg-abyss', 'drpg-world-codex']);
  for (const { key } of STORES) {
    const v = slot.data.stores[key];
    if (typeof v === 'string') localStorage.setItem(key, mergeKeepApi(key, v));   // API 配置不随存档回滚
    else if (CLEAR_ON_MISSING.has(key)) localStorage.removeItem(key);             // 仅较新功能缓存缺失才清（防泄漏）；核心存档一律保留当前，绝不抹
  }
  // 图片：覆盖 IndexedDB（reload 后由 hydrateImages 回填到各 store）。
  // 仅当快照带了图片才清+写；不带图片的快照（如降级保存的回退点）保留现有图片，避免回退把图全清掉。
  try { if (slot.data.images) { await clearAllImg(); await bulkPutImg(slot.data.images); } } catch (e) { logWarn('saveManager.loadSlot.images', e); }
  await replaceChat(slot.data.messages ?? []);   // 覆盖当前对话为存档对话
  // 读「用户存档」会让回退点失效：它仍指向读档前那条时间线（不同的对话/演化），
  // 留着会导致读档后点「回退/重新生成」跳回另一条时间线（表现为"回退不生效/乱跳"）。
  // 清掉它——读档后本时间线尚无"上一回合"，回退按钮置灰（canUndo=false），下次发送会重建属于本档的回退点。
  // 注意：回退/重新生成自身也走 loadSlot(UNDO_ID)，那种情况 id===UNDO_ID，不可误删（否则连续回退失效）。
  if (id !== UNDO_ID) { try { await saveDb.del(UNDO_ID); } catch (e) { logWarn('saveManager.loadSlot.undoDel', e); } }
  try { sessionStorage.setItem(PENDING_STARTED_KEY, '1'); } catch (e) { logWarn('saveManager.loadSlot.pendingFlag', e); }
  location.reload();
  return true;
}

/* ── 从某个存档「只提取主角(B1)的 技能/天赋/副职业/称号」并入当前游戏 ─────────────
   救「主角技能/天赋/副职业丢了，但旧存档里还在」——又不想整档读回去丢掉当前进度。
   只**新增**（按名字去重；当前已有的一律保留，只把存档里缺的补进来），绝不删除/覆盖当前其它字段或其它角色。
   直接写**运行中的 store**（非裸改 localStorage），persist 自然落盘，不 reload、无竞态。
   返回并入后 B1 的各项计数 + 本次新增的名字，供面板提示；存档无该项/无 B1 则返回 null。 */
export async function extractPlayerFromSlot(
  id: string,
): Promise<{ counts: { skills: number; traits: number; subProfessions: number; titles: number }; added: string[] } | null> {
  const slot = await saveDb.get<SaveSlot>(id);
  const raw = slot?.data?.stores?.['drpg-characters'];
  if (!raw) return null;
  let savedB1: any = null;
  try { savedB1 = JSON.parse(raw)?.state?.characters?.B1; } catch { return null; }
  if (!savedB1) return null;

  const cur: any = useCharacters.getState().characters['B1'] || {};
  const keyOf = (x: any) => (typeof x === 'string' ? x : (x?.name ?? x?.title ?? ''));
  const added: string[] = [];
  // 当前在前、存档补后；按名字去重，记录新增
  const mergeByName = (a: any[] = [], b: any[] = [], label = '') => {
    const out = [...(a || [])];
    const have = new Set((a || []).map(keyOf));
    for (const x of (b || [])) {
      const k = keyOf(x);
      if (k && !have.has(k)) { out.push(x); have.add(k); if (label) added.push(`${label}「${k}」`); }
    }
    return out;
  };
  const mergedB1 = {
    ...savedB1,   // 存档 B1 作底（B1 整个丢了时这一步就把基础字段也带回来）
    ...cur,       // 当前字段覆盖（保住当前进度里的 name/六维/外观… 等）
    skills:         mergeByName(cur.skills, savedB1.skills, '技能'),
    traits:         mergeByName(cur.traits, savedB1.traits, '天赋'),
    subProfessions: mergeByName(cur.subProfessions, savedB1.subProfessions, '副职业'),
    titles:         mergeByName(cur.titles, savedB1.titles, '称号'),
  };
  useCharacters.setState((s) => ({ characters: { ...s.characters, B1: mergedB1 } }));
  try { useCharacters.getState().dedupeIds?.(); } catch { /* 合并可能撞历史 id，去重一次（与启动时同一处理） */ }

  return {
    counts: {
      skills: (mergedB1.skills || []).length,
      traits: (mergedB1.traits || []).length,
      subProfessions: (mergedB1.subProfessions || []).length,
      titles: (mergedB1.titles || []).length,
    },
    added,
  };
}

export async function renameSlot(id: string, name: string) {
  const slot = await saveDb.get<SaveSlot>(id);
  if (!slot) return;
  slot.name = name.trim() || slot.name;
  slot.updatedAt = Date.now();
  await saveDb.put(slot);
}

export async function deleteSlot(id: string) {
  await saveDb.del(id);
}

export async function exportSlot(id: string) {
  const slot = await saveDb.get<SaveSlot>(id);
  if (!slot) return;
  const blob = new Blob([JSON.stringify(slot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slot.name || 'save'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* 新游戏：清空全部「游戏进度」（角色/NPC/物品/对话/任务/世界状态），
   保留「配置」（API / 世界书 / 预设 / 调度 / 提示词等）。完成后整页 reload 回到封面。*/
/** 清空全部游戏进度（不 reload），保留配置（API/世界书/预设等）。
 *  供「新游戏」与「开局角色创建」复用——后者清完再写入新角色。 */
export async function clearProgress(): Promise<void> {
  // 各「进度」store 清空 → 从单一注册表 STORES 派生（带 clear 的才清；config/预设 store 无 clear 故自动保留）。
  // 「保存」与「清空」共用同一份 STORES，加新 store 只改一处，杜绝两份清单漂移。
  for (const s of STORES) {
    if (s.clear) { try { s.clear(); } catch (e) { logWarn(`clearProgress:${s.key}`, e); } }
  }
  // 不入存档快照 / 走 IndexedDB 的额外清理：
  try { clearJoySessions(); } catch (e) { logWarn('clearProgress:joy', e); }      // 欢愉宫情欲值/私密/聊天（独立 store，不入快照；保留名册/预设/API）
  try { await clearAllImg(); } catch (e) { logWarn('clearProgress:images', e); }  // IndexedDB 头像/装备图
  // 注：不在此清向量库（drpg-factvec）——它是全局内容寻址缓存，清了会误伤其它存档的向量索引；
  // 残留向量不会污染任何档（召回只在当前档事实池内 cosine）。想回收空间用设置→向量记忆的「清空向量库」按钮。
  await replaceChat([]);           // 对话历史
  try { clearB1Mirror(); } catch (e) { logWarn('clearProgress:b1mirror', e); }   // 主角镜像兜底：新游戏清掉，避免误把上一局主角补进空白新档
  // 滚动自动备份：新游戏清掉上一局的所有轻量备份（属"进度"，不该带进新局）
  try {
    const snaps = (await saveDb.all<SaveSlot>()).filter((s) => typeof s.id === 'string' && s.id.startsWith(AUTOSNAP_PREFIX));
    for (const s of snaps) { try { await saveDb.del(s.id); } catch { /* */ } }
  } catch (e) { logWarn('clearProgress:autosnap', e); }
  // 删除上一局的内部「回退点」固定槽：否则新开局第一回合失败后点「重新生成/回退」，
  // 会载入仍残留的上一局回退点 → 瞬间跳回另一局的中断处重发。
  // UNDO_ID 是内部槽（不在存档列表显示、非用户命名存档），删它不影响任何旧存档；
  // 新局的开局建档/首次发送会通过 captureUndoPoint 重建一个属于本局的回退点。
  try { await saveDb.del(UNDO_ID); } catch (e) { logWarn('clearProgress', e); }
}

export async function newGame(): Promise<void> {
  await clearProgress();
  // reload 后回到 StartScreen（不写 PENDING_STARTED），玩家点「开始游戏」进入空白局
  location.reload();
}

export async function importSlot(raw: string): Promise<string> {
  const slot = JSON.parse(raw) as SaveSlot;
  if (!slot?.data?.stores) throw new Error('存档格式不正确');
  // 仅保留白名单 store，避免脏数据
  const allowed = new Set(STORES.map((s) => s.key));
  slot.data.stores = Object.fromEntries(
    Object.entries(slot.data.stores).filter(([k]) => allowed.has(k)),
  );
  slot.id = `slot_${Date.now()}`;          // 导入生成新 id，避免覆盖现有
  slot.updatedAt = Date.now();
  if (!slot.createdAt) slot.createdAt = slot.updatedAt;
  if (!Array.isArray(slot.data.messages)) slot.data.messages = [];
  await saveDb.put(slot);
  return slot.id;
}
