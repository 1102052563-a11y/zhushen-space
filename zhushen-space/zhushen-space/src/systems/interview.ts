/* ════════════════════════════════════════════
   🎤 大采访（借鉴 色色灵感状态栏V3.2 的大采访：选人+引档案+往期接续→旁路生成→杂志渲染→导出）
   - 独立旁路调用：resolveApiChain('interview', 正文API兜底)，与正文/演化互不干扰、产物不进正文上下文；
   - 行协议解析（与 promptRules.INTERVIEW_RULE 对齐）：标题:/导语:/问(名):/答(名):/旁白:/手记:；
   - 导出：自包含 HTML（内联样式·零外链），文本复制由面板做。
   UI：components/InterviewPanel.tsx（导航「采访」·社交联机组）。
════════════════════════════════════════════ */
import { useNpc } from '../store/npcStore';
import { useMisc } from '../store/miscStore';
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { usePlayer } from '../store/playerStore';
import { apiChatFallback } from './apiChat';
import { serializeNpcSnapshot } from './npcEvolutionHelpers';
import { buildPlayerGenContext } from './playerGenContext';
import { getPrompt } from '../store/promptOverrideStore';
import { INTERVIEW_RULE, NSFW_WRITING_RULE } from '../promptRules';
import type { InterviewRecord, InterviewSeg } from '../store/interviewStore';

export interface InterviewSetup {
  interviewers: string[];       // 采访者名（自由文本·默认「乐园周刊·姬记者」）
  intervieweeIds: string[];     // 被访 NPC id（≤2）
  includePlayer: boolean;       // 主角也上访谈席
  readDossier: boolean;         // 引用完整档案（关=只给名字+一句话，人物表现靠模型自由发挥）
  continueFrom?: { title: string; rawText: string };   // 往期接续（仅本次生效）
  extra?: string;               // 额外要求（仅本次生效）
}

/** 行协议解析（宽松：全/半角冒号都认；一行都认不出=段落空，面板回退渲染 rawText）。 */
export function parseInterview(text: string): { title: string; intro: string; epilogue: string; segments: InterviewSeg[] } {
  const out = { title: '', intro: '', epilogue: '', segments: [] as InterviewSeg[] };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^标题[:：]\s*(.+)$/.exec(line))) { out.title = out.title || m[1].trim(); continue; }
    if ((m = /^导语[:：]\s*(.+)$/.exec(line))) { out.intro = out.intro ? out.intro + '\n' + m[1].trim() : m[1].trim(); continue; }
    if ((m = /^手记[:：]\s*(.+)$/.exec(line))) { out.epilogue = out.epilogue ? out.epilogue + '\n' + m[1].trim() : m[1].trim(); continue; }
    if ((m = /^问[（(]([^)）]{1,24})[)）]\s*[:：]?\s*(.+)$/.exec(line))) { out.segments.push({ kind: 'q', speaker: m[1].trim(), text: m[2].trim() }); continue; }
    if ((m = /^答[（(]([^)）]{1,24})[)）]\s*[:：]?\s*(.+)$/.exec(line))) { out.segments.push({ kind: 'a', speaker: m[1].trim(), text: m[2].trim() }); continue; }
    if ((m = /^旁白[:：]\s*(.+)$/.exec(line))) { out.segments.push({ kind: 'nar', text: m[1].trim() }); continue; }
    // 未带前缀的续行：并进上一段（长回答被折行的兜底）
    const last = out.segments[out.segments.length - 1];
    if (last) last.text += '\n' + line;
  }
  return out;
}

/** 组装上下文（纯 store 读取）。 */
export function buildInterviewContext(setup: InterviewSetup): string {
  const M = useMisc.getState();
  const npcs = useNpc.getState().npcs;
  const L: string[] = [];
  L.push(`【栏目背景】地点：${(usePlayer.getState().profile.location || M.worldName || '乐园某处').trim()}｜世界：${M.worldName || '轮回乐园'}｜时间：${M.worldTime || M.paradiseTime || '不详'}`);
  L.push(`【采访者】${setup.interviewers.filter(Boolean).join('、') || '乐园周刊·姬记者'}`);
  const names: string[] = [];
  for (const id of setup.intervieweeIds.slice(0, 2)) {
    const n = npcs[id];
    if (!n) continue;
    const name = String(n.name || id).split('|')[0].trim();
    names.push(name);
    if (setup.readDossier) {
      L.push(`【被采访者档案·${name}（供保持人设一致，非剧中人所知）】\n${serializeNpcSnapshot(n).slice(0, 1600)}`);
    } else {
      L.push(`【被采访者·${name}】${String((n as any).background || '').slice(0, 80) || '（档案略）'}`);
    }
  }
  if (setup.includePlayer) {
    const pn = usePlayer.getState().profile.name || '主角';
    names.push(pn);
    if (setup.readDossier) L.push(`【被采访者档案·${pn}（主角）】\n${buildPlayerGenContext().slice(0, 1600)}`);
    else L.push(`【被采访者·${pn}】（主角本人）`);
  }
  L.push(`【被采访者名单】${names.join('、') || '（空）'}`);
  if (setup.continueFrom) {
    L.push(`【往期采访参考（接续素材·可引用「上次你说过…」，非本期正文）】\n《${setup.continueFrom.title}》\n${setup.continueFrom.rawText.slice(0, 1200)}`);
  }
  if (setup.extra?.trim()) L.push(`【本期额外要求】${setup.extra.trim().slice(0, 300)}`);
  return L.join('\n\n');
}

/** 旁路生成一期采访（一次调用）。抛错=人话错误信息。 */
export async function runInterview(setup: InterviewSetup): Promise<Omit<InterviewRecord, 'id' | 'createdAt'>> {
  if (!setup.intervieweeIds.length && !setup.includePlayer) throw new Error('先选至少一位被采访者');
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('interview', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（回退正文 API 也未配置）——先到 设置→综合设置 配正文接口');
  const ctx = buildInterviewContext(setup);
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: getPrompt('NSFW_WRITING_RULE', NSFW_WRITING_RULE) },
    { role: 'system', content: getPrompt('INTERVIEW_RULE', INTERVIEW_RULE) },
    { role: 'user', content: `${ctx}\n\n请撰写本期大采访，严格按行协议输出。` },
  ], { label: '大采访', timeoutMs: 180000 });
  const raw = String(content ?? '').trim();
  if (!raw) throw new Error('模型没有返回内容，请重试');
  const parsed = parseInterview(raw);
  const M = useMisc.getState();
  const npcs = useNpc.getState().npcs;
  const names = setup.intervieweeIds.map((id) => String(npcs[id]?.name || id).split('|')[0].trim());
  if (setup.includePlayer) names.push(usePlayer.getState().profile.name || '主角');
  return {
    title: parsed.title || '未命名采访',
    intro: parsed.intro,
    epilogue: parsed.epilogue,
    segments: parsed.segments,
    rawText: raw,
    interviewers: setup.interviewers.filter(Boolean),
    interviewees: names,
    location: usePlayer.getState().profile.location || M.worldName || '',
    worldName: M.worldName || '',
    worldTime: M.worldTime || M.paradiseTime || '',
  };
}

const esc = (s: string): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 导出自包含 HTML（档案解密皮·内联样式零外链），供下载分享。 */
export function interviewToHtml(r: InterviewRecord): string {
  const segs = r.segments.length
    ? r.segments.map((s) =>
        s.kind === 'nar'
          ? `<p class="nar">${esc(s.text)}</p>`
          : `<div class="${s.kind}"><span class="who">${esc(s.speaker ?? (s.kind === 'q' ? '记者' : '受访'))}</span><p>${esc(s.text)}</p></div>`,
      ).join('\n')
    : `<pre class="raw">${esc(r.rawText)}</pre>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.title)}</title><style>
body{margin:0;background:#0b0e14;color:#cbd5e1;font:15px/1.75 system-ui,'PingFang SC','Microsoft YaHei',sans-serif}
.wrap{max-width:680px;margin:0 auto;padding:32px 20px 48px;border-left:1px dashed #334155;border-right:1px dashed #334155;min-height:100vh;box-sizing:border-box}
.stamp{display:inline-block;border:2px solid #b45309;color:#f59e0b;padding:2px 10px;font-size:11px;letter-spacing:4px;transform:rotate(-3deg);margin-bottom:14px}
h1{font-size:22px;color:#f1f5f9;margin:0 0 6px}
.meta{font-size:12px;color:#64748b;margin-bottom:18px;letter-spacing:1px}
.intro{color:#94a3b8;font-style:italic;border-left:3px solid #b45309;padding-left:12px;margin-bottom:22px;white-space:pre-wrap}
.q,.a{display:flex;gap:10px;margin:14px 0}
.q .who{color:#f59e0b;border:1px solid #b4530966;background:#f59e0b12}
.a .who{color:#7dd3fc;border:1px solid #0ea5e966;background:#0ea5e912}
.who{flex:none;height:fit-content;font-size:12px;padding:1px 8px;border-radius:999px;margin-top:2px}
.q p,.a p{margin:0;white-space:pre-wrap}
.q p{color:#e2b96f}
.nar{color:#64748b;font-style:italic;font-size:13px;margin:10px 0;white-space:pre-wrap}
.epi{margin-top:26px;padding-top:14px;border-top:1px dashed #334155;color:#94a3b8;font-size:13px;white-space:pre-wrap}
.epi::before{content:'✎ 采访手记';display:block;color:#f59e0b;font-size:11px;letter-spacing:3px;margin-bottom:6px}
.raw{white-space:pre-wrap;font:13px/1.7 inherit;color:#94a3b8}
.foot{margin-top:30px;text-align:center;font-size:10px;color:#475569;letter-spacing:2px}
</style></head><body><div class="wrap">
<div class="stamp">乐园周刊 · 大采访</div>
<h1>${esc(r.title)}</h1>
<div class="meta">${esc(r.worldName || '轮回乐园')}｜${esc(r.worldTime)}｜${esc(r.location)}<br>采访：${esc(r.interviewers.join('、') || '乐园周刊')}　受访：${esc(r.interviewees.join('、'))}</div>
${r.intro ? `<div class="intro">${esc(r.intro)}</div>` : ''}
${segs}
${r.epilogue ? `<div class="epi">${esc(r.epilogue)}</div>` : ''}
<div class="foot">ZHUSHEN SPACE · INTERVIEW ARCHIVE</div>
</div></body></html>`;
}

/** 复制用纯文本。 */
export function interviewToText(r: InterviewRecord): string {
  const L = [`《${r.title}》`, `${r.worldName}｜${r.worldTime}｜${r.location}`, `采访：${r.interviewers.join('、')}　受访：${r.interviewees.join('、')}`, ''];
  if (r.intro) L.push(r.intro, '');
  if (r.segments.length) {
    for (const s of r.segments) {
      if (s.kind === 'nar') L.push(`（${s.text}）`);
      else L.push(`${s.kind === 'q' ? '问' : '答'}（${s.speaker ?? ''}）：${s.text}`);
    }
  } else L.push(r.rawText);
  if (r.epilogue) L.push('', `手记：${r.epilogue}`);
  return L.join('\n');
}
