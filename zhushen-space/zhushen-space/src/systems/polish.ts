/* ✨ 正文校正（借鉴 story-oracle「校正模式」思想·代码全自写——上游无 license，只借交互设计）
   事后治疗侧，与 PROSE_BLACKLIST_RULE（注入侧预防）组成闭环：
   1. 前端先把楼层 content 拆成「散文段 / 受保护块」——结构块压根不进模型、按原位拼回（检测收据=拆分产物，权威准确）；
   2. 多个散文段用 ⟦P{n}⟧ 分段标记行合并成**一次调用**；回包必须原样带回全部标记，缺失/乱序=判失败抛错（绝不凑合硬拼）；
   3. 应用在 App 侧（楼层操作行 ✨ 按钮）：saveBranchPoint 先把原稿存成 🌿 支线（可回收）→ saveMessageEdit 替换 content
      （与手动编辑楼层同语义：丢 raw）。
   ⚠ 楼层 content 已是剥过 <state>/<upstore>/思维链 的展示视图（App 存楼层时已剥、think 单独存字段），这里的
     受保护块是防「结算块 / HTML 美化壳 / 代码块 / 配图 markdown」被模型改写的第二道保险。
   UI：components/PolishModal.tsx；提示词：promptRules.POLISH_RULE（预设中心可改）；接口：featureKey 'polish'。 */
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { getPrompt } from '../store/promptOverrideStore';
import { POLISH_RULE, PROSE_BLACKLIST_RULE, NSFW_WRITING_RULE } from '../promptRules';

export interface PolishSeg { kind: 'prose' | 'keep'; text: string; label?: string }
export type PolishStrength = 'light' | 'deep';
export interface PolishPrefs { goals: string[]; strength: PolishStrength }

/** 校正目标（借 story-oracle 的五目标概念，文案按本作病灶重写；def=默认勾选）。 */
export const POLISH_GOALS: { id: string; label: string; directive: string; def: boolean }[] = [
  { id: 'cliche',  label: 'AI 八股 / 套话',    def: true,  directive: '清洗 AI 八股与万能套话（重点见下方陈词滥调参考清单）：改成可拍摄的具体动作、视线落点、呼吸与距离。' },
  { id: 'dialog',  label: '对话机械感',        def: true,  directive: '治「我说你答」的乒乓对白：允许打断、沉默、答非所问、动作夹叙；让每个角色说话像 TA 自己。' },
  { id: 'numeric', label: '数字播报感',        def: true,  directive: '删散文里的游戏参数播报腔（「好感度上升」「成功率约70%」这类）——只清散文措辞，不碰任何结构模块。' },
  { id: 'verbose', label: '描写拖沓 / 流水账',  def: true,  directive: '收紧拖沓与流水账：删重复描写与空转铺垫，长句拆短，突出关键画面。' },
  { id: 'pseudo',  label: '玄学写成理科',      def: false, directive: '修「玄学被写成理科」的伪科学解释腔（灵力守恒/魔法量子化一类），改回世界观内的感受化表达。' },
];

const STRENGTH_LINE: Record<PolishStrength, string> = {
  light: '轻校：只动明显命中目标的句子；保留原文句序与叙事声音；总改动量控制在两成以内。',
  deep:  '精校：可在段内重排、合并、拆分句子，主动收紧节奏；但事实/人称/尺度铁则依然不可违反；总改动量控制在五成以内。',
};

/* ── 偏好持久化（设备级小偏好，plain localStorage，不进 saveManager/configExport）── */
const PREFS_KEY = 'drpg-polish-prefs';
export function loadPolishPrefs(): PolishPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.goals)) {
        return { goals: o.goals.filter((g: unknown): g is string => typeof g === 'string'), strength: o.strength === 'deep' ? 'deep' : 'light' };
      }
    }
  } catch { /* 坏档回默认 */ }
  return { goals: POLISH_GOALS.filter((g) => g.def).map((g) => g.id), strength: 'light' };
}
export function savePolishPrefs(p: PolishPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* 存储满忽略 */ }
}

/* ── 受保护块拆分 ──────────────────────────────────────────────
   形态贴 stateParser.stripStateBlocks / stateApply.stripVitalsBlocks 等的真实正则；
   content 里理应已被剥掉的（state/upstore…）也留着当防御——万一旧档/别的通道漏进来，绝不送模型。 */
const BLOCK_RES: { label: string; re: () => RegExp }[] = [
  { label: '代码块',   re: () => /```[\s\S]*?```/g },
  { label: '指令块',   re: () => /<(state|upstore|edit|tableEdit)\b[^>]*>[\s\S]*?<\/\1>/gi },
  { label: '战斗块',   re: () => /<battle\b[^>]*\/>|<battle\b[^>]*>[\s\S]*?<\/battle>/gi },
  { label: '思维链',   re: () => /<(think|thinking|thought)\b[^>]*>[\s\S]*?<\/\1>/gi },
  { label: '结算块',   re: () => /<(状态结算|世界之源|检定结果|击杀结算|世界结算)>[\s\S]*?<\/\1>/g },
  { label: '结算块',   re: () => /[ \t]*\*{0,2}【(状态结算|击杀结算|世界结算|最终清算)】[\s\S]*?(?=\n\s*\*{0,2}【|$)/g },
  { label: '击杀块',   re: () => /<kill>[\s\S]*?<\/kill>/gi },
  { label: '折叠块',   re: () => /<details\b[\s\S]*?<\/details>/gi },
  { label: '样式块',   re: () => /<style\b[\s\S]*?<\/style>/gi },
  { label: '表格',     re: () => /<table\b[\s\S]*?<\/table>/gi },
  { label: '配图',     re: () => /!\[[^\]]*\]\([^)\n]*\)|<img\b[^>]*>/gi },
];

/** 美化壳兜底：<div …> 到最后一个 </div> 的最外层跨度整段保护（嵌套 div 用非贪婪会拆坏，宁可多保护）。 */
function outermostDivRange(text: string): { start: number; end: number } | null {
  const m = /<div\b/i.exec(text);
  if (!m) return null;
  const lastClose = text.toLowerCase().lastIndexOf('</div>');
  if (lastClose < 0 || lastClose < m.index) return null;
  return { start: m.index, end: lastClose + '</div>'.length };
}

function pushProse(segs: PolishSeg[], text: string): void {
  if (!text) return;
  // 块与块之间的短间隙（换行/几个字）不值得送模型，原样保留
  if (text.replace(/\s+/g, '').length < 12) segs.push({ kind: 'keep', text });
  else segs.push({ kind: 'prose', text });
}

/** 拆分楼层文本 → 散文段/受保护块（segs 按原位串接 === 原文，测试守卫此不变量）。 */
export function splitProtectedBlocks(text: string): PolishSeg[] {
  const s = String(text ?? '');
  if (!s) return [];
  const ranges: { start: number; end: number; label: string }[] = [];
  const div = outermostDivRange(s);
  if (div) ranges.push({ ...div, label: 'HTML 容器' });
  const overlaps = (a: number, b: number) => ranges.some((r) => a < r.end && b > r.start);
  for (const { label, re } of BLOCK_RES) {
    const rx = re();
    let m: RegExpExecArray | null;
    while ((m = rx.exec(s)) !== null) {
      if (m[0].length === 0) { rx.lastIndex++; continue; }
      const a = m.index, b = m.index + m[0].length;
      if (!overlaps(a, b)) ranges.push({ start: a, end: b, label });
    }
  }
  ranges.sort((x, y) => x.start - y.start);
  const segs: PolishSeg[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) pushProse(segs, s.slice(pos, r.start));
    segs.push({ kind: 'keep', text: s.slice(r.start, r.end), label: r.label });
    pos = r.end;
  }
  if (pos < s.length) pushProse(segs, s.slice(pos));
  return segs;
}

/** 检测收据：受保护块标签清单（同名计数），给玩家看「哪些没送模型」。 */
export function polishReceipt(segs: PolishSeg[]): string[] {
  const counts = new Map<string, number>();
  for (const g of segs) if (g.kind === 'keep' && g.label) counts.set(g.label, (counts.get(g.label) ?? 0) + 1);
  return [...counts.entries()].map(([label, n]) => (n > 1 ? `${label}×${n}` : label));
}

export function proseCharCount(segs: PolishSeg[]): number {
  return segs.filter((g) => g.kind === 'prose').reduce((n, g) => n + g.text.replace(/\s+/g, '').length, 0);
}

/* ── 分段标记协议 ── */
const MARK = (n: number) => `⟦P${n}⟧`;

/** 把散文段拼成喂模型的载荷：第 2 段起，段与段之间夹一行 ⟦P{i}⟧（i 从 2 数）。 */
export function joinProseForModel(segs: PolishSeg[]): string {
  const prose = segs.filter((g) => g.kind === 'prose');
  return prose.map((g, i) => (i === 0 ? g.text.trim() : `${MARK(i + 1)}\n${g.text.trim()}`)).join('\n');
}

/** 校正稿按标记拆回各散文段（保留原段首尾空白），受保护块原位不动。标记缺失/乱序/多出=抛错。 */
export function mergePolished(segs: PolishSeg[], reply: string): string {
  let body = String(reply ?? '').trim();
  const fence = body.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);   // 模型偶发用代码围栏包整篇 → 剥壳
  if (fence) body = fence[1].trim();
  const proseCount = segs.filter((g) => g.kind === 'prose').length;
  if (proseCount === 0) throw new Error('本楼没有可校正的散文段');
  const marks = [...body.matchAll(/⟦P(\d+)⟧/g)].map((m) => Number(m[1]));
  const expect = Array.from({ length: proseCount - 1 }, (_, i) => i + 2);
  if (marks.length !== expect.length || marks.some((n, i) => n !== expect[i])) {
    throw new Error(`分段标记没有原样带回（期望 ${expect.length} 个、收到 ${marks.length} 个）——请点「重新校正」重试`);
  }
  const parts = body.split(/⟦P\d+⟧/).map((p) => p.trim());
  if (parts.length !== proseCount) throw new Error('分段拆分数量对不上，请重试');
  let pi = 0;
  return segs.map((g) => {
    if (g.kind !== 'prose') return g.text;
    const lead = g.text.match(/^\s*/)?.[0] ?? '';
    const tail = g.text.match(/\s*$/)?.[0] ?? '';
    return lead + parts[pi++] + tail;
  }).join('');
}

/* ── 一次校正调用 ── */
export interface PolishRunOpts {
  text: string;
  goals: string[];
  strength: PolishStrength;
  extra?: string;
  onDelta?: (accumulated: string) => void;
}
export interface PolishResult { polished: string; receipt: string[]; proseChars: number; changed: boolean }

export async function runPolish(opts: PolishRunOpts): Promise<PolishResult> {
  const segs = splitProtectedBlocks(opts.text);
  const proseChars = proseCharCount(segs);
  if (proseChars < 40) throw new Error('本楼可校正的散文太少（多为结构化内容），不适合校正');
  const goalLines = POLISH_GOALS.filter((g) => opts.goals.includes(g.id)).map((g) => `· ${g.label}：${g.directive}`).join('\n');
  if (!goalLines) throw new Error('至少勾选一个校正目标');
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('polish', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（回退正文 API 也未配置）——先到 设置→综合设置 配正文接口，或在本窗「接口路由」单独指定');
  const sys = [
    getPrompt('NSFW_WRITING_RULE', NSFW_WRITING_RULE),
    getPrompt('POLISH_RULE', POLISH_RULE),
    `【本次校正目标】\n${goalLines}\n【校正力度】${STRENGTH_LINE[opts.strength]}${opts.extra?.trim() ? `\n【玩家附加要求】${opts.extra.trim().slice(0, 300)}` : ''}`,
    `【陈词滥调参考清单（视为重点病灶）】\n${getPrompt('PROSE_BLACKLIST_RULE', PROSE_BLACKLIST_RULE)}`,
  ];
  const payload = joinProseForModel(segs);
  const { content } = await apiChatFallback(chain, [
    ...sys.map((c) => ({ role: 'system', content: c })),
    { role: 'user', content: `【待校正正文】\n${payload}\n\n现在输出校正后的正文全文（分段标记行原样保留）：` },
  ], { label: '正文校正', timeoutMs: 240000, rawLang: true, onDelta: opts.onDelta });
  const polished = mergePolished(segs, String(content ?? ''));
  return { polished, receipt: polishReceipt(segs), proseChars, changed: polished !== opts.text };
}
