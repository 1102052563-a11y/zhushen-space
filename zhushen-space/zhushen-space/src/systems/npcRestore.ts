/* ════════════════════════════════════════════
   NPC 图书馆 · 找回（systems/npcRestore.ts）
   A. restoreSnapshot —— 确定性还原：把快照原样写回 store（档案 + 技能/天赋/称号/副职业/记忆 + 头像）。
      若当前已有同名档案 → 交给 npcStore 的同名合并（丰满的当留存者、经历并集、关系数值取大值）。
   B. aiSyncSnapshot  —— AI 提取同步：把「老快照」+「当前那份档案」+「最近正文」喂给 AI，
      让它判断该把哪些信息同步回来，输出字段更新。用于"当前是 AI 新建的空壳，想把老感情线融回去"。
   ⚠ 独立模块：npcStore → npcLibrary（入库），本模块 → npcStore + npcLibrary（找回），无循环依赖。
════════════════════════════════════════════ */
import { useNpc, type NpcRecord } from '../store/npcStore';
import { useCharacters } from '../store/characterStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';
import type { NpcSnapshot } from './npcLibrary';

/** 分配一个空闲 C 编号 */
function freeNpcId(used: Set<string>): string {
  let n = 1;
  while (used.has(`C${n}`)) n++;
  return `C${n}`;
}

/** A · 确定性还原：快照 → store。返回落地的 id。
    - 原 id 空着 → 用回原 id（别的 NPC 关系里 "C3:恋人" 这类引用才不会断）
    - 原 id 被占 → 分配空闲 C 编号；若与现有档案同名，facade 闸门会自动合并（丰满的赢）
    - archived 一律清掉：找回＝重新纳入编制，之后玩家可自行再归档 */
export function restoreSnapshot(snap: NpcSnapshot): { ok: boolean; id: string; msg: string } {
  try {
    if (!snap?.record?.id) return { ok: false, id: '', msg: '快照损坏（无档案数据）' };
    const npcs = useNpc.getState().npcs;
    const id = npcs[snap.npcId] ? freeNpcId(new Set(Object.keys(npcs))) : snap.npcId;
    const rec: NpcRecord = { ...(snap.record as NpcRecord), id, archived: false, updatedAt: Date.now() };
    useNpc.setState((s) => ({ npcs: { ...s.npcs, [id]: rec } }));
    // 技能/天赋/称号/副职业/记忆——不还原这些，找回的就是个失忆空架子
    if (snap.char) {
      useCharacters.setState((s) => ({
        characters: { ...s.characters, [id]: { ...(s.characters[id] ?? {}), ...(snap.char as object) } },
      } as never));
    }
    const renamed = id !== snap.npcId ? `（原 ${snap.npcId} 已被占用，落地为 ${id}）` : '';
    console.log(`[NPC图书馆] 找回「${snap.name}」→ ${id}${renamed}`);
    return { ok: true, id, msg: `已找回「${snap.name}」${renamed}` };
  } catch (e) {
    console.warn('[NPC图书馆] 找回失败:', e);
    return { ok: false, id: '', msg: `找回失败：${(e as Error)?.message ?? e}` };
  }
}

/* B · AI 提取同步 —— 可安全同步的字段白名单。
   只放「叙事资料」：绝不让 AI 借这条路改 六维/血条/物品/技能 等有独立结算的数值（那些走各自的演化阶段）。 */
const SYNCABLE = ['personality', 'background', 'relations', 'innerThought', 'motiveNow', 'shortGoal', 'longGoal',
  'callPlayer', 'selfNarration', 'sampleLines', 'principles', 'title', 'profession', 'age',
  'favor', 'trust', 'respect', 'corruption'] as const;

const SYNC_RULE = `你是轮回乐园的档案官。玩家从「NPC 图书馆」里翻出了某角色**被删除/被合并前的旧档案快照**，
现在要把其中仍然成立的信息，同步回**当前这份档案**（当前这份多半是 AI 事后重新建档的空壳，丢失了与主角的共同经历与关系）。

【你的任务】
逐字段判断：旧快照里的哪些信息，应当被认定为"这个角色真实的过往"，同步进当前档案。

【铁则】
1. **忠于旧档案**：旧快照是玩家真实玩出来的历史（共同经历、关系、称呼、感情进展），默认可信，不要因为当前档案写着别的就否定它。
2. **不许凭空发明**：只能搬运/合并旧快照与当前档案里**已有**的信息，绝不新增没有依据的设定、事件或数值。
3. **关系数值只增不减**：favor/trust/respect/corruption 取两者中更能反映真实交往史的值；有疑问时取较大者。绝不因为当前是空壳就把关系清零。
4. **冲突时**：以旧快照的**长期事实**（身份、出身、与主角的关系史）为准；以当前档案的**即时状态**（当前心情、当前场景下的想法）为准。
5. 只输出需要改的字段；不需要改的**不要出现**在 JSON 里。

【可同步字段】（其余字段一律不许出现）
${SYNCABLE.join(' / ')}

【输出格式】
只输出一个 JSON 对象，禁止多余文字、禁止用 \`\`\`json 包裹：
{"thinking":"一句话说明你的取舍","updates":{"<字段名>":<值>}}`;

/** B · AI 提取同步：把旧快照的信息融进当前档案（targetId）。返回实际改动的字段。 */
export async function aiSyncSnapshot(
  snap: NpcSnapshot,
  targetId: string,
  recentNarrative?: string,
): Promise<{ ok: boolean; updated: string[]; msg: string }> {
  try {
    const cur = useNpc.getState().npcs[targetId];
    if (!cur) return { ok: false, updated: [], msg: `当前档案 ${targetId} 不存在` };

    const ss = useSettings.getState();
    const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
    const chain = resolveApiChain('npc', legacy);
    if (!chain[0]?.baseUrl || !chain[0]?.apiKey) {
      return { ok: false, updated: [], msg: '未配置 AI 接口（设置→NPC 演化→API 设置 或 综合设置→正文生成）' };
    }

    const pick = (r: Partial<NpcRecord>) => {
      const o: Record<string, unknown> = {};
      for (const f of SYNCABLE) if (r[f] != null && r[f] !== '') o[f] = r[f];
      return o;
    };
    const userContent = [
      `【旧档案快照】（入库原因：${snap.reason}；入库时间：第 ${snap.turn ?? '?'} 回合）`,
      JSON.stringify({ name: snap.name, ...pick(snap.record as NpcRecord) }, null, 1),
      `\n【当前档案】(${targetId})`,
      JSON.stringify({ name: cur.name, ...pick(cur) }, null, 1),
      snap.record?.deedLog?.length ? `\n【旧档案的经历时间线】\n${(snap.record.deedLog ?? []).map((d) => `· ${d.time || '?'} ${d.location || ''} ${d.description}`).join('\n')}` : '',
      recentNarrative ? `\n【最近正文（判断当前情境用）】\n${recentNarrative.slice(-2000)}` : '',
    ].filter(Boolean).join('\n');

    const { content } = await apiChatFallback(
      chain,
      [{ role: 'system', content: SYNC_RULE }, { role: 'user', content: userContent }],
      { timeoutMs: 90000, label: `图书馆找回·AI同步 ${snap.name}`, rawLang: true },
    );

    const parsed = lenientJsonParse(content) as { updates?: Record<string, unknown> } | null;
    const updates = parsed?.updates;
    if (!updates || typeof updates !== 'object') {
      return { ok: false, updated: [], msg: 'AI 没返回可用的同步结果' };
    }
    // 白名单过滤 + 数值 clamp——绝不让 AI 借这条路写白名单外的字段
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (!(SYNCABLE as readonly string[]).includes(k)) continue;
      if (['favor', 'trust', 'respect', 'corruption'].includes(k)) {
        const n = Number(v);
        if (!isFinite(n)) continue;
        const lo = k === 'favor' ? -100 : 0;
        patch[k] = Math.max(lo, Math.min(100, Math.round(n)));
      } else if (typeof v === 'string' && v.trim()) {
        patch[k] = v.trim();
      }
    }
    const updated = Object.keys(patch);
    if (!updated.length) return { ok: false, updated: [], msg: 'AI 判断无需同步任何字段' };
    useNpc.getState().upsertNpc(targetId, patch as Partial<NpcRecord>);
    console.log(`[NPC图书馆] AI 同步「${snap.name}」→ ${targetId}：${updated.join(', ')}`);
    return { ok: true, updated, msg: `已同步 ${updated.length} 个字段：${updated.join('、')}` };
  } catch (e) {
    console.warn('[NPC图书馆] AI 同步失败:', e);
    return { ok: false, updated: [], msg: `AI 同步失败：${(e as Error)?.message ?? e}` };
  }
}
