import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useFaction } from '../store/factionStore';
import { useMisc } from '../store/miscStore';
import type { MpTurn } from '../store/multiplayerStore';

// 联机·快照与多人回合拼装。
// MVP 设计：共享的是「正文」（房主权威，算完广播）；各玩家自己的角色状态留在本地，提交行动时附带一张精简卡。

// 我的角色卡（队伍面板展示 + 房主拼进提示词作参考）
export function buildPlayerSnapshot() {
  try {
    const p: any = usePlayer.getState().profile || {};
    const a = p.attrs || {};
    const stat = `力${a.str ?? '?'} 敏${a.agi ?? '?'} 体${a.con ?? '?'} 智${a.int ?? '?'} 魅${a.cha ?? '?'} 幸${a.luck ?? '?'}`;
    const head = [p.tier, p.profession].filter(Boolean).join('·');
    return {
      name: p.name || '',
      tier: p.tier || '',
      profession: p.profession || '',
      attrs: a,
      line: [head, stat].filter(Boolean).join(' '),
    };
  } catch {
    return { name: '', line: '' };
  }
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
  const lines: string[] = [];
  const ht = (hostText || '').trim();
  if (ht) lines.push(`- ${hostName || '房主'}（房主）：${ht}`);
  for (const v of Object.values(inputs || {})) {
    const t = (v?.text || '').trim();
    if (t) lines.push(`- ${v.name || '队友'}：${t}`);
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
  worldBackup = null;
}
