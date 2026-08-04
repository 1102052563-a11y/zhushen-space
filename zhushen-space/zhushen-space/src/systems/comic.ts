// 📖 漫画工坊编排层（完整复刻 comic-orb 工作流·已获授权；适配 zhushen 纯前端架构）：
//   直接分镜：楼层剧情(chatDb→toProse) + 角色资料 → 分镜 LLM(comic_orb_storyboard_v1) → 并发错峰绘画。
//   演绎分镜：完整剧情 → 演绎 LLM 切段(comic_orb_adaptation_v1·entity_bible 共享) → 各段错峰并发分镜(首败中止余段省钱)
//             → 合并重编页码 → 并发错峰绘画。
//   安全档位(off/soft/safe) + 送审措辞中性化/年龄剔除（只改请求副本·正文原文不动）+ 可恢复错误自动重试。
//   成功页立即落库（F5 后漫画库可「补齐缺页」）；全部成功可写回目标楼层（CustomEvent 桥·App 监听）。
import { loadAll } from './chatDb';
import { toProse } from './novelExport';
import { lenientJsonParse } from './stateParser';
import { apiChatFallback } from './apiChat';
import { generateImage } from './imageGen';
import { resolveApiChain, useSettings } from '../store/settingsStore';
import { usePlayer } from '../store/playerStore';
import { useNpc } from '../store/npcStore';
import { useComic, useComicJob, type ComicSettings } from '../store/comicStore';
import { putBatch, getBatch, putPage, getPage, pagesOfBatch, type ComicBatch } from './comicDb';
import { isTagService } from './imageTags';
import { outfitRosterLine, activeOutfit, outfitImageKey } from './outfit';
import { getImg } from './imageDb';
import { neutralizeForTransport, removeAgeExpressions, hasConflictingAgeMetadata } from './comicTransport';
import {
  COMIC_STORYBOARD_RULE, COMIC_RUNTIME_GUARDS, COMIC_ADULT_IDENTITY_RULE, COMIC_TAGS_RULE, COMIC_DRAW_GUARD,
  COMIC_ADAPTATION_RULE, COMIC_SAFETY_SOFT, COMIC_SAFETY_SAFE, COMIC_SAFETY_SAFE_FINAL,
  COMIC_AGE_NEUTRAL_RULE, COMIC_CLOSED_WORLD_RULE, COMIC_ADAPT_CLOSED_WORLD_RULE, COMIC_GAZE_RULE, COMIC_DRAW_SAFE_PREFIX,
} from '../promptRules';

export interface ComicPagePlan { page: number; goal: string; panels: number; prompt: string; tags?: string; segment?: number }
export interface ComicPlan {
  schema: string; language: string; title: string; style: string; colorScript?: string;
  characters: { name: string; look: string; costume?: string }[];
  pages: ComicPagePlan[];
  adaptation?: AdaptationPlan;   // 演绎模式：切段方案（重新分镜/排查用）
}
export interface AdaptationSegment {
  segment: number; title: string; story_purpose: string; refined_plot: string;
  entry_state: string; exit_state: string; key_dialogue_intents: { speaker: string; intent: string }[];
  climax: string; page_count: number; closeup_guidance: { subject: string; dramatic_purpose: string } | null;
}
export interface AdaptationPlan {
  language: string; title: string; source_summary: string; dramatic_throughline: string;
  entity_bible: unknown[]; segments: AdaptationSegment[];
}

/* ── 楼层清单（UI 选范围用）：只列有正文的 AI 楼层，楼号=消息在全量列表里的 1-based 位置 ── */
export interface FloorInfo { no: number; preview: string }
export async function listFloors(limit = 80): Promise<FloorInfo[]> {
  const all = await loadAll();
  return all
    .map((m, i) => ({ no: i + 1, role: m.role, preview: m.role === 'assistant' ? toProse(m.content).replace(/\s+/g, ' ').trim().slice(0, 36) : '' }))
    .filter((f) => f.role === 'assistant' && f.preview)
    .map(({ no, preview }) => ({ no, preview }))
    .slice(-limit);
}

/* ── 角色外观资料（结构化档案直注——比让 AI 从正文猜外观稳得多）── */
function buildRoster(narrative: string): string {
  const lines: string[] = [];
  const p = usePlayer.getState().profile;
  if (p?.name) {
    const look = [(p.baseAppearance || '').trim(), (p.appearance || '').trim()].filter(Boolean).join('；');
    const ol = outfitRosterLine('B1');   // 👗 钦定穿搭：分镜外观锁的服装以此为准
    lines.push(`- ${p.name}（主角·${(p.gender || '性别未知').trim()}）：${look || '外观见正文'}${(p.imageTags || '').trim() ? `；画像锚点：${p.imageTags}` : ''}${ol ? `；${ol}` : ''}`);
  }
  const npcs = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead && r.name && narrative.includes(r.name));
  npcs.sort((a, b) => Number(b.onScene ?? false) - Number(a.onScene ?? false));
  for (const r of npcs.slice(0, 8)) {
    const seg = (r.appearance5 || '').split('|');
    const ap = [seg[4], seg[3], seg[1], r.appearanceDetail].map((x) => (x || '').trim()).filter(Boolean).join('，');
    const base = (r.baseAppearance || '').trim();
    const bt = (r.bodyType || '').trim();
    const form = bt && bt !== '人形' ? `／形态：${bt}（非人形，按生物本体画，勿画成人形）` : '';
    const ol = outfitRosterLine(r.id);   // 👗 钦定穿搭
    lines.push(`- ${r.name}（${(r.gender || '性别未知').trim()}${form}）：${[base, ap].filter(Boolean).join('；') || '外观见正文'}${(r.imageTags || '').trim() ? `；画像锚点：${r.imageTags}` : ''}${ol ? `；${ol}` : ''}`);
  }
  return lines.length ? lines.join('\n') : '（无已建档角色，外观以正文描写为准）';
}

/* ── 参考图：出场角色的立绘/头像 + 👗激活穿搭参考图（仅 chatimg 多模态线发送；合计上限 4 张）── */
async function collectRefs(planChars: { name: string }[]): Promise<{ hints: string[]; images: string[] }> {
  const p = usePlayer.getState().profile;
  const npcs = Object.values(useNpc.getState().npcs);
  const out: { hint: string; img: string }[] = [];
  const push = (hint: string, img: string) => {
    if (img && img.startsWith('data:image/') && !out.some((x) => x.img === img) && out.length < 4) out.push({ hint, img });
  };
  for (const c of planChars) {
    if (out.length >= 4) break;
    const nm = (c?.name || '').trim();
    if (!nm) continue;
    let charId = '';
    let avatar = '';
    if (p?.name && (nm === p.name || nm.includes(p.name) || p.name.includes(nm))) { charId = 'B1'; avatar = p.avatar || ''; }
    if (!charId) {
      const hit = npcs.find((r) => !r.isDead && r.name && (r.name === nm || nm.includes(r.name) || r.name.includes(nm)));
      if (hit) { charId = hit.id; avatar = hit.avatar || ''; }
    }
    push(`${nm}（严格锁定其脸型、发色发型、体型与服装辨识特征）`, avatar);
    const outfit = activeOutfit(charId);   // 👗 钦定穿搭参考图：该角色服装以此图为准
    if (outfit?.hasImage && charId) {
      const oimg = await getImg(outfitImageKey(charId, outfit.id));
      if (oimg) push(`${nm}的钦定穿搭「${outfit.name}」（该角色的服装款式/颜色/材质以此图为准）`, oimg);
    }
  }
  return {
    hints: out.map((x, i) => `参考图${i + 1} = ${x.hint}`),
    images: out.map((x) => x.img),
  };
}

/* ── 运输副本处理（复刻 comic-orb）：安全档启用时剔除年龄表达；中性化开关另算。只改本次请求，原文不动 ── */
function transportText(cs: ComicSettings, text: string): string {
  let t = text;
  if (cs.safetyLevel !== 'off') {
    const age = removeAgeExpressions(t);
    if (age.count) console.log(`[Comic] 运输副本年龄表达剔除 ${age.count} 处`, age.categories, hasConflictingAgeMetadata(text) ? '（输入含低龄元数据）' : '');
    t = age.text;
  }
  if (cs.neutralize) {
    const neu = neutralizeForTransport(t);
    if (neu.count) console.log(`[Comic] 运输副本措辞中性化 ${neu.count} 处`, neu.categories);
    t = neu.text;
  }
  return t;
}

/* ── 可恢复错误自动重试（网络/429/5xx/超时·重试 1 次）── */
function isRetryable(e: unknown): boolean {
  const m = String((e as any)?.message ?? e ?? '');
  return /429|5\d\d|timeout|超时|network|fetch|失败.*连接|连接.*失败|ECONN|rate ?limit|暂时|overloaded|unavailable/i.test(m);
}
async function withRetry<T>(fn: () => Promise<T>, label: string, signal?: AbortSignal): Promise<T> {
  try { return await fn(); } catch (e) {
    if (signal?.aborted || !isRetryable(e)) throw e;
    console.warn(`[Comic] ${label} 失败（可恢复），2s 后自动重试一次：`, (e as any)?.message ?? e);
    await delay(2000, signal);
    return await fn();
  }
}

/* ── 分镜系统提示词组装（安全档位 addenda 复刻）── */
function storyboardSystem(cs: ComicSettings, pagesMin: number, pagesMax: number, lang: string, tagMode: boolean): string {
  const parts = [
    COMIC_STORYBOARD_RULE,
    COMIC_RUNTIME_GUARDS.replaceAll('${pages_min}', String(pagesMin)).replaceAll('${pages_max}', String(pagesMax)).replaceAll('${language}', lang),
    COMIC_GAZE_RULE,
    COMIC_CLOSED_WORLD_RULE,
  ];
  if (cs.safetyLevel === 'soft') parts.push(COMIC_SAFETY_SOFT);
  if (cs.safetyLevel === 'safe') parts.push(COMIC_SAFETY_SAFE);
  if (cs.safetyLevel !== 'off') parts.push(COMIC_AGE_NEUTRAL_RULE, COMIC_ADULT_IDENTITY_RULE);
  if (cs.safetyLevel === 'safe') parts.push(COMIC_SAFETY_SAFE_FINAL);
  if (tagMode) parts.push(COMIC_TAGS_RULE);
  return parts.join('\n\n');
}

function comicChain() {
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('comic_storyboard_llm', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('没配置分镜 LLM——设置→生图设置→漫画，给「分镜 LLM 路由」选个接口（留空则回退正文 API，但正文 API 也未配置）');
  return chain;
}

/* ── 分镜 JSON 解析（完整协议：page_prompt/panels 数组/appearance_lock；lenientJsonParse 容错）── */
export function parseComicPlan(raw: string, fallbackLang: string, maxPages = 20): ComicPlan {
  let s = (raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('分镜模型没有输出 JSON（可能拒答/输出了纯文字）：' + s.replace(/\s+/g, ' ').slice(0, 120));
  const obj: any = lenientJsonParse(s.slice(a, b + 1));
  if (!obj || typeof obj !== 'object') throw new Error('分镜 JSON 解析失败');
  const pages: ComicPagePlan[] = (Array.isArray(obj.pages) ? obj.pages : [])
    .map((p: any, i: number) => ({
      page: i + 1,                                                  // 重编号：模型偶尔跳号
      goal: String(p?.page_goal ?? p?.goal ?? '').trim(),
      panels: Array.isArray(p?.panels) ? Math.max(2, Math.min(6, p.panels.length)) : Math.max(2, Math.min(6, Number(p?.panels) || 4)),
      prompt: String(p?.page_prompt ?? p?.prompt ?? '').trim(),
      tags: typeof p?.tags === 'string' ? p.tags.trim() : Array.isArray(p?.tags) ? p.tags.map((t: unknown) => String(t).trim()).filter(Boolean).join(', ') : '',
    }))
    .filter((p: ComicPagePlan) => p.prompt)
    .slice(0, maxPages);
  if (!pages.length) throw new Error('分镜 JSON 里没有可用页（pages 为空或全部缺 page_prompt）');
  const gs = obj.global_style && typeof obj.global_style === 'object' ? obj.global_style : {};
  return {
    schema: 'comic_orb_storyboard_v1',
    language: String(obj.language || fallbackLang).trim() || fallbackLang,
    title: String(obj.title ?? '').trim() || '未命名漫画',
    style: String(gs.visual_style ?? obj.style ?? '').trim(),
    colorScript: String(gs.color_script ?? '').trim() || undefined,
    characters: (Array.isArray(obj.characters) ? obj.characters : [])
      .filter((c: any) => c && typeof c === 'object' && String(c.name ?? '').trim())
      .map((c: any) => ({
        name: String(c.name).trim(),
        look: String(c.appearance_lock ?? c.look ?? '').trim(),
        costume: String(c.costume ?? '').trim() || undefined,
      })),
    pages,
  };
}

/* ── 演绎 JSON 解析 ── */
export function parseAdaptationPlan(raw: string, fallbackLang: string, workerMin: number, workerMax: number): AdaptationPlan {
  let s = (raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('演绎模型没有输出 JSON（可能拒答/输出了纯文字）：' + s.replace(/\s+/g, ' ').slice(0, 120));
  const obj: any = lenientJsonParse(s.slice(a, b + 1));
  if (!obj || typeof obj !== 'object') throw new Error('演绎 JSON 解析失败');
  const segments: AdaptationSegment[] = (Array.isArray(obj.segments) ? obj.segments : [])
    .map((seg: any, i: number) => ({
      segment: i + 1,
      title: String(seg?.title ?? '').trim() || `第${i + 1}段`,
      story_purpose: String(seg?.story_purpose ?? '').trim(),
      refined_plot: String(seg?.refined_plot ?? '').trim(),
      entry_state: String(seg?.entry_state ?? '').trim(),
      exit_state: String(seg?.exit_state ?? '').trim(),
      key_dialogue_intents: (Array.isArray(seg?.key_dialogue_intents) ? seg.key_dialogue_intents : [])
        .filter((k: any) => k && typeof k === 'object')
        .map((k: any) => ({ speaker: String(k.speaker ?? '').trim(), intent: String(k.intent ?? '').trim() })),
      climax: String(seg?.climax ?? '').trim(),
      page_count: Math.max(workerMin, Math.min(workerMax, Math.round(Number(seg?.page_count)) || workerMin)),
      closeup_guidance: seg?.closeup_guidance && typeof seg.closeup_guidance === 'object'
        ? { subject: String(seg.closeup_guidance.subject ?? '').trim(), dramatic_purpose: String(seg.closeup_guidance.dramatic_purpose ?? '').trim() }
        : null,
    }))
    .filter((seg: AdaptationSegment) => seg.refined_plot)
    .slice(0, 20);
  if (!segments.length) throw new Error('演绎 JSON 里没有可用段（segments 为空或全部缺 refined_plot）');
  return {
    language: String(obj.language || fallbackLang).trim() || fallbackLang,
    title: String(obj.title ?? '').trim() || '未命名漫画',
    source_summary: String(obj.source_summary ?? '').trim(),
    dramatic_throughline: String(obj.dramatic_throughline ?? '').trim(),
    entity_bible: Array.isArray(obj.entity_bible) ? obj.entity_bible : [],
    segments,
  };
}

/* ── 页数规格（复刻 normalizeWorkerPageSpec / assertInterpretivePageAllocation）── */
export function normalizeWorkerSpec(value: string): { min: number; max: number; spec: string } {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d+)\s*(?:(?:-|~|～|到|至)\s*(\d+))?$/);
  if (!match) throw new Error('单个分镜页数必须是单独数字或范围，例如 2 或 1-3');
  const first = Number(match[1]); const second = Number(match[2] || match[1]);
  if (!Number.isInteger(first) || !Number.isInteger(second) || first < 1 || second < 1 || first > 20 || second > 20) throw new Error('单个分镜页数必须在 1-20 之间');
  const min = Math.min(first, second); const max = Math.max(first, second);
  return { min, max, spec: min === max ? String(min) : `${min}-${max}` };
}
export function assertPageAllocation(totalMin: number, totalMax: number, workerSpec: string): void {
  const worker = normalizeWorkerSpec(workerSpec);
  let possible = new Set([0]); const attainable = new Set<number>();
  for (let segs = 1; segs <= 20; segs++) {
    const next = new Set<number>();
    for (const sum of possible) for (let p = worker.min; p <= worker.max; p++) if (sum + p <= 20) next.add(sum + p);
    possible = next;
    for (const sum of possible) if (sum >= totalMin && sum <= totalMax) attainable.add(sum);
    if (!possible.size) break;
  }
  if (!attainable.size) throw new Error(`总页数 ${totalMin}-${totalMax} 与单个分镜页数 ${worker.spec} 无法组合；请调整其中一项`);
}

/* ── 分镜调用（comic_storyboard_llm 路由·运输处理·自动重试）── */
async function callStoryboard(userContent: string, cs: ComicSettings, pagesMin: number, pagesMax: number, tagMode: boolean, label: string, signal?: AbortSignal): Promise<ComicPlan> {
  const chain = comicChain();
  const lang = (cs.language || 'zh-CN').trim() || 'zh-CN';
  const system = storyboardSystem(cs, pagesMin, pagesMax, lang, tagMode);
  const user = `${transportText(cs, userContent)}\n\n【本次要求】漫画输出语言：${lang}${tagMode ? '；绘画模型是英文标签模型，每页必须给 "tags" 字段' : ''}。只输出一个 JSON 对象。`;
  const { content } = await withRetry(
    () => apiChatFallback(chain, [{ role: 'system', content: system }, { role: 'user', content: user }], { label, rawLang: true, timeoutMs: 300000 }),
    label, signal,
  );
  return parseComicPlan(content, lang, pagesMax);
}

/* ── 演绎调用 ── */
async function callAdaptation(narrative: string, roster: string, cs: ComicSettings, totalMin: number, totalMax: number, workerSpec: string, signal?: AbortSignal): Promise<AdaptationPlan> {
  const chain = comicChain();
  const lang = (cs.language || 'zh-CN').trim() || 'zh-CN';
  const worker = normalizeWorkerSpec(workerSpec);
  const system = [COMIC_ADAPTATION_RULE, COMIC_ADAPT_CLOSED_WORLD_RULE, ...(cs.safetyLevel !== 'off' ? [COMIC_AGE_NEUTRAL_RULE] : [])].join('\n\n');
  const user = `【剧情材料（按楼层顺序）】\n${transportText(cs, narrative)}\n\n【角色外观资料（最高优先级·外观事实只能取自这里与剧情原文）】\n${roster}\n\n【本次要求】总页数范围：${totalMin}-${totalMax} 页；单个分镜AI页数规格：${worker.spec}；漫画输出语言：${lang}。只输出一个 JSON 对象。`;
  const { content } = await withRetry(
    () => apiChatFallback(chain, [{ role: 'system', content: system }, { role: 'user', content: user }], { label: '漫画演绎', rawLang: true, timeoutMs: 300000 }),
    '漫画演绎', signal,
  );
  return parseAdaptationPlan(content, lang, worker.min, worker.max);
}

/* ── 段落分镜提示词（复刻 adaptationSegmentPrompt·去掉画风分析子系统）── */
function segmentPrompt(adaptation: AdaptationPlan, seg: AdaptationSegment): string {
  const closeup = seg.closeup_guidance
    ? `本段允许且最多安排一次特写。对象：${seg.closeup_guidance.subject}；剧情作用：${seg.closeup_guidance.dramatic_purpose}。是否使用及具体镜头由你决定，不得增加第二个特写。`
    : '本段没有必要的单张特写指导，不要为了形式强行增加特写。';
  const bible = adaptation.entity_bible.length
    ? JSON.stringify(adaptation.entity_bible)
    : '未提供；若本段存在明显的跨页实体连续性风险，可自行建立简短的可选entity_bible。';
  return `这是上游剧情演绎编辑交付的第 ${seg.segment}/${adaptation.segments.length} 段。请只对本段进行精细漫画分镜，不要重新扩写其他段落，也不要重复上一段结束事件。

总标题：${adaptation.title}
全局剧情主线：${adaptation.dramatic_throughline}
全局共享entity_bible（软约束，不参与格式校验）：${bible}
本段标题：${seg.title}
本段叙事作用：${seg.story_purpose}
进入状态：${seg.entry_state}
精炼剧情：${seg.refined_plot}
关键对白意图：${JSON.stringify(seg.key_dialogue_intents)}
唯一主要高潮：${seg.climax}
结束状态：${seg.exit_state}
页数：必须严格输出 ${seg.page_count} 页。
特写指导：${closeup}

把上述剧情材料转成完整的comic_orb_storyboard_v1 JSON。entity_bible可沿用、补充、简化或在不需要时省略；不要因为其中缺字段、拼写差异或轻微矛盾而停止工作。所有page_prompt仍须完全自包含；本段第一页从进入状态之后开始，本段最后一页必须到达结束状态。

【本段剧情边界】本段材料是封闭范围，只能表现精炼剧情中已经存在的事件，并严格停在"结束状态"。全局主线只帮助理解上下文，不授权提前表现其他段落；不得依据世界观或类型常识揭示本段未命名对象、补写下一事件或创造新的高潮。固定页数需要更多画幅时，拆分现有动作、反应、环境与情绪节拍，不得新增或重复剧情事实。`;
}

/* ── 演绎模式主链路（复刻 runInterpretiveStoryboard：错峰并发+首败中止余段）── */
async function runInterpretive(narrative: string, roster: string, cs: ComicSettings, tagMode: boolean, signal: AbortSignal): Promise<ComicPlan> {
  const job = useComicJob.getState();
  const totalMin = Math.max(2, Math.min(20, Math.round(cs.pagesMin) || 4));
  const totalMax = Math.max(totalMin, Math.min(20, Math.round(cs.pagesMax) || 8));
  job.setPhase('演绎中…（完整剧情切段，约几十秒）');
  const adaptation = await callAdaptation(narrative, roster, cs, totalMin, totalMax, cs.workerPages, signal);
  const totalPages = adaptation.segments.reduce((s, seg) => s + seg.page_count, 0);
  job.setPhase(`错峰并发分镜：${adaptation.segments.length} 段 · 共 ${totalPages} 页…`);
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  let primaryFailure: unknown = null; let primaryFailureSeg = 0;
  const results = new Map<number, { seg: AdaptationSegment; plan: ComicPlan }>();
  const settled = await Promise.allSettled(adaptation.segments.map(async (seg, i) => {
    try {
      await delay(i * 400, controller.signal);   // 错峰启动防请求突发
      const plan = await callStoryboard(segmentPrompt(adaptation, seg), cs, seg.page_count, seg.page_count, tagMode, `漫画分镜·第${seg.segment}段`, controller.signal);
      results.set(seg.segment, { seg, plan });
      useComicJob.getState().setPhase(`错峰并发分镜：${results.size}/${adaptation.segments.length} 段完成…`);
    } catch (e) {
      if (!controller.signal.aborted) { primaryFailure = e; primaryFailureSeg = seg.segment; controller.abort(e); }   // 首败中止余段省钱
      throw e;
    }
  }));
  if (settled.some((x) => x.status === 'rejected')) {
    if (signal.aborted) throw new Error('漫画任务已取消');
    throw new Error(`并发分镜失败于第 ${primaryFailureSeg} 段：${(primaryFailure as any)?.message ?? primaryFailure}（其余段已中止；请重新生成）`);
  }
  // 合并：重编页码 + 按 名字|外观锁 去重合并角色（复刻 combineAdaptedStoryboardPlans）
  const pages: ComicPagePlan[] = [];
  const characters: ComicPlan['characters'] = [];
  const charKeys = new Set<string>();
  for (const seg of adaptation.segments) {
    const r = results.get(seg.segment)!;
    for (const c of r.plan.characters) {
      const key = `${c.name}|${c.look}`;
      if (!charKeys.has(key)) { charKeys.add(key); characters.push(c); }
    }
    for (const pg of r.plan.pages) pages.push({ ...pg, page: pages.length + 1, segment: seg.segment });
  }
  const first = results.get(adaptation.segments[0].segment)!.plan;
  return {
    schema: 'comic_orb_storyboard_v1',
    language: adaptation.language,
    title: adaptation.title,
    style: first.style,
    colorScript: first.colorScript,
    characters,
    pages,
    adaptation,
  };
}

/* ── 每页最终绘画提示词 ── */
function buildPagePrompt(plan: ComicPlan, pg: ComicPagePlan, refHints: string[], lang: string, cs: ComicSettings): string {
  const looks = plan.characters
    .filter((c) => c.name && (pg.prompt.includes(c.name) || plan.pages.length === 1))
    .map((c) => `- ${c.name}：${c.look || '未指定'}${c.costume ? `；服装：${c.costume}` : ''}`);
  return [
    cs.safetyLevel === 'safe' ? COMIC_DRAW_SAFE_PREFIX : '',
    plan.style ? `【整体画风】${plan.style}${plan.colorScript ? `；配色与光影：${plan.colorScript}` : ''}` : '',
    pg.prompt,
    looks.length ? `【角色外观锁】\n${looks.join('\n')}` : '',
    refHints.length ? `【参考图】\n${refHints.join('\n')}` : '',
    COMIC_DRAW_GUARD.replaceAll('${language}', lang),
  ].filter(Boolean).join('\n\n');
}

/* 标签线兜底：分镜没按要求给 tags 时，拼「出场角色画像锚点 + 通用构图标签」——效果打折但不废页 */
function fallbackPageTags(plan: ComicPlan, pg: ComicPagePlan): string {
  const p = usePlayer.getState().profile;
  const npcs = Object.values(useNpc.getState().npcs);
  const parts: string[] = [];
  for (const c of plan.characters) {
    if (!c.name || !pg.prompt.includes(c.name)) continue;
    const tags = ((p?.name === c.name ? p?.imageTags : npcs.find((r) => r.name === c.name)?.imageTags) || '').trim();
    if (tags) parts.push(tags);
  }
  parts.push('dramatic composition, dynamic angle, detailed background, cinematic lighting');
  return parts.join(', ');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((res, rej) => {
    const onAbort = () => { clearTimeout(t); rej(new Error('漫画任务已取消')); };
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); res(); }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/* ── 并发错峰绘画：单页失败只标记该页（可补齐）；可恢复错误自动重试 1 次；返回成功页明细供写回 ── */
interface DrawnPage { page: number; dataUrl: string; finalPrompt: string }
async function drawPages(batchId: string, plan: ComicPlan, cs: ComicSettings, signal: AbortSignal): Promise<DrawnPage[]> {
  const tagMode = isTagService(cs.service);   // NAI/ComfyUI：每页一张关键画面插画（英文 tags 驱动·无守卫无参考图）
  const refs = !tagMode && cs.sendCharRefs && cs.service === 'chatimg' ? await collectRefs(plan.characters) : { hints: [], images: [] };
  const lang = plan.language || cs.language;
  const done: DrawnPage[] = [];
  await Promise.allSettled(plan.pages.map(async (pg, i) => {
    await delay(i * Math.max(0, cs.staggerMs || 0), signal);
    useComicJob.getState().patchPage(pg.page, { status: 'drawing' });
    try {
      const finalPrompt = tagMode
        ? ((pg.tags || '').trim() || fallbackPageTags(plan, pg))
        : buildPagePrompt(plan, pg, refs.hints, lang, cs);
      const img = await withRetry(
        () => generateImage(cs.service, {
          prompt: finalPrompt, negative: cs.negative || undefined, size: cs.size || undefined,
          refImages: refs.images, signal, label: `漫画·第${pg.page}页`,
        }),
        `漫画·第${pg.page}页`, signal,
      );
      await putPage({ id: `${batchId}_p${pg.page}`, batchId, page: pg.page, dataUrl: img, pagePrompt: pg.prompt, finalPrompt, createdAt: Date.now() });
      done.push({ page: pg.page, dataUrl: img, finalPrompt });
      useComicJob.getState().patchPage(pg.page, { status: 'ok' });
    } catch (e: any) {
      useComicJob.getState().patchPage(pg.page, { status: 'fail', error: e?.message || String(e) });
    }
  }));
  return done.sort((a, b) => a.page - b.page);
}

let ctrl: AbortController | null = null;
export function cancelComic(): void { ctrl?.abort(); }

/* ── 主流程：楼层剧情 →（直接分镜 | 演绎→并发分镜）→ 并发绘画 → 漫画库（+可选写回楼层）── */
export async function generateComic(floorNos: number[]): Promise<string | null> {
  if (useComicJob.getState().running) throw new Error('已有漫画任务在进行中');
  const cs = useComic.getState();
  if (cs.workflowMode === 'interpretive') assertPageAllocation(Math.min(cs.pagesMin, cs.pagesMax), Math.max(cs.pagesMin, cs.pagesMax), cs.workerPages);   // 提前拦无解组合
  ctrl = new AbortController();
  const signal = ctrl.signal;
  useComicJob.getState().start('读取楼层剧情…');
  try {
    const all = await loadAll();
    const picked = floorNos
      .map((no) => ({ no, msg: all[no - 1] }))
      .filter((x) => x.msg && x.msg.role === 'assistant' && (x.msg.content || '').trim());
    if (!picked.length) throw new Error('所选范围内没有可用的 AI 剧情楼层');
    const targetMsgId = picked[picked.length - 1].msg.id;   // 写回目标=范围内最后一个 AI 楼层
    let narrative = picked.map((x) => `【楼${x.no}】\n${toProse(x.msg.content)}`).join('\n\n');
    if (narrative.length > 40000) narrative = '（前文过长，已截断保留后段）\n…' + narrative.slice(-40000);
    if (!narrative.trim()) throw new Error('清洗游戏数据后剧情为空');
    const roster = buildRoster(narrative);
    const tagMode = isTagService(cs.service);
    let plan: ComicPlan;
    if (cs.workflowMode === 'interpretive') {
      plan = await runInterpretive(narrative, roster, cs, tagMode, signal);
    } else {
      useComicJob.getState().setPhase('分镜中…（LLM 生成分镜 JSON，约几十秒）');
      const n = Math.max(1, Math.min(4, Math.round(cs.pageCount) || 2));
      const userContent = `【剧情材料（按楼层顺序）】\n${narrative}\n\n【角色外观资料（最高优先级·外观事实只能取自这里与剧情原文）】\n${roster}`;
      plan = await callStoryboard(userContent, cs, n, n, tagMode, '漫画分镜', signal);
    }
    const batchId = `cb_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const batch: ComicBatch = {
      id: batchId, title: plan.title, createdAt: Date.now(),
      sourceFloors: picked.map((x) => x.no),
      sourceDigest: narrative.replace(/\s+/g, ' ').trim().slice(0, 80),
      language: plan.language, plan, pageTotal: plan.pages.length, status: 'partial',
    };
    await putBatch(batch);
    useComicJob.getState().setPages(plan.pages.map((p) => ({ page: p.page, status: 'pending' as const })));
    useComicJob.getState().setPhase(`绘画中… 共 ${plan.pages.length} 页（并发错峰，每页独立成败）`);
    const drawn = await drawPages(batchId, plan, cs, signal);
    batch.status = drawn.length >= plan.pages.length ? 'done' : 'partial';
    await putBatch(batch);
    // 全部成功 + 开了写回 → 事件桥交给 App 追加进目标楼层正文（漫画库仍是主存放地）
    if (batch.status === 'done' && cs.insertToFloor && typeof targetMsgId === 'number') {
      try {
        window.dispatchEvent(new CustomEvent('zs-comic-insert', {
          detail: { msgId: targetMsgId, title: plan.title, pages: drawn.map((d) => ({ url: d.dataUrl, prompt: d.finalPrompt })) },
        }));
      } catch { /* 写回失败不影响漫画库 */ }
    }
    useComicJob.getState().finish(
      batch.status === 'done'
        ? `✓ 《${plan.title}》完成，共 ${drawn.length} 页${cs.insertToFloor ? '（已写回楼层）' : ''}`
        : `⚠ 完成 ${drawn.length}/${plan.pages.length} 页——可在漫画库「补齐缺页」`,
      batchId,
    );
    return batchId;
  } catch (e: any) {
    useComicJob.getState().finish('✗ ' + (e?.message || String(e)));
    return null;
  } finally { ctrl = null; }
}

/* ── 补齐缺页：只画 plan 里没有页图记录的页 ── */
export async function retryMissingPages(batchId: string): Promise<void> {
  if (useComicJob.getState().running) throw new Error('已有漫画任务在进行中');
  const batch = await getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  const plan = batch.plan as ComicPlan;
  const have = new Set((await pagesOfBatch(batchId)).map((p) => p.page));
  const missing = plan.pages.filter((p) => !have.has(p.page));
  if (!missing.length) return;
  const cs = useComic.getState();
  ctrl = new AbortController();
  useComicJob.getState().start(`补齐缺页：第 ${missing.map((p) => p.page).join('、')} 页`);
  useComicJob.getState().setPages(missing.map((p) => ({ page: p.page, status: 'pending' as const })));
  try {
    const ok = await drawPages(batchId, { ...plan, pages: missing }, cs, ctrl.signal);
    const total = have.size + ok.length;
    batch.status = total >= plan.pages.length ? 'done' : 'partial';
    await putBatch(batch);
    useComicJob.getState().finish(total >= plan.pages.length ? '✓ 已补齐全部页' : `⚠ 补了 ${ok.length} 页，仍缺 ${plan.pages.length - total} 页`, batchId);
  } catch (e: any) {
    useComicJob.getState().finish('✗ ' + (e?.message || String(e)), batchId);
  } finally { ctrl = null; }
}

/* ── 单页重绘：优先复用当时实际发送的提示词；旧版本保留进 versions（上限 3·阅读器可切）── */
export async function redrawPage(batchId: string, pageNo: number): Promise<void> {
  const cs = useComic.getState();
  const batch = await getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  const plan = batch.plan as ComicPlan;
  const rec = await getPage(`${batchId}_p${pageNo}`);
  const pg = plan.pages.find((p) => p.page === pageNo);
  const lang = plan.language || cs.language;
  const tagMode = isTagService(cs.service);
  const finalPrompt = rec?.finalPrompt
    || (pg ? (tagMode ? ((pg.tags || '').trim() || fallbackPageTags(plan, pg)) : buildPagePrompt(plan, pg, [], lang, cs)) : '');
  if (!finalPrompt) throw new Error('找不到该页的绘画提示词');
  const refs = !tagMode && cs.sendCharRefs && cs.service === 'chatimg' ? await collectRefs(plan.characters) : { hints: [], images: [] };
  const img = await generateImage(cs.service, {
    prompt: finalPrompt, negative: cs.negative || undefined, size: cs.size || undefined,
    refImages: refs.images, label: `漫画·重绘第${pageNo}页`,
  });
  const versions = rec
    ? [{ dataUrl: rec.dataUrl, finalPrompt: rec.finalPrompt, createdAt: rec.createdAt }, ...(rec.versions ?? [])].slice(0, 3)
    : undefined;
  await putPage({ id: `${batchId}_p${pageNo}`, batchId, page: pageNo, dataUrl: img, pagePrompt: pg?.prompt || rec?.pagePrompt || '', finalPrompt, createdAt: Date.now(), ...(versions ? { versions } : {}) });
}

/* ── 重新分镜：按当前设置对同批楼层重跑分镜（覆盖 plan），随后全部页重画 ── */
export async function restoryboardBatch(batchId: string): Promise<void> {
  if (useComicJob.getState().running) throw new Error('已有漫画任务在进行中');
  const batch = await getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  const cs = useComic.getState();
  ctrl = new AbortController();
  const signal = ctrl.signal;
  useComicJob.getState().start('重新分镜：读取原楼层剧情…');
  try {
    const all = await loadAll();
    const picked = (batch.sourceFloors || [])
      .map((no) => ({ no, msg: all[no - 1] }))
      .filter((x) => x.msg && x.msg.role === 'assistant' && (x.msg.content || '').trim());
    if (!picked.length) throw new Error('原楼层已不存在（历史被截断/删除），无法重新分镜');
    let narrative = picked.map((x) => `【楼${x.no}】\n${toProse(x.msg.content)}`).join('\n\n');
    if (narrative.length > 40000) narrative = '（前文过长，已截断保留后段）\n…' + narrative.slice(-40000);
    const roster = buildRoster(narrative);
    const tagMode = isTagService(cs.service);
    let plan: ComicPlan;
    if (cs.workflowMode === 'interpretive') {
      plan = await runInterpretive(narrative, roster, cs, tagMode, signal);
    } else {
      useComicJob.getState().setPhase('重新分镜中…');
      const n = Math.max(1, Math.min(4, Math.round(cs.pageCount) || 2));
      plan = await callStoryboard(`【剧情材料（按楼层顺序）】\n${narrative}\n\n【角色外观资料（最高优先级·外观事实只能取自这里与剧情原文）】\n${roster}`, cs, n, n, tagMode, '漫画重新分镜', signal);
    }
    batch.plan = plan; batch.title = plan.title; batch.language = plan.language;
    batch.pageTotal = plan.pages.length; batch.status = 'partial';
    await putBatch(batch);
    useComicJob.getState().setPages(plan.pages.map((p) => ({ page: p.page, status: 'pending' as const })));
    useComicJob.getState().setPhase(`重绘全部 ${plan.pages.length} 页…`);
    const drawn = await drawPages(batchId, plan, cs, signal);   // 同页号原位覆盖（旧图不进 versions——整批换代）
    batch.status = drawn.length >= plan.pages.length ? 'done' : 'partial';
    await putBatch(batch);
    useComicJob.getState().finish(drawn.length >= plan.pages.length ? `✓ 重新分镜完成，共 ${drawn.length} 页` : `⚠ 重新分镜后完成 ${drawn.length}/${plan.pages.length} 页——可「补齐缺页」`, batchId);
  } catch (e: any) {
    useComicJob.getState().finish('✗ ' + (e?.message || String(e)), batchId);
  } finally { ctrl = null; }
}
