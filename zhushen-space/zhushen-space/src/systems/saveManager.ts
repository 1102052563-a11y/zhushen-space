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

/* 纳入快照的所有持久化 store（key 必须与各 store persist 的 name 一致）*/
const STORES: { key: string; api: any }[] = [
  { key: 'zhushen-save-v1', api: useGame },   // gameStore(主角 HP/EP/atk/def…)用自定义 writeSave 持久化到 zhushen-save-v1(非 zustand 的 drpg-save)——必须用真实键,否则存档快照抓不到主角血蓝、读档也还原不了(2026-06-19 修)
  { key: 'drpg-settings',   api: useSettings },
  { key: 'drpg-items',      api: useItems },
  { key: 'drpg-player-evo', api: usePlayer },
  { key: 'drpg-npc',        api: useNpc },
  { key: 'drpg-npc-chat',   api: useNpcChat },
  { key: 'drpg-npc-evo',    api: useNpcEvo },
  { key: 'drpg-faction',    api: useFaction },
  { key: 'drpg-faction-evo', api: useFactionEvo },
  { key: 'drpg-territory',   api: useTerritory },
  { key: 'drpg-team',        api: useTeam },
  { key: 'drpg-image-gen',   api: useImageGen },
  { key: 'drpg-turn-insight', api: useTurnInsight },
  { key: 'drpg-characters', api: useCharacters },
  { key: 'drpg-memory',     api: useMemory },
  { key: 'drpg-misc',       api: useMisc },
  { key: 'drpg-channel',    api: useChannel },
  { key: 'drpg-cosmos',     api: useCosmos },
  { key: 'drpg-world-codex', api: useWorldCodex },
  { key: 'drpg-dm',         api: useDm },
  { key: 'drpg-fanfic',     api: useFanfic },
  { key: 'drpg-fact',       api: useFact },
  { key: 'drpg-combat',     api: useCombat },
  { key: 'drpg-arena',      api: useArena },
  { key: 'drpg-skilltree',  api: useSkillTree },
  { key: 'drpg-casino',     api: useCasino },
  { key: 'drpg-abyss',      api: useAbyss },
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
export async function autoSaveSlot(messages: any[]): Promise<void> {
  try { await saveSlot(AUTOSAVE_ID, '⏱ 自动存档', messages); } catch (e) { console.warn('[Save] 自动存档失败:', e); }
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
  for (const { key } of STORES) {
    const v = slot.data.stores[key];
    if (typeof v === 'string') localStorage.setItem(key, mergeKeepApi(key, v));   // API 配置不随存档回滚
    else if (key !== 'zhushen-save-v1') localStorage.removeItem(key);   // 存档快照里没有的 store（多为存档创建时尚不存在的较新功能，如技能树/潜能点）→ 清掉本地残留，让其 reload 后回到默认；否则上一局的进度（如潜能点）会泄漏进读入的旧档。**例外 zhushen-save-v1(主角HP/EP)**：旧档(改键前创建)没存它，清掉会把当前血蓝抹成默认，保留当前值（已由 setPlayerField 持久化）
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
  try { useGame.getState().hardReset(); } catch (e) { logWarn('clearProgress', e); }            // 玩家属性 → 默认
  try { useItems.getState().clearAll(); } catch (e) { logWarn('clearProgress', e); }            // 背包/货币
  try { useNpc.getState().clearAll(); } catch (e) { logWarn('clearProgress', e); }              // NPC 档案（含其技能词条）
  try { useNpcChat.getState().clearAll(); } catch (e) { logWarn('clearProgress', e); }          // NPC 私聊缓存（对话+交互描述）
  try { useFaction.getState().clearAll(); } catch (e) { logWarn('clearProgress', e); }          // 势力档案
  try { useTerritory.getState().clearTerritory(); } catch (e) { logWarn('clearProgress', e); }  // 领地记录（保留预设/API 配置）
  try { useTeam.getState().clearTeam(); } catch (e) { logWarn('clearProgress', e); }            // 冒险团记录（保留预设/API 配置）
  try { useTurnInsight.getState().clear(); } catch (e) { logWarn('clearProgress', e); }         // 回合洞察快照
  try { useChannel.getState().clearChannel(); } catch (e) { logWarn('clearProgress', e); }      // 公共频道消息（保留预设/API 配置）
  try { useCosmos.getState().clearCosmos(); } catch (e) { logWarn('clearProgress', e); }        // 万族棋盘（保留预设/API 配置；新游戏后下次演化会按种子模式重新播种）
  try { useWorldCodex.getState().clearAll(); } catch (e) { logWarn('clearProgress', e); }       // 世界百科情报缓存（保留启用/API 路由）
  try { useDm.getState().clearAll(); } catch (e) { logWarn('clearProgress', e); }               // 私信会话
  try { useFanfic.getState().clearAll(); } catch (e) { logWarn('clearProgress', e); }           // 同人角色设定缓存
  try { useFact.getState().clearAll(); } catch (e) { logWarn('clearProgress', e); }             // 事实锚点缓存
  try { useCombat.getState().clearCombat(); } catch (e) { logWarn('clearProgress', e); }        // 战斗运行态（保留预设/API 配置）
  try { useArena.getState().clearArena(); } catch (e) { logWarn('clearProgress', e); }          // 竞技场榜单/击败记录/挑战（保留 API 配置）
  try { useCasino.getState().clearCasino(); } catch (e) { logWarn('clearProgress', e); }        // 赌坊筹码/战绩/流水（保留限红/抽水等配置）
  try { useAbyss.getState().clearAbyss(); } catch (e) { logWarn('clearProgress', e); }          // 深渊地牢 进行局 + meta（结晶/通关/觉醒充能/卡牌库）
  try { useSkillTree.setState({ progress: {} }); } catch (e) { logWarn('clearProgress', e); }   // 技能树解锁进度/潜能点（保留 trees 模板库）
  try { clearJoySessions(); } catch (e) { logWarn('clearProgress', e); }                        // 欢愉宫情欲值/私密/聊天（保留名册/预设/API 配置）
  try { useCharacters.setState({ characters: {} }); } catch (e) { logWarn('clearProgress', e); }// 主角+全部角色技能/词条/称号/记忆
  try {
    usePlayer.getState().setProfile({ ...DEFAULT_PLAYER_PROFILE }); // 主角档案
    usePlayer.setState({ achievements: [] });                       // 成就清空
  } catch (e) { logWarn('clearProgress', e); }
  try {
    const m = useMisc.getState();
    m.clearMisc();                 // 任务/世界大事/大小总结
    m.clearNarrativeFacts();       // 长期事实
    m.setTime({ paradiseTime: '', worldTime: '', worldName: '' });
    m.setWeather('');
  } catch (e) { logWarn('clearProgress', e); }
  try { await clearAllImg(); } catch (e) { logWarn('clearProgress', e); }  // 清空 IndexedDB 里的头像/装备图
  // 注：不在此清向量库（drpg-factvec）——它是全局内容寻址缓存，清了会误伤其它存档的向量索引；
  // 残留向量不会污染任何档（召回只在当前档事实池内 cosine）。想回收空间用设置→向量记忆的「清空向量库」按钮。
  await replaceChat([]);           // 对话历史
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
