// 通用「别名守卫」核心（约束生成·引用完整性）
// ───────────────────────────────────────────────────────────────────────────
// Waidrin lib/engine.ts:187 用 `z.enum(现有实体名)` 让模型引用时物理上编不出新名字。本项目复刻并抽成通用核心：
// 本回合正文若冒出一个「新实体」，用**动态 enum（现有名 + __NEW__）**约束模型裁决它是不是某现有实体的别名/错字。
// NPC / 势力 / …各域只需提供：现有名单、本回合新建实体、如何描述、命中别名怎么合并。软路径(schema进提示词+抽取+校验+重试)由 apiObject 保证。

import type { ApiConfig } from '../store/settingsStore';
import { apiChatObject, type JsonSchema } from './apiObject';

export const ALIAS_NEW = '__NEW__';
const MAX_ENUM = 40;   // enum 名单上限（token/schema 体量护栏）
const MAX_FRESH = 6;   // 单回合最多裁决几个新实体（防异常回合刷爆调用）

export interface AliasDecision {
  canonical: string;                 // 现有名字 或 __NEW__
  confidence: 'high' | 'low';
}

// ── 纯逻辑：动态 enum schema（现有名 + 哨兵）──
export function buildAliasSchema(existingNames: string[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      canonical: { type: 'string', enum: [...existingNames.slice(0, MAX_ENUM), ALIAS_NEW] },
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
  if (!d || !d.canonical || d.canonical === ALIAS_NEW) return null;
  if (d.confidence !== 'high') return null;
  if (!existingNames.includes(d.canonical)) return null;   // 模型即便越界也不误 merge
  return d.canonical;
}

function aliasQuestion(kind: string, desc: string, existing: string[], narrativeTail: string): string {
  return (
    `本回合正文出现一个${kind}：${desc}。\n` +
    `现有${kind}名单：${existing.join('、')}。\n` +
    (narrativeTail ? `本回合正文片段（供判断）：\n${narrativeTail}\n` : '') +
    `判断它是否其实就是名单里某个现有${kind}（别名/绰号/错字/音译差异/换了称呼的同一个），还是真正的新${kind}。\n` +
    `是现有某个 → canonical 填那个现有名字；确是新的 → canonical 填 "${ALIAS_NEW}"。` +
    `仅在**非常确定是同一个**时把 confidence 填 high，稍有不确定就填 low。`
  );
}

export interface AliasGuardSpec<E> {
  chain: ApiConfig[];
  kind: string;                                   // 'NPC' / '势力' —— 进提示词
  existingNames: string[];                        // enum 基准（模型能引用的名单）
  fresh: E[];                                     // 本回合新建的实体（调用方已过滤）
  describe: (e: E) => string;                     // 给模型判断的实体描述
  onAlias: (freshEntity: E, canonical: string) => void;  // 命中别名时的合并动作
  finalize?: () => number;                        // 收尾（如 dedupe），返回合并数覆盖命中数
  narrativeTail?: string;
  label?: string;
}

/** 逐个对新实体做别名裁决，命中则执行合并。返回合并/命中数量。纯附加、失败静默。 */
export async function runAliasGuard<E>(spec: AliasGuardSpec<E>): Promise<number> {
  if (!spec.chain?.[0]?.baseUrl || !spec.chain[0]?.apiKey) return 0;
  const existing = Array.from(new Set(spec.existingNames.filter(Boolean)));
  if (existing.length === 0) return 0;
  const fresh = spec.fresh.slice(0, MAX_FRESH);
  if (fresh.length === 0) return 0;

  const schema = buildAliasSchema(existing);
  let hits = 0;
  for (const e of fresh) {
    try {
      const d = await apiChatObject<AliasDecision>(
        spec.chain,
        [{ role: 'user', content: aliasQuestion(spec.kind, spec.describe(e), existing, spec.narrativeTail || '') }],
        schema,
        { label: spec.label || 'aliasGuard', timeoutMs: 45000 },
      );
      const target = shouldMerge(d, existing);
      if (target) { spec.onAlias(e, target); hits++; }
    } catch (err) {
      console.warn(`[别名守卫·${spec.kind}] 单条裁决失败，跳过`, err);
    }
  }
  if (hits && spec.finalize) { try { return spec.finalize() || hits; } catch { return hits; } }
  return hits;
}
