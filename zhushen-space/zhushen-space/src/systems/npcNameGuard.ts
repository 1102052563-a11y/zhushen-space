// NPC 名字守卫（约束生成试点·治重名/ghost）
// ───────────────────────────────────────────────────────────────────────────
// Waidrin lib/engine.ts:187 用 `z.enum(现有角色名)` 让模型引用角色时物理上编不出新名字（引用完整性）。
// 本项目复刻：本回合正文若冒出一个「新 NPC」，用**动态 enum（现有在场 NPC 名 + __NEW__）**约束模型裁决
// ——它到底是某个现有 NPC 的别名/绰号/错字/音译差异，还是真新人。判为别名 → 改名到规范名 → 复用现成
// `dedupeByName`（留信息最全的、并入其余·装备/唯一物不误吞）完成合并。直击 [[evolution-store-name-and-ghost-bugs]]。
//
// 纯附加、失败静默：任何异常都不改变主 NPC 演化结果；未配接口/无现有在场 NPC/无新 NPC 时直接 0 开销返回。

import type { ApiConfig } from '../store/settingsStore';
import { useNpc, hasRealNpcName, type NpcRecord } from '../store/npcStore';
import { apiChatObject, type JsonSchema } from './apiObject';

export interface AliasDecision {
  canonical: string;                 // 现有名字 或 "__NEW__"
  confidence: 'high' | 'low';
}

const NEW = '__NEW__';
const MAX_ENUM = 40;   // enum 名单上限（token/schema 体量护栏）
const MAX_FRESH = 6;   // 单回合最多裁决几个新 NPC（防异常回合刷爆调用）

// ── 纯逻辑：动态 enum schema（现有名 + 哨兵）──
export function buildAliasSchema(existingNames: string[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      canonical: { type: 'string', enum: [...existingNames.slice(0, MAX_ENUM), NEW] },
      confidence: { type: 'string', enum: ['high', 'low'] },
    },
    required: ['canonical', 'confidence'],
    additionalProperties: false,
  };
}

// ── 纯逻辑：裁决 → 该并入的规范名（否则 null）。双保险：只有「现有名 + high 把握」才动手 ──
export function shouldMerge(
  d: { canonical?: string; confidence?: string } | null | undefined,
  existingNames: string[],
): string | null {
  if (!d || !d.canonical || d.canonical === NEW) return null;
  if (d.confidence !== 'high') return null;
  if (!existingNames.includes(d.canonical)) return null;   // 模型即便越界也不误 merge
  return d.canonical;
}

function aliasQuestion(npc: NpcRecord, existing: string[], narrativeTail: string): string {
  return (
    `本回合正文出现一个 NPC：「${npc.name}」（阶位：${npc.realm || '未知'}；性格：${npc.personality || '未知'}；` +
    `背景：${(npc.background || '未知').slice(0, 120)}）。\n` +
    `现有在场 NPC 名单：${existing.join('、')}。\n` +
    (narrativeTail ? `本回合正文片段（供判断）：\n${narrativeTail}\n` : '') +
    `判断「${npc.name}」是否其实就是名单里某个现有 NPC（别名/绰号/错字/音译差异/换了称呼的同一人），还是真正的新角色。\n` +
    `是现有某人 → canonical 填那个现有名字；确是新人 → canonical 填 "${NEW}"。` +
    `仅在**非常确定是同一人**时把 confidence 填 high，稍有不确定就填 low。`
  );
}

/** 对本回合新出现的 NPC 逐个做别名裁决，命中则改名并入现有档。返回合并掉的数量。
 *  @param chain      resolveApiChain('npc', ...) 得到的接口链
 *  @param beforeIds  AI 演化「之前」已存在的 NPC id 集合（用于识别本回合新建的）
 *  @param onSceneNames 演化之前在场的真实 NPC 名（enum 基准 = 模型能引用的名单）
 *  @param narrativeTail 本回合正文尾段（判断上下文，调用方自行裁剪长度） */
export async function reconcileNewNpcNames(
  chain: ApiConfig[],
  beforeIds: Set<string>,
  onSceneNames: string[],
  narrativeTail = '',
): Promise<number> {
  if (!chain?.[0]?.baseUrl || !chain[0]?.apiKey) return 0;
  const existing = Array.from(new Set(onSceneNames.filter(Boolean)));
  if (existing.length === 0) return 0;

  const fresh = (Object.values(useNpc.getState().npcs) as NpcRecord[])
    .filter((r) => !beforeIds.has(r.id) && !r.isDead && hasRealNpcName(r) && !existing.includes(r.name))
    .slice(0, MAX_FRESH);
  if (fresh.length === 0) return 0;

  const schema = buildAliasSchema(existing);
  let renamed = 0;
  for (const npc of fresh) {
    try {
      const d = await apiChatObject<AliasDecision>(
        chain,
        [{ role: 'user', content: aliasQuestion(npc, existing, narrativeTail) }],
        schema,
        { label: 'npcAliasGuard', timeoutMs: 45000 },
      );
      const target = shouldMerge(d, existing);
      if (target) {
        useNpc.getState().upsertNpc(npc.id, { name: target });   // 改名到规范名（upsertNpc 内 resolveNpcName 放行真实名）
        console.warn(`[NPC名字守卫] 「${npc.name}」判定为现有「${target}」的别名 → 改名并入`);
        renamed++;
      }
    } catch (e) {
      console.warn('[NPC名字守卫] 单个裁决失败，跳过', npc.name, e);
    }
  }
  // 改了名 → 复用现成谨慎去重完成合并（留信息最全者，装备/唯一物不误吞）
  if (renamed) { try { const m = useNpc.getState().dedupeByName(); return m || renamed; } catch { return renamed; } }
  return 0;
}
