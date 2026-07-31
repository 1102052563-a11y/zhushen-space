// 📖 漫画工坊编排层（工作流思想借鉴 comic-orb·代码与提示词全部自写）：
//   楼层剧情(chatDb→toProse 清洗) + 角色外观资料 → 分镜 LLM(严格 JSON zs_comic_v1)
//   → 每页 prompt 完全自包含 → 并发错峰绘画(失败页不拖累成功页·可补齐) → comicDb 漫画库。
// 生成在后台跑（关掉设置面板不中断）；进度经 useComicJob 供 UI 订阅。
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
import { COMIC_STORYBOARD_RULE, COMIC_SOFTEN_RULE, COMIC_DRAW_GUARD } from '../promptRules';

export interface ComicPagePlan { page: number; goal: string; panels: number; prompt: string }
export interface ComicPlan {
  schema: string; language: string; title: string; style: string;
  characters: { name: string; look: string }[];
  pages: ComicPagePlan[];
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

/* ── 角色外观资料（结构化档案直注分镜——比让 AI 从正文猜外观稳得多）── */
function buildRoster(narrative: string): string {
  const lines: string[] = [];
  const p = usePlayer.getState().profile;
  if (p?.name) {
    const look = [(p.baseAppearance || '').trim(), (p.appearance || '').trim()].filter(Boolean).join('；');
    lines.push(`- ${p.name}（主角·${(p.gender || '性别未知').trim()}）：${look || '外观见正文'}${(p.imageTags || '').trim() ? `；画像锚点：${p.imageTags}` : ''}`);
  }
  const npcs = Object.values(useNpc.getState().npcs).filter((r) => !r.isDead && r.name && narrative.includes(r.name));
  npcs.sort((a, b) => Number(b.onScene ?? false) - Number(a.onScene ?? false));
  for (const r of npcs.slice(0, 8)) {
    const seg = (r.appearance5 || '').split('|');
    const ap = [seg[4], seg[3], seg[1], r.appearanceDetail].map((x) => (x || '').trim()).filter(Boolean).join('，');
    const base = (r.baseAppearance || '').trim();
    const bt = (r.bodyType || '').trim();
    const form = bt && bt !== '人形' ? `／形态：${bt}（非人形，按生物本体画，勿画成人形）` : '';
    lines.push(`- ${r.name}（${(r.gender || '性别未知').trim()}${form}）：${[base, ap].filter(Boolean).join('；') || '外观见正文'}${(r.imageTags || '').trim() ? `；画像锚点：${r.imageTags}` : ''}`);
  }
  return lines.length ? lines.join('\n') : '（无已建档角色，外观以正文描写为准）';
}

/* ── 参考图：出场角色的立绘/头像（仅 chatimg 多模态线发送，锁长相；上限 4 张）── */
function collectRefs(planChars: { name: string }[]): { hints: string[]; images: string[] } {
  const p = usePlayer.getState().profile;
  const npcs = Object.values(useNpc.getState().npcs);
  const out: { name: string; img: string }[] = [];
  for (const c of planChars) {
    const nm = (c?.name || '').trim();
    if (!nm) continue;
    let img = '';
    if (p?.name && (nm === p.name || nm.includes(p.name) || p.name.includes(nm))) img = p.avatar || '';
    if (!img) {
      const hit = npcs.find((r) => !r.isDead && r.name && (r.name === nm || nm.includes(r.name) || r.name.includes(nm)));
      img = hit?.avatar || '';
    }
    if (img && img.startsWith('data:image/') && !out.some((x) => x.img === img)) out.push({ name: nm, img });
    if (out.length >= 4) break;
  }
  return {
    hints: out.map((x, i) => `参考图${i + 1} = ${x.name}（严格锁定其脸型、发色发型、体型与服装辨识特征）`),
    images: out.map((x) => x.img),
  };
}

/* ── 分镜 JSON 解析（lenientJsonParse 容错 + 结构夹取）── */
export function parseComicPlan(raw: string, fallbackLang: string): ComicPlan {
  let s = (raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('分镜模型没有输出 JSON（可能拒答/输出了纯文字）：' + s.replace(/\s+/g, ' ').slice(0, 120));
  const obj: any = lenientJsonParse(s.slice(a, b + 1));
  if (!obj || typeof obj !== 'object') throw new Error('分镜 JSON 解析失败');
  const pages: ComicPagePlan[] = (Array.isArray(obj.pages) ? obj.pages : [])
    .map((p: any, i: number) => ({
      page: i + 1,                                                  // 重编号：模型偶尔跳号
      goal: String(p?.goal ?? '').trim(),
      panels: Math.max(2, Math.min(6, Number(p?.panels) || 4)),
      prompt: String(p?.prompt ?? '').trim(),
    }))
    .filter((p: ComicPagePlan) => p.prompt)
    .slice(0, 6);
  if (!pages.length) throw new Error('分镜 JSON 里没有可用页（pages 为空或全部缺 prompt）');
  return {
    schema: 'zs_comic_v1',
    language: String(obj.language || fallbackLang).trim() || fallbackLang,
    title: String(obj.title ?? '').trim() || '未命名漫画',
    style: String(obj.style ?? '').trim(),
    characters: (Array.isArray(obj.characters) ? obj.characters : [])
      .filter((c: any) => c && typeof c === 'object' && String(c.name ?? '').trim())
      .map((c: any) => ({ name: String(c.name).trim(), look: String(c.look ?? '').trim() })),
    pages,
  };
}

/* ── 分镜调用：comic_storyboard_llm 路由（留空回退正文 API）── */
async function callStoryboard(narrative: string, roster: string, cs: ComicSettings): Promise<ComicPlan> {
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('comic_storyboard_llm', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('没配置分镜 LLM——设置→生图设置→漫画，给「分镜 LLM 路由」选个接口（留空则回退正文 API，但正文 API 也未配置）');
  const lang = (cs.language || 'zh-CN').trim() || 'zh-CN';
  const n = Math.max(1, Math.min(4, Math.round(cs.pageCount) || 2));
  const system = COMIC_STORYBOARD_RULE.replaceAll('${page_count}', String(n)).replaceAll('${language}', lang)
    + (cs.soften ? `\n\n${COMIC_SOFTEN_RULE}` : '');
  const user = `【剧情材料（按楼层顺序）】\n${narrative}\n\n【角色外观资料（最高优先级·外观锁只能取自这里与剧情原文）】\n${roster}\n\n【本次要求】共 ${n} 页；漫画文字语言：${lang}。只输出一个 JSON 对象。`;
  const { content } = await apiChatFallback(
    chain,
    [{ role: 'system', content: system }, { role: 'user', content: user }],
    { label: '漫画分镜', rawLang: true, timeoutMs: 300000 },
  );
  return parseComicPlan(content, lang);
}

/* ── 每页最终绘画提示词：分镜页 prompt + 画风 + 出场角色外观锁 + 参考图映射 + 绘制守卫 ── */
function buildPagePrompt(plan: ComicPlan, pg: ComicPagePlan, refHints: string[], lang: string): string {
  const looks = plan.characters
    .filter((c) => c.name && (pg.prompt.includes(c.name) || plan.pages.length === 1))
    .map((c) => `- ${c.name}：${c.look || '未指定'}`);
  return [
    plan.style ? `【整体画风】${plan.style}` : '',
    pg.prompt,
    looks.length ? `【角色外观锁】\n${looks.join('\n')}` : '',
    refHints.length ? `【参考图】\n${refHints.join('\n')}` : '',
    COMIC_DRAW_GUARD.replaceAll('${language}', lang),
  ].filter(Boolean).join('\n\n');
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

/* ── 并发错峰绘画：单页失败只标记该页（不拖累其它页），成功页立即落库可补齐 ── */
async function drawPages(batchId: string, plan: ComicPlan, cs: ComicSettings, signal: AbortSignal): Promise<number> {
  const refs = cs.sendCharRefs && cs.service === 'chatimg' ? collectRefs(plan.characters) : { hints: [], images: [] };
  const lang = plan.language || cs.language;
  let ok = 0;
  await Promise.allSettled(plan.pages.map(async (pg, i) => {
    await delay(i * Math.max(0, cs.staggerMs || 0), signal);
    useComicJob.getState().patchPage(pg.page, { status: 'drawing' });
    try {
      const finalPrompt = buildPagePrompt(plan, pg, refs.hints, lang);
      const img = await generateImage(cs.service, {
        prompt: finalPrompt, negative: cs.negative || undefined, size: cs.size || undefined,
        refImages: refs.images, signal, label: `漫画·第${pg.page}页`,
      });
      await putPage({ id: `${batchId}_p${pg.page}`, batchId, page: pg.page, dataUrl: img, pagePrompt: pg.prompt, finalPrompt, createdAt: Date.now() });
      ok += 1;
      useComicJob.getState().patchPage(pg.page, { status: 'ok' });
    } catch (e: any) {
      useComicJob.getState().patchPage(pg.page, { status: 'fail', error: e?.message || String(e) });
    }
  }));
  return ok;
}

let ctrl: AbortController | null = null;
export function cancelComic(): void { ctrl?.abort(); }

/* ── 主流程：楼层剧情 → 分镜 → 并发绘画 → 漫画库。返回批次 id（失败返回 null，错误进 job.phase）── */
export async function generateComic(floorNos: number[]): Promise<string | null> {
  if (useComicJob.getState().running) throw new Error('已有漫画任务在进行中');
  const cs = useComic.getState();
  ctrl = new AbortController();
  const signal = ctrl.signal;
  useComicJob.getState().start('读取楼层剧情…');
  try {
    const all = await loadAll();
    const picked = floorNos
      .map((no) => ({ no, msg: all[no - 1] }))
      .filter((x) => x.msg && x.msg.role === 'assistant' && (x.msg.content || '').trim());
    if (!picked.length) throw new Error('所选范围内没有可用的 AI 剧情楼层');
    let narrative = picked.map((x) => `【楼${x.no}】\n${toProse(x.msg.content)}`).join('\n\n');
    if (narrative.length > 20000) narrative = '（前文过长，已截断保留后段）\n…' + narrative.slice(-20000);
    if (!narrative.trim()) throw new Error('清洗游戏数据后剧情为空');
    const roster = buildRoster(narrative);
    useComicJob.getState().setPhase('分镜中…（LLM 生成分镜 JSON，约几十秒）');
    const plan = await callStoryboard(narrative, roster, cs);
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
    const okPages = await drawPages(batchId, plan, cs, signal);
    batch.status = okPages >= plan.pages.length ? 'done' : 'partial';
    await putBatch(batch);
    useComicJob.getState().finish(
      okPages >= plan.pages.length ? `✓ 《${plan.title}》完成，共 ${okPages} 页` : `⚠ 完成 ${okPages}/${plan.pages.length} 页——可在漫画库「补齐缺页」`,
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
    const total = have.size + ok;
    batch.status = total >= plan.pages.length ? 'done' : 'partial';
    await putBatch(batch);
    useComicJob.getState().finish(total >= plan.pages.length ? '✓ 已补齐全部页' : `⚠ 补了 ${ok} 页，仍缺 ${plan.pages.length - total} 页`, batchId);
  } catch (e: any) {
    useComicJob.getState().finish('✗ ' + (e?.message || String(e)), batchId);
  } finally { ctrl = null; }
}

/* ── 单页重绘：优先复用当时实际发送的提示词（原位覆盖该页）── */
export async function redrawPage(batchId: string, pageNo: number): Promise<void> {
  const cs = useComic.getState();
  const batch = await getBatch(batchId);
  if (!batch) throw new Error('批次不存在');
  const plan = batch.plan as ComicPlan;
  const rec = await getPage(`${batchId}_p${pageNo}`);
  const pg = plan.pages.find((p) => p.page === pageNo);
  const lang = plan.language || cs.language;
  const finalPrompt = rec?.finalPrompt || (pg ? buildPagePrompt(plan, pg, [], lang) : '');
  if (!finalPrompt) throw new Error('找不到该页的绘画提示词');
  const refs = cs.sendCharRefs && cs.service === 'chatimg' ? collectRefs(plan.characters) : { hints: [], images: [] };
  const img = await generateImage(cs.service, {
    prompt: finalPrompt, negative: cs.negative || undefined, size: cs.size || undefined,
    refImages: refs.images, label: `漫画·重绘第${pageNo}页`,
  });
  await putPage({ id: `${batchId}_p${pageNo}`, batchId, page: pageNo, dataUrl: img, pagePrompt: pg?.prompt || rec?.pagePrompt || '', finalPrompt, createdAt: Date.now() });
}
