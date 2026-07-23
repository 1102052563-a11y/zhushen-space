import { saveDb } from './saveDb';
import { setResumeFlag } from './resumeFlag';
import { decompressMaybe, compressWithMark, isCompressed, flushPersistWrites, suspendPersistWrites } from './compressedStorage';   // drpg-misc 压缩存：mergeKeepApi 需解压再合并；flush/suspend=合并写盘下快照读最新值、读档防延迟写盖档
import { replaceAll as replaceChat, loadAll as loadChat, loadArchive, replaceArchive, clearArchive, type ArchivedMsg } from './chatDb';
import { bulkPutImg, clearAllImg } from './imageDb';
import { snapshotImages } from './imageSync';
import { useGame } from '../store/gameStore';
import { useSettings } from '../store/settingsStore';
import { useItems } from '../store/itemStore';
import { usePlayer, DEFAULT_PLAYER_PROFILE } from '../store/playerStore';
import { useResource } from '../store/resourceStore';
import { useVariables } from '../store/variableStore';
import { useTables } from '../store/tableStore';
import { useTableJournal } from '../store/tableJournalStore';
import { walletReset } from './ledger/walletCore';   // Step 10 货币事件核心（drpg-wallet·自管 localStorage）
import { itemCoreReset } from './ledger/itemCore';   // Step 10 物品事件核心（drpg-items-core·现搬 IndexedDB）
import { npcCoreReset } from './ledger/npcCore';   // Step 10 NPC 事件核心（drpg-npc-core·现搬 IndexedDB）
import { flagCoresReseed } from './ledger/preloadCores';   // 阶段1：读档/新游戏 reload 前标记事件核心重播
import { resetEventCoresIdb } from './ledger/coreKv';       // 阶段1：清空事件核心 IDB（clearProgress 用·awaitable）
import { useNpc } from '../store/npcStore';
import { useNpcChat } from '../store/npcChatStore';
import { useNpcEvo } from '../store/npcEvoStore';
import { usePetEvo } from '../store/petEvoStore';
import { useFaction } from '../store/factionStore';
import { useFactionEvo } from '../store/factionEvoStore';
import { useTerritory } from '../store/territoryStore';
import { useTeam } from '../store/adventureTeamStore';
import { useImageGen } from '../store/imageGenStore';
import { useTurnInsight } from '../store/turnInsightStore';
import { useCharacters } from '../store/characterStore';
import { useMemory } from '../store/memoryStore';
import { useMisc } from '../store/miscStore';
import { useWorldRecord } from '../store/worldRecordStore';
import { useChannel } from '../store/channelStore';
import { useCosmos } from '../store/cosmosStore';
import { useWorldCodex } from '../store/worldCodexStore';
import { useDm } from '../store/dmStore';
import { useFanfic } from '../store/fanficStore';
import { useFact } from '../store/factStore';
import { useCombat } from '../store/combatStore';
import { useArena } from '../store/arenaStore';
import { useSkillTree } from '../store/skillTreeStore';
import { useSubProfTree } from '../store/subProfTreeStore';
import { useCasino } from '../store/casinoStore';
import { useAbyss } from '../store/abyssStore';
import { useCraft } from '../store/craftStore';
import { useEquipSets } from '../store/equipSetStore';
import { useLedger } from './ledger/ledgerStore';
import { useLocks } from '../store/lockStore';
import { useFieldHistory } from '../store/fieldHistoryStore';
import { useLoadout } from '../store/loadoutStore';
import { useShop } from '../store/shopStore';
import { useCanonRoute } from '../store/canonRouteStore';
import { clearJoySessions } from '../store/joyStore';
import { useDbAdvance } from '../store/dbAdvanceStore';   // 数据库推进桌面态现已持久化 → 新游戏须显式清运行态
import { logWarn } from '../utils/log';
import { writeB1Mirror, clearB1Mirror } from './b1Mirror';
import { isFolderBackupSupported, folderAutoEnabled, checkPermission as fbCheckPermission, writeFile as fbWriteFile, FOLDER_AUTOSAVE_FILE } from './folderBackup';

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
  { key: 'drpg-ledger',     api: useLedger, clear: () => useLedger.getState().clear() },   // 演化账本(物品闸门审计)：进度数据,新游戏清空、随存档快照
  { key: 'drpg-locks',      api: useLocks, clear: () => useLocks.getState().clearLocks() },   // 字段级锁定(Pin)：按实体id锁,随存档走、新游戏清空
  { key: 'drpg-field-history', api: useFieldHistory, clear: () => useFieldHistory.getState().clear() },   // 字段历史趋势(六维/阶位/等级逐回合采样)：进度数据,随存档、新游戏清空


  { key: 'drpg-player-evo', api: usePlayer, clear: () => { usePlayer.getState().setProfile({ ...DEFAULT_PLAYER_PROFILE }); usePlayer.setState({ achievements: [] }); } },
  { key: 'drpg-npc',        api: useNpc, clear: () => useNpc.getState().clearAll() },
  { key: 'drpg-npc-chat',   api: useNpcChat, clear: () => useNpcChat.getState().clearAll() },
  { key: 'drpg-npc-evo',    api: useNpcEvo },     // 预设：保留
  { key: 'drpg-pet-evo',    api: usePetEvo },     // 宠物/召唤物演化·预设/配置：保留（不给 clear，随新游戏保留）
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
  { key: 'drpg-resource',   api: useResource, clear: () => useResource.getState().clearResources() },   // 自定义能量条（定义+当前值随存档；新游戏清空）
  { key: 'drpg-variables',  api: useVariables, clear: () => useVariables.getState().resetAll() },   // 自定义变量（透明引用）：定义+当前值随存档；新游戏只清零值、保留定义（便于二创导入的变量过新游戏不丢）
  { key: 'drpg-tables',     api: useTables, clear: () => useTables.getState().resetAll() },   // ACU 表格数据库（游戏状态表·主角/背包/NPC…）：进度数据，随存档快照，新游戏重置为默认表
  { key: 'drpg-table-journal', api: useTableJournal, clear: () => useTableJournal.getState().clear() },   // 表编辑日志（幂等摘要+流水+删除找回）：随存档快照（回退点恢复=摘要一并回卷，重放不误拦），新游戏清空
  // 三事件核心（阶段1 已搬 IndexedDB drpg-core-kv·不再占 localStorage）：snapshotStores 读 localStorage 为空即跳过（不随存档快照），
  //   读档/新游戏经 flagCoresReseed→preloadEventCores 清 IDB 后从现场 store 重播影子基线；此处仅保留 clear 供 clearProgress 复位。
  { key: 'drpg-wallet',     api: { setState: () => {} }, clear: () => walletReset() },   // Step 10 货币事件核心（IndexedDB·非 zustand 故 api 占位·不进 ROLLBACK_KEYS）
  { key: 'drpg-items-core', api: { setState: () => {} }, clear: () => itemCoreReset() },   // Step 10 物品事件核心（IndexedDB·api 占位）
  { key: 'drpg-npc-core',   api: { setState: () => {} }, clear: () => npcCoreReset() },   // Step 10 NPC 事件核心（溯源审计·IndexedDB·api 占位）
  // 全局交易行·本机托管（tradeClient 自管 localStorage）：挂牌托管物 / 出价托管币 —— 随存档快照 + 新游戏/读档缺失即清，
  //   杜绝"交易行的托管物/币跨存档泄漏进当前背包"。成交去重键 drpg-trade-applied 刻意**不**纳入（保持全局·防跨档重复交付）。
  { key: 'drpg-trade-escrow',      api: { setState: () => {} }, clear: () => { try { localStorage.removeItem('drpg-trade-escrow'); } catch { /* */ } } },
  { key: 'drpg-trade-coin-escrow', api: { setState: () => {} }, clear: () => { try { localStorage.removeItem('drpg-trade-coin-escrow'); } catch { /* */ } } },
  { key: 'drpg-skilltree',  api: useSkillTree, clear: () => useSkillTree.setState({ progress: {} }) },
  { key: 'drpg-subproftree', api: useSubProfTree, clear: () => useSubProfTree.setState({ progress: {} }) },
  { key: 'drpg-casino',     api: useCasino, clear: () => useCasino.getState().clearCasino() },
  { key: 'drpg-craft',      api: useCraft, clear: () => useCraft.getState().clearCraft() },   // 合成工坊：配置/图鉴/API 保留，会话+已发现配方随新游戏清空
  { key: 'drpg-equipsets',  api: useEquipSets, clear: () => useEquipSets.getState().clearAll() },   // 装备套装定义（套装锻造产出·与 drpg-items 部件强耦合）：随存档快照，新游戏清空
  { key: 'drpg-abyss',      api: useAbyss, clear: () => useAbyss.getState().clearAbyss() },
  { key: 'drpg-worldrecord', api: useWorldRecord, clear: () => useWorldRecord.getState().clearAll() },   // 世界记录/世界志（世界观骨架+离世总结·随存档快照；新游戏清空）
  { key: 'drpg-loadout',    api: useLoadout, clear: () => useLoadout.getState().clearBench() },   // 体系/流派：clear 只清替补席+激活态；模板 builds[] 像技能树定义一样跨新游戏保留（照 drpg-skilltree 口径）
  { key: 'drpg-shop',       api: useShop, clear: () => useShop.getState().clearShopRun() },   // 玩家产业：店铺定义随存档快照/新游戏保留，clear 只清经营进度(earnings/visits)
  { key: 'drpg-canon-route', api: useCanonRoute, clear: () => useCanonRoute.getState().clearAll() },   // 原著路线进度（站序/偏差/苏晓轨道态）：随存档快照，新游戏清空（是否启用由创建流程重新勾选）
];

/* 「回滚本回合演化改动」（数据库引入②）——把**演化变量域** store 整体还原到某份快照（in-place setState，
   无需 reload、不会被踢回 StartScreen）。只动会被演化漂移的进度域；gameStore(HP/EP·自定义持久化) 与各类
   配置/预设 store 不动；账本**不回滚**（保留审计），并补一条 rollback 事件。返回已还原的 store key 列表。 */
const ROLLBACK_KEYS = new Set([
  'drpg-items', 'drpg-player-evo', 'drpg-npc', 'drpg-faction', 'drpg-territory',
  'drpg-team', 'drpg-characters', 'drpg-misc', 'drpg-cosmos', 'drpg-loadout',   // loadout 必须跟 drpg-characters 一起回滚，否则「出战∪替补」不变量错位
]);
export function rollbackEvoDomains(snap: { turn: number; stores: Record<string, string> }): string[] {
  const restored: string[] = [];
  for (const { key, api } of STORES) {
    if (!ROLLBACK_KEYS.has(key)) continue;
    const raw = snap.stores[key];
    if (!raw) continue;
    try {
      const o = JSON.parse(raw);
      const st = o?.state ?? o;
      if (st && typeof st === 'object') { (api as any).setState(st); restored.push(key); }
    } catch { /* 跳过坏档 */ }
  }
  try { useLedger.getState().append({ turn: snap.turn, source: 'rollback', entity: 'misc', op: 'rollback', outcome: 'applied', detail: `回滚到第 ${snap.turn} 回合演化前（${restored.length} 个变量域）` }); } catch { /* */ }
  return restored;
}

export interface SlotPreview { turn: number; playerName: string; location: string; lastText: string }
export interface SaveSlot {
  id: string;
  name: string;
  appVersion: string;
  createdAt: number;
  updatedAt: number;
  preview: SlotPreview;
  data: {
    stores: Record<string, string>;
    messages: any[];
    images?: Record<string, string>;
    // 随档嵌入的「过往世界正文归档」：仅手动存档(含图)携带；读档时还原成当前归档，让「导出全部正文」跨存档/跨人物也正确。
    narrativeArchive?: ArchivedMsg[];
    // 随档嵌入的「上一回合结束态」回退点(不含图片)。读档时还原成 UNDO_ID 槽，让读档后能立刻
    // 「回退上一回合/重新生成」**本档时间线**的上一回合（旧档无此字段，读档退回删旧回退点的老行为）。
    undo?: { stores: Record<string, string>; messages: any[] };
  };
}
export type SlotMeta = Omit<SaveSlot, 'data'>;

const APP_VERSION = 'V0.0.1';

/* 读取所有 store 当前持久化的原始 JSON 字符串 */
function snapshotStores(): Record<string, string> {
  flushPersistWrites();   // 合并写盘下 localStorage 可能落后 live state ≤300ms：先强制落盘，快照才不缺最后几笔演化
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
    // 回合数 = 本存档**累计总回合数**（持久化 miscStore.turnCount，跨任务世界不归零，与状态栏 turnCountRef 同源）；
    // 旧档无此值则回退"对话用户消息数"。不能只用对话里的用户消息数——进入世界会清空对话，会把回合数重置成新世界局部数。
    turn: useMisc.getState().turnCount || messages.filter((m) => m.role === 'user').length,
    playerName: usePlayer.getState().profile.name || '主角',
    location: useMisc.getState().worldName || '',
    lastText: String(last).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 90),
  };
}

/* 组装一个存档槽对象（不落库）——saveSlot 落 IndexedDB、folderBackup 序列化到磁盘文件都复用它。 */
async function buildSlot(id: string | null, name: string, messages: any[], includeImages = true): Promise<SaveSlot> {
  const now = Date.now();
  const realId = id ?? `slot_${now}`;
  const existing = id ? await saveDb.get<SaveSlot>(id) : null;
  // 把「当前回退点」(=上一回合结束态)随档嵌入，让读档后能回退/重新生成属于**本档时间线**的上一回合，
  // 而不必删掉回退点（删掉=读档后回退/重生按钮置灰，正是本次要修的）。嵌入快照不含图片→体积小。
  // 例外：① UNDO_ID 槽自身不嵌（避免 undo-in-undo 套娃）；② 滚动备份(autosnap)按设计保持轻量、不嵌。
  let undo: SaveSlot['data']['undo'];
  if (realId !== UNDO_ID && !realId.startsWith(AUTOSNAP_PREFIX)) {
    try {
      const up = await saveDb.get<SaveSlot>(UNDO_ID);
      // 仅当回退点**有真实对话**才嵌入：空回退点(开局/进入世界时 messagesRef 尚空所记)一旦被读档还原+回退，
      // 会把聊天清空成空白（"回退后清屏"的根因之一）→ 宁可不带，也不带一个会清屏的空回退点。
      if (up?.data && up.data.messages && up.data.messages.length > 0) undo = { stores: up.data.stores, messages: up.data.messages };
    } catch (e) { logWarn('saveManager.saveSlot.embedUndo', e); }
  }
  // 过往世界正文归档：仅手动存档(含图)随身带，读档可还原 → 导出全部正文跨存档也对；自动档/回退点不带(省体积，同一时间线靠全局归档即可)。
  const narrativeArchive = includeImages ? await loadArchive() : undefined;
  const slot: SaveSlot = {
    id: realId,
    name: name.trim() || `存档 ${new Date(now).toLocaleString()}`,
    appVersion: APP_VERSION,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    preview: buildPreview(messages),
    // 图片(IndexedDB)取内存最新快照打包进存档；includeImages=false 时不打包——降级用，避免大图把整次保存撑爆 IndexedDB 配额而失败
    data: { stores: snapshotStores(), messages, ...(includeImages ? { images: snapshotImages() } : {}), ...(narrativeArchive ? { narrativeArchive } : {}), ...(undo ? { undo } : {}) },
  };
  return slot;
}

/* 新建或覆盖一个存档槽（落 IndexedDB）。 */
export async function saveSlot(id: string | null, name: string, messages: any[], includeImages = true): Promise<string> {
  const slot = await buildSlot(id, name, messages, includeImages);
  await saveDb.put(slot);
  return slot.id;
}

/* 「立即备份到本地文件夹」：把当前整局（含图）写成带时间戳的 .json 到用户选定的真实磁盘文件夹。
   文件在磁盘上 → 不受浏览器对 IndexedDB 的整源淘汰影响，是抗「存档被清」的根治备份。返回写出的文件名。 */
export async function backupCurrentToFolder(messages: any[]): Promise<string> {
  const now = Date.now();
  const stamp = new Date(now).toLocaleString('sv-SE').replace(/[: ]/g, '-');   // 形如 2026-06-24-12-30-00
  const slot = await buildSlot(`slot_${now}`, `📁 文件夹备份 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`, messages, true);
  const file = `主神空间-存档-${stamp}.json`;
  await fbWriteFile(file, JSON.stringify(slot));
  return file;
}

/* ── 自动存档：每回合结束覆盖同一个固定槽 ── */
export const AUTOSAVE_ID = 'autosave';
/* ── 回退点：每次发送前覆盖此槽，记录"上一回合结束时"的完整状态（所有演化+对话+图），供回退/重新生成 ── */
export const UNDO_ID = 'undo-point';
/* ── 滚动自动备份：每回合多留一份**轻量(不含图片)**快照，仅保最近 N 份 ──
   防"单一 autosave 被坏状态一次覆盖光、没有后悔药"。不含图片(图片同设备由 imageDb 现存回填)，
   故体积远小于带图 autosave，可放心多留几份；可在存档面板直接「读取」回滚或「提主角」抽回。 */
export const AUTOSNAP_PREFIX = 'autosnap_';
export const AUTOSNAP_KEEP = 15;   // 滚动备份保留份数（每份不含图、很小，可放心多留；调此一处即可，UI 文案引用本常量自动同步）
export async function autoSaveSlot(messages: any[]): Promise<void> {
  // 自动存档**不含图片**：图片同设备由 imageDb 现存回填(读档不带图则不动 imageDb)，自动档每回合带图会膨胀到几十 MB×多档→撑爆内存。
  // 跨设备/备份用「手动新建存档」(仍带图)。
  try { await saveSlot(AUTOSAVE_ID, '⏱ 自动存档', messages, false); } catch (e) { console.warn('[Save] 自动存档失败:', e); }
  // 滚动备份(轻量·不含图)：留最近 N 份，超出删最旧。
  // 裁剪只读**主键**(saveDb.keys，零数据加载)——绝不能用 all() 逐回合把所有大存档载入内存(那正是页面崩溃的元凶)。
  try {
    const now = Date.now();
    await saveSlot(`${AUTOSNAP_PREFIX}${now}`, `🛟 自动备份 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`, messages, false);
    const snapKeys = ((await saveDb.keys()) as IDBValidKey[])
      .filter((k): k is string => typeof k === 'string' && k.startsWith(AUTOSNAP_PREFIX))
      .sort();   // 键 = autosnap_<13位时间戳>，等长→字符串序即时间序(升序：旧→新)
    for (const old of snapKeys.slice(0, Math.max(0, snapKeys.length - AUTOSNAP_KEEP))) { try { await saveDb.del(old); } catch { /* 删旧备份失败忽略 */ } }
  } catch (e) { console.warn('[Save] 滚动备份失败:', e); }
  // 本地文件夹自动备份（电脑·已选文件夹+已开启+已授权时）：把本回合状态(不含图、小)写到真实磁盘文件，抗浏览器整源淘汰。
  // 不在用户手势内 → 只用已 granted 的权限；prompt/denied 一律跳过（面板里引导用户点一下重新授权）。
  try {
    if (isFolderBackupSupported() && (await folderAutoEnabled()) && (await fbCheckPermission(false)) === 'granted') {
      const slot = await buildSlot(AUTOSAVE_ID, '⏱ 自动存档', messages, false);
      await fbWriteFile(FOLDER_AUTOSAVE_FILE, JSON.stringify(slot));
    }
  } catch (e) { logWarn('autoSaveSlot.folder', e); }
  // 主角镜像兜底(随回合更新；仅 B1 非空时写)
  try { writeB1Mirror(); } catch { /* */ }
}

/* 立即把当前实时状态刷进「⏱ 自动存档」槽——供**回合外**改动（邀请助战 / 召唤纪念英灵 / 遣散等）后调用。
   根因：per-turn 自动存档只在「AI 回合结束(新 assistant 楼层)」后触发；而这些改动发生在回合之间，只写进了 live
   store/localStorage，没刷新自动档。于是「刷新→继续(读自动档)」会回到改动前——表现为"助战的人刷新就不见了"。
   轻量(不含图)、覆盖同一槽、尊重「自动存档」总开关（关了就不写，交给用户手动存档）。失败静默。 */
export async function bumpAutoSave(): Promise<void> {
  try {
    if (useSettings.getState().autoSaveEnabled === false) return;
    const msgs = await loadChat().catch(() => []);
    await saveSlot(AUTOSAVE_ID, '⏱ 自动存档', msgs, false);
  } catch (e) { logWarn('bumpAutoSave', e); }
}

export async function hasUndoPoint(): Promise<boolean> {
  return !!(await saveDb.get<SaveSlot>(UNDO_ID));
}
/* 回退点是否**有真实对话**——回退/重生按钮该不该亮、回退动作该不该执行都看这个：
   空回退点(开局/进入世界时所记，或旧版遗留)一旦载入会把聊天清成空白，故空的一律当"无回退点"。*/
export async function undoPointHasChat(): Promise<boolean> {
  const s = await saveDb.get<SaveSlot>(UNDO_ID);
  return !!(s?.data?.messages && s.data.messages.length > 0);
}

export async function listSlots(): Promise<SlotMeta[]> {
  // 用 allMeta(游标逐条剥 data)而非 all()——后者会把所有存档(各可能几十 MB 含图)一次性载入内存，多档时直接崩溃。
  const metas = await saveDb.allMeta<SlotMeta>();
  return metas
    // 主列表只放：手动存档 + 单一自动存档(⏱)。回退点、滚动备份(🛟)都不混进来——后者另列在「自动备份」折叠区，避免一堆刷屏。
    .filter((s) => s.id !== UNDO_ID && !(typeof s.id === 'string' && s.id.startsWith(AUTOSNAP_PREFIX)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/* 滚动自动备份(🛟)单独列出——供存档面板「自动备份」折叠区显示/回滚，不占主列表。*/
export async function listAutoSnaps(): Promise<SlotMeta[]> {
  const metas = await saveDb.allMeta<SlotMeta>();
  return metas
    .filter((s) => typeof s.id === 'string' && s.id.startsWith(AUTOSNAP_PREFIX))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const PENDING_STARTED_KEY = 'drpg-pending-started';

/* 读档时保留「当前」的设备级配置，不被存档里的旧配置覆盖——这些属全局设置，不该绑定到具体存档：
   - API（键名含 "api"：api/textApi/各功能*Api/apiLibrary/apiRoutes/*UseSharedApi）；
   - 演化等功能的 settings（enabled 总开关 / 预设 entries / 调度 scheduling…）——和「新游戏不清这些 store」同口径，
     否则读档/回退/重新生成/续档会把存档里(常为关闭的旧)演化开关写回来，玩家刚开的「主角/物品/NPC/领地…演化」一走剧情就被关掉(本次修复)。
   做法：每个 store 的持久化 JSON，state 里命中的键用「当前值」覆盖存档值。*/
function mergeKeepApi(key: string, savedJson: string): string {
  try {
    // 兼容压缩存的 store（如 drpg-misc·lzStorage）：存/取都可能是 LZ 压缩串，先解成明文 JSON 再合并，
    //   合并后按**存档值原本的格式**回写（压缩存回压缩）——否则解析失败会走 catch 原样返回、丢掉"保当前 API"的意义（miscApi 被读档回滚）。
    const curPlain = decompressMaybe(localStorage.getItem(key));
    const savedPlain = decompressMaybe(savedJson);
    if (!curPlain || savedPlain == null) return savedJson;
    const sv = JSON.parse(savedPlain), cv = JSON.parse(curPlain);
    if (sv && cv && sv.state && cv.state) {
      for (const k of Object.keys(cv.state)) if (/api/i.test(k) || k === 'settings') sv.state[k] = cv.state[k];
      const merged = JSON.stringify(sv);
      return isCompressed(savedJson) ? compressWithMark(merged) : merged;
    }
  } catch (e) { logWarn('saveManager.mergeKeepApi', e); }
  return savedJson;
}

/* 给定某份 autosnap 的 id，取**上一份**(时间戳更早一份) autosnap 的完整槽——它=上一回合结束态，
   读某份 autosnap 后拿它当回退点，即可「回退上一回合 / 重新生成」本回合。复用已有滚动快照·零额外体积。
   已是最旧一份 / 找不到 → null（无更早状态可回退）。 */
async function prevAutosnapSlot(curId: string): Promise<SaveSlot | null> {
  try {
    const keys = ((await saveDb.keys()) as IDBValidKey[])
      .filter((k): k is string => typeof k === 'string' && k.startsWith(AUTOSNAP_PREFIX))
      .sort();   // 键=autosnap_<13位时间戳>·等长→字符串序即时间序（升序：旧→新）
    const idx = keys.indexOf(curId);
    if (idx <= 0) return null;   // 没找到 或 已是最旧一份 → 无更早快照
    return (await saveDb.get<SaveSlot>(keys[idx - 1])) ?? null;
  } catch { return null; }
}

/* 读取存档：把快照写回 localStorage，对话历史写回 IndexedDB（chatDb），整页 reload。
   reload 让 zustand persist 各 store 与 gameStore（模块初始化时读 localStorage）一并恢复；
   对话历史由 App 挂载时从 chatDb 读回。这是混合持久化下最稳的方案。*/
export async function loadSlot(id: string): Promise<boolean> {
  const slot = await saveDb.get<SaveSlot>(id);
  if (!slot) return false;
  // ★合并写盘挂起：先把排程中的写 flush（下方 mergeKeepApi / KEEP_CURRENT 读到的才是最新配置），
  //   随后到 reload 前**丢弃**一切新的 persist 写——否则后台演化阶段的 300ms 延迟写会落在
  //   restoreStores() 与 reload 之间，绕过下面苦心维持的「零 async 窗口」保证、把快照又盖回去。
  suspendPersistWrites();
  // 读档时 store 写回策略：
  // - 快照里有 → 写回（API 字段保当前）。
  // - 快照里没有 → **只清【较新功能的进度缓存】**（防上一局的 潜能点/筹码/深渊进度 等泄漏进读入的旧档）；
  //   **核心存档（主角技能/天赋/副职业·背包·NPC·主角档案·HP/EP 等）绝不因快照缺失而清空**——
  //   否则读个缺这些键的旧档/回退点就会把当前的技能天赋副职业全抹掉（"读档后技能丢失"的根因，已修）。
  const CLEAR_ON_MISSING = new Set(['drpg-skilltree', 'drpg-subproftree', 'drpg-casino', 'drpg-abyss', 'drpg-world-codex', 'drpg-tables', 'drpg-table-journal', 'drpg-wallet', 'drpg-items-core', 'drpg-npc-core', 'drpg-trade-escrow', 'drpg-trade-coin-escrow', 'drpg-equipsets']);
  // 设备级全局配置：读档一律保留【当前】值、绝不回滚到存档快照。否则读个旧档/回退点，就会把
  // 「剧情指导」等功能开关、人称、记忆/向量配置等全冲回存档当时的旧值——这正是「开启剧情指导后
  // 一刷新/读档又关闭」的根因（2026-06-20 修）。API 字段原本已由 mergeKeepApi 保当前，这里把整个
  // settings store 统一归为全局配置，不随存档回滚（配置与具体存档解绑，全局一致）。
  const KEEP_CURRENT = new Set(['drpg-settings']);
  // ★store 快照写回 localStorage 见下方 restoreStores()——**故意放到所有 await 之后、reload 之前执行**。
  const restoreStores = () => {
    for (const { key } of STORES) {
      if (KEEP_CURRENT.has(key)) continue;   // 全局配置：保留当前，不被存档快照覆盖
      const v = slot.data.stores[key];
      if (typeof v === 'string') localStorage.setItem(key, mergeKeepApi(key, v));   // API 配置不随存档回滚
      else if (CLEAR_ON_MISSING.has(key)) localStorage.removeItem(key);             // 仅较新功能缓存缺失才清（防泄漏）；核心存档一律保留当前，绝不抹
    }
  };
  // 图片：覆盖 IndexedDB（reload 后由 hydrateImages 回填到各 store）。
  // 仅当快照带了图片才清+写；不带图片的快照（如降级保存的回退点）保留现有图片，避免回退把图全清掉。
  try { if (slot.data.images) { await clearAllImg(); await bulkPutImg(slot.data.images); } } catch (e) { logWarn('saveManager.loadSlot.images', e); }
  await replaceChat(slot.data.messages ?? []);   // 覆盖当前对话为存档对话
  // 过往世界正文归档：仅当该档**带了**归档才还原（手动档带）；自动档/回退点/旧档不带 → 保留当前全局归档不动
  // （同一时间线本就正确，不会因读个不带归档的回退点而把过往世界从导出里抹掉）。
  if (slot.data.narrativeArchive !== undefined) {
    try { await replaceArchive(slot.data.narrativeArchive); } catch (e) { logWarn('saveManager.loadSlot.archive', e); }
  }
  // 回退点与时间线绑定：读「用户存档」时——
  //  · 若该档随身带了**属于它自己时间线**的回退点(slot.data.undo，存档时嵌入=该档上一回合结束态)，
  //    就把它还原成回退点 → 读档后可立刻「回退上一回合 / 重新生成」本档的上一回合（本次修复）。
  //  · 旧档无嵌入回退点 → 删掉旧回退点；否则会留下读档前那条时间线的回退点，回退会乱跳到别的时间线。
  // 注意：回退/重新生成自身也走 loadSlot(UNDO_ID)，那种情况 id===UNDO_ID，不动回退点（否则连续回退失效）。
  if (id !== UNDO_ID) {
    try {
      if (slot.data.undo && slot.data.undo.messages && slot.data.undo.messages.length > 0) {
        const u = slot.data.undo;   // 手动档/⏱自动存档：随身嵌了回退点 → 直接还原（仅有真实对话的·空的不还原防回退清屏）
        await saveDb.put({ ...slot, id: UNDO_ID, name: '↩ 回退点', data: { stores: u.stores, messages: u.messages } });
      } else if (id.startsWith(AUTOSNAP_PREFIX)) {
        // 🛟自动备份(autosnap)按设计不嵌回退点(省体积)；读某份 autosnap 时，用**上一份 autosnap**(=上一回合结束态)当回退点，
        //   → 读自动备份后也能「回退上一回合 / 重新生成」本回合（用户报"读档了就不能回退"的根因）。最旧一份无更早快照 → 删回退点。
        const prev = await prevAutosnapSlot(id);
        if (prev?.data?.messages && prev.data.messages.length > 0) {
          await saveDb.put({ ...prev, id: UNDO_ID, name: '↩ 回退点' });
        } else {
          await saveDb.del(UNDO_ID);
        }
      } else {
        await saveDb.del(UNDO_ID);   // 无嵌入回退点的其它档（旧档等）→ 删旧回退点，防回退乱跳到别的时间线
      }
    } catch (e) { logWarn('saveManager.loadSlot.undoRestore', e); }
  }
  // ★把 store 快照写回 localStorage 放到【所有 await 之后、reload 之前】的最后一刻——否则上面那几个 await
  //   （图片/对话/归档/回退点 的 IndexedDB 操作）期间，仍存活的 store（或此刻还在后台跑、刚发放奖励的**异步演化阶段**，
  //   如物品/结算阶段）会把【当前·未回退】的值 persist 覆盖掉刚写回的快照，reload 后就 hydrate 成没回退的旧值——
  //   这正是「⟳重新生成 不回退乐园币/物品数量、每 roll 一次奖励重复入账」的根因（live store 盖 localStorage）。
  //   放最后 = 写回与 reload 之间零 async 窗口，杜绝被盖。
  restoreStores();
  flagCoresReseed();   // 阶段1：reload 后清空事件核心 IDB、从恢复后的 store 重播影子基线（避读档/回退后旧核心 vs 新 store 假漂移·race-free）
  setResumeFlag(PENDING_STARTED_KEY);   // localStorage+TTL：跨 reload 稳定存活（手机/PWA 下 sessionStorage 会丢→读档弹回主界面）
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
): Promise<{ counts: { skills: number; traits: number; subProfessions: number; titles: number }; added: string[]; treeApplied: boolean } | null> {
  const slot = await saveDb.get<SaveSlot>(id);
  const raw = decompressMaybe(slot?.data?.stores?.['drpg-characters']);   // drpg-characters 现为 lz 压缩存
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

  // 技能树一并换成该存档的（用户选：提主角连树一起换旧档，使技能树点位与恢复的技能严格对应）。
  // 整体拷贝 progress.B1（不做字段级合并，零风险）；树定义并集（保留当前没有的，带回该档的）。
  let treeApplied = false;
  try {
    const treeRaw = slot?.data?.stores?.['drpg-skilltree'];
    const ts = treeRaw ? JSON.parse(treeRaw)?.state : null;
    const savedProg = ts?.progress?.B1;
    if (savedProg) {
      useSkillTree.setState((s: any) => ({
        progress: { ...s.progress, B1: savedProg },
        trees: { ...s.trees, ...(ts.trees || {}) },
      }));
      treeApplied = true;
    }
  } catch { /* 技能树非必需，失败不影响技能恢复 */ }

  return {
    counts: {
      skills: (mergedB1.skills || []).length,
      traits: (mergedB1.traits || []).length,
      subProfessions: (mergedB1.subProfessions || []).length,
      titles: (mergedB1.titles || []).length,
    },
    added,
    treeApplied,
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

/* 申请「持久化存储」(navigator.storage.persist)。
   根因：默认是 best-effort 存储，浏览器在磁盘/配额紧张时会把本源 IndexedDB **整体清空淘汰**——
   表现正是"手动存档过段时间消失、只剩每回合都会被重写重建的自动存档"（自动档清掉后下一回合又生成，手动档不会）。
   申请 persist 后浏览器不再随意淘汰本源数据。Chrome 按参与度/权限/是否安装等启发式决定是否授予；幂等、失败静默。
   返回是否处于持久化状态，供调用方提示用户（未授予时建议「加书签/常访问本站」以提高授予率）。*/
export async function requestPersistentStorage(): Promise<{ supported: boolean; persisted: boolean }> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) {
      return { supported: false, persisted: false };
    }
    if (navigator.storage.persisted && (await navigator.storage.persisted())) {
      return { supported: true, persisted: true };   // 已持久化，无需再申请
    }
    const granted = await navigator.storage.persist();
    let usage = '';
    try {
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.usage != null && est.quota) usage = `（已用 ${(est.usage / 1048576).toFixed(0)}MB / 配额 ${(est.quota / 1048576).toFixed(0)}MB）`;
      }
    } catch { /* */ }
    console.log(`[Save] 持久化存储：${granted ? '✓ 已授予，存档不再被浏览器随意淘汰' : '✗ 未授予——存储紧张时手动档可能被清理，建议给本站加书签/常访问以提高授予率'}${usage}`);
    return { supported: true, persisted: granted };
  } catch { return { supported: false, persisted: false }; }
}

/* 只读查询存储持久化状态 + IndexedDB 配额占用（**不发起申请**）——供存档面板/诊断包展示。
   让"存档随时可能被浏览器整批清掉"这件事对用户**可见**：persisted=false 即处于 best-effort，
   存储紧张时本源 IndexedDB（=全部存档）可能被整体淘汰（手动档先没→只剩自动档→最后全没的根因）。*/
export async function getStorageStatus(): Promise<{ supported: boolean; persisted: boolean; usageMB: number | null; quotaMB: number | null }> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return { supported: false, persisted: false, usageMB: null, quotaMB: null };
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    let usageMB: number | null = null, quotaMB: number | null = null;
    try {
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.usage != null) usageMB = Math.round(est.usage / 1048576);
        if (est.quota != null) quotaMB = Math.round(est.quota / 1048576);
      }
    } catch { /* estimate 不支持：忽略 */ }
    return { supported: !!navigator.storage.persist, persisted, usageMB, quotaMB };
  } catch { return { supported: false, persisted: false, usageMB: null, quotaMB: null }; }
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

/* 「上一局存档」：在 clearProgress（新游戏 / 开局角色创建）真正清空前，先把当前这局整存成一个带时间戳的
   手动档（slot_archive_ 前缀 → 不随以后的清空消失，正常显示在存档列表里），防误开新游戏把整局清光、没有后悔药。
   - 仅当存在真实进度时才存（全新空局不留垃圾档）；
   - 含图片=整局完整可恢复；含图失败(配额)则退化成不含图轻量档；
   - 只保留最近 ARCHIVE_KEEP 份，超出删旧。*/
export const ARCHIVE_PREFIX = 'slot_archive_';
export const ARCHIVE_KEEP = 3;
async function archivePreviousRun(): Promise<void> {
  // 是否有真实进度：主角有名 / B1 有技能 / 有 NPC / 回合数>0，任一成立即存；判定异常则保守存（宁可多留一份）。
  let hasProgress = true;
  try {
    const prof = usePlayer.getState().profile;
    const b1 = useCharacters.getState().characters?.['B1'] as any;
    const npcCount = Object.keys(useNpc.getState().npcs ?? {}).length;
    const turn = Number((useMisc.getState() as any).turnCount ?? 0);
    hasProgress = !!(prof?.name && prof.name.trim()) || ((b1?.skills?.length ?? 0) > 0) || npcCount > 0 || turn > 0;
  } catch (e) { logWarn('archivePreviousRun:detect', e); }
  if (!hasProgress) return;
  const now = Date.now();
  const id = `${ARCHIVE_PREFIX}${now}`;
  const name = `🗄 上一局存档 ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`;
  const msgs = await loadChat().catch(() => []);
  try {
    await saveSlot(id, name, msgs, true);            // 含图：整局完整可恢复
  } catch (e) {
    logWarn('archivePreviousRun:withImages', e);     // 含图可能撞 IndexedDB 配额 → 退化成轻量(无图)档，至少保住六维/技能/NPC/对话
    try { await saveSlot(id, `${name}（无图）`, msgs, false); } catch (e2) { logWarn('archivePreviousRun:noImages', e2); return; }
  }
  // 只保留最近 ARCHIVE_KEEP 份「上一局存档」，超出按时间删旧（键=slot_archive_<13位时间戳>，等长→字符串序即时间序）
  try {
    const keys = ((await saveDb.keys()) as IDBValidKey[])
      .filter((k): k is string => typeof k === 'string' && k.startsWith(ARCHIVE_PREFIX))
      .sort();
    for (const old of keys.slice(0, Math.max(0, keys.length - ARCHIVE_KEEP))) { try { await saveDb.del(old); } catch { /* */ } }
  } catch (e) { logWarn('archivePreviousRun:prune', e); }
}

/* 新游戏：清空全部「游戏进度」（角色/NPC/物品/对话/任务/世界状态），
   保留「配置」（API / 世界书 / 预设 / 调度 / 提示词等）。完成后整页 reload 回到封面。*/
/** 清空全部游戏进度（不 reload），保留配置（API/世界书/预设等）。
 *  供「新游戏」与「开局角色创建」复用——后者清完再写入新角色。 */
export async function clearProgress(): Promise<void> {
  // 防误清：真正清空前，先把当前这局整存成「上一局存档」(手动档,不随以后清空消失)——哪怕误开新游戏也能捞回整局。
  try { await archivePreviousRun(); } catch (e) { logWarn('clearProgress:archive', e); }
  // 各「进度」store 清空 → 从单一注册表 STORES 派生（带 clear 的才清；config/预设 store 无 clear 故自动保留）。
  // 「保存」与「清空」共用同一份 STORES，加新 store 只改一处，杜绝两份清单漂移。
  for (const s of STORES) {
    if (s.clear) { try { s.clear(); } catch (e) { logWarn(`clearProgress:${s.key}`, e); } }
  }
  // 不入存档快照 / 走 IndexedDB 的额外清理：
  try { clearJoySessions(); } catch (e) { logWarn('clearProgress:joy', e); }      // 欢愉宫情欲值/私密/聊天（独立 store，不入快照；保留名册/预设/API）
  try { useDbAdvance.getState().clearRuntime(); } catch (e) { logWarn('clearProgress:dbadvance', e); }   // 数据库推进桌面态现已持久化：新游戏须清运行态（保留预设/开关），否则新档带着上一局的表
  try { await clearAllImg(); } catch (e) { logWarn('clearProgress:images', e); }  // IndexedDB 头像/装备图
  try { await resetEventCoresIdb(); } catch (e) { logWarn('clearProgress:cores', e); }   // 阶段1：清空事件核心 IDB（NPC/物品/货币影子账本·搬去 IndexedDB 后）
  // 注：不在此清向量库（drpg-factvec）——它是全局内容寻址缓存，清了会误伤其它存档的向量索引；
  // 残留向量不会污染任何档（召回只在当前档事实池内 cosine）。想回收空间用设置→向量记忆的「清空向量库」按钮。
  await replaceChat([]);           // 对话历史
  try { await clearArchive(); } catch (e) { logWarn('clearProgress:archive', e); }   // 正文归档：新游戏清掉上一局过往世界（archivePreviousRun 已先把整局含归档存成「上一局存档」兜底）
  try { clearB1Mirror(); } catch (e) { logWarn('clearProgress:b1mirror', e); }   // 主角镜像兜底：新游戏清掉，避免误把上一局主角补进空白新档
  // 滚动自动备份：新游戏清掉上一局的所有轻量备份（属"进度"，不该带进新局）。只读主键、不载入数据。
  try {
    const snapKeys = ((await saveDb.keys()) as IDBValidKey[]).filter((k): k is string => typeof k === 'string' && k.startsWith(AUTOSNAP_PREFIX));
    for (const k of snapKeys) { try { await saveDb.del(k); } catch { /* */ } }
  } catch (e) { logWarn('clearProgress:autosnap', e); }
  // 删除上一局的内部「回退点」固定槽：否则新开局第一回合失败后点「重新生成/回退」，
  // 会载入仍残留的上一局回退点 → 瞬间跳回另一局的中断处重发。
  // UNDO_ID 是内部槽（不在存档列表显示、非用户命名存档），删它不影响任何旧存档；
  // 新局的开局建档/首次发送会通过 captureUndoPoint 重建一个属于本局的回退点。
  try { await saveDb.del(UNDO_ID); } catch (e) { logWarn('clearProgress', e); }
  // 合并写盘：上面各 store clear() 的「空状态」写还在 300ms 排程里——立即落盘，
  // 确保紧随其后的 reload（newGame）后不会 hydrate 回旧进度。
  flushPersistWrites();
}

export async function newGame(): Promise<void> {
  await clearProgress();
  flagCoresReseed();   // 阶段1：即便上面 coreKvDel 未落定，reload 后 preloadEventCores 也会再清一次事件核心
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
