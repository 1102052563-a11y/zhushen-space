/*
  驱动力校验 / 静滞判定（v5.6 世界引擎 stage2 Step 3.4 的轮回乐园实装）
  ──────────────────────────────────────────────────────────────────────
  卡里的原则：**离场角色不是默认都要推演**——必须至少满足一项「行动驱动力」，
  否则判定为【静滞】，本轮不做后台记录演化。这是一道纯粹的**省 token 闸门**。

  前端现状：`computeFocusList` 按"在场 / 好友轮换 / 离场配额"选人，缺的正是
  「这人本轮根本没理由动」这一层否决——于是每回合都在给一堆与当前剧情毫无关系的
  NPC 烧演化 API。

  轮回乐园特化（按 npcTag 分流，见 docs/WORLD_ENGINE_LUNHUI_ADAPT.md §3③）：
    · 随从/宠物/召唤物 → 恒有驱动力（人就在主角身边）
    · 契约者          → 羁绊 / 任务 / 局势 / 社交（好友·同团·宿敌）
    · 土著            → 只有 羁绊 / 任务 / 局势，否则交给轨道A 零 API 自治
    · 已冻结(frozenAt) → 恒静滞（主角早已离开那个世界）

  ⚠ 静滞 ≠ 冻结 ≠ 归档：
    静滞只是"本轮不花 API 演化"，他**仍然**跑轨道A 自治、仍会被召回、随时可能恢复驱动力。
    纯函数 + ctx 显式传入，便于单测；读 store 的薄封装在 `driveCtxFromStores`。
*/
import type { NpcRecord } from '../store/npcStore';

export type DriveReason = 'scene' | 'bond' | 'quest' | 'world' | 'social' | null;

export const DRIVE_LABEL: Record<Exclude<DriveReason, null>, string> = {
  scene: '在场',
  bond: '羁绊',
  quest: '任务',
  world: '局势',
  social: '社交',
};

/** UI 角标：静滞用 ⏸，其余各给一个一眼可辨的字形 */
export const DRIVE_ICON: Record<Exclude<DriveReason, null>, string> = {
  scene: '🎬', bond: '🔗', quest: '🎯', world: '🌍', social: '👥',
};

export interface DriveCtx {
  /** 任务面板里的文本（名称 + 描述 + 各环目标拼起来即可） */
  questText: string;
  /** 近期世界大事文本（只取当前世界的·调用方负责过滤） */
  worldText: string;
  /** 最近正文（用于"这人刚被提到"的局势关联） */
  narrative: string;
}

export const EMPTY_DRIVE_CTX: DriveCtx = { questText: '', worldText: '', narrative: '' };

/* 名字命中：≥2 字才算（单字名会把"王""李"这类误命中满天飞）。
   NPC 名可能带后缀（"凌薇|队长"），只取 '|' 前的主名。 */
function mentions(haystack: string, name?: string): boolean {
  const n = String(name ?? '').split('|')[0].trim();
  if (n.length < 2) return false;
  return haystack.includes(n);
}

/**
 * 判定某 NPC 本轮的行动驱动力；返回 null = 【静滞】（本轮不值得花 API 演化）。
 * 命中即返回，优先级：在场 > 羁绊 > 任务 > 局势 > 社交。
 */
export function driveOf(npc: NpcRecord, ctx: DriveCtx): DriveReason {
  if (npc.frozenAt) return null;                     // 🧊 已离开那个世界 → 恒静滞
  if (npc.archived) return null;                     // 玩家封存
  if (npc.onScene) return 'scene';                   // 人就在眼前，必演化

  const tag = npc.npcTag;
  if (tag === '随从' || tag === '宠物' || tag === '召唤物') return 'bond';   // 跟着主角走

  // A 命定羁绊：玩家显式投入过的角色
  if (npc.isBond || npc.keepForever || npc.isFriend || npc.partyMember || npc.isCanonLocked) return 'bond';

  // B 剧情关联：名字出现在任务面板
  if (mentions(ctx.questText, npc.name)) return 'quest';

  // C 局势关联：名字出现在近期世界大事，或刚在正文里被提到
  if (mentions(ctx.worldText, npc.name) || mentions(ctx.narrative, npc.name)) return 'world';

  // D 社交（仅契约者）：竞技场/宿敌/同团等乐园侧关系网——土著没有这一层
  if (tag !== '土著') {
    if (npc.arenaRank || npc.affiliatedTeam) return 'social';
  }

  return null;   // 【静滞】
}

/** 便捷判定：本轮是否静滞 */
export function isStatic(npc: NpcRecord, ctx: DriveCtx): boolean {
  return driveOf(npc, ctx) === null;
}

/**
 * 按驱动力筛一批候选 NPC，并给出被拦下的名单（供日志/面板可见化）。
 * `cap` = 卡里的「自动化系统筛选人数」上限（默认 15），按优先级截断。
 */
export function filterByDrive(
  list: NpcRecord[],
  ctx: DriveCtx,
  cap = 15,
): { passed: NpcRecord[]; staticIds: string[] } {
  const ORDER: Record<Exclude<DriveReason, null>, number> = { scene: 0, bond: 1, quest: 2, world: 3, social: 4 };
  const scored: { n: NpcRecord; rank: number }[] = [];
  const staticIds: string[] = [];
  for (const n of list) {
    const d = driveOf(n, ctx);
    if (d == null) { staticIds.push(n.id); continue; }
    scored.push({ n, rank: ORDER[d] });
  }
  scored.sort((a, b) => a.rank - b.rank);
  return { passed: scored.slice(0, Math.max(0, cap)).map((x) => x.n), staticIds };
}
