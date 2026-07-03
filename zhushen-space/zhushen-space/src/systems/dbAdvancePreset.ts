/* 数据库推进预设（Stitches 格式）· 解析 + 占位符引擎 + 标签抽取 ──────────────
   原 SillyTavern「数据库/记忆表格」扩展的推进预设：`plotTasks`[召回→推进] 多段管线，
   最后 `finalSystemDirective` 把 stage/scene/recall 注回正文模型写散文。
   zhushen 把它当「剧情指导/导演」的规划层跑（召回→推进两次独立 AI 调用产出结构化 stage/scene/tabletop），
   **正文预设照常写最终散文**——预设只做规划，不写正文。编排见 App.tsx runDbAdvancePipeline。

   占位符：$U 主角 / $C 卡片简述 / $1 背景设定 / $5 已发生事件概览 / $7 前文剧情 / $8 本轮输入
           {{tabletop}} 上轮跟踪表 / {{stage}} {{scene}} {{recall}}（推进/召回产出·供 finalSystemDirective）。 */

export interface DbAdvanceMessage { role: string; content: string; }

export interface DbAdvanceModule {
  id: string;
  name: string;                // "召回" / "推进"
  promptGroup: DbAdvanceMessage[];
  extractTags: string;         // 逗号分隔要抽取的输出标签，如 "stage,scene" / "recall"
  extractInjectTags: string;   // 存作下轮注入的标签，如 "tabletop"
  minLength: number;
  order: number;
}

export interface DbAdvancePreset {
  name: string;
  contextExcludeRules: { start: string; end: string }[];
  plotTasks: DbAdvanceModule[];    // 已按 order 升序（召回 0 → 推进 1）
  finalSystemDirective: string;    // 含 $8 / {{stage}} / {{scene}} / {{recall}}
}

/** 解析数据库预设 JSON（数组[对象] 或 直接对象）→ 结构化。无 plotTasks 则返回 null。 */
export function parseDbAdvancePreset(raw: unknown): DbAdvancePreset | null {
  try {
    const obj = Array.isArray(raw) ? raw[0] : raw;
    if (!obj || typeof obj !== 'object') return null;
    const o = obj as Record<string, unknown>;
    const tasks: DbAdvanceModule[] = (Array.isArray(o.plotTasks) ? o.plotTasks : [])
      .map((t: Record<string, unknown>) => ({
        id: String(t.id ?? ''),
        name: String(t.name ?? ''),
        promptGroup: (Array.isArray(t.promptGroup) ? t.promptGroup : [])
          .map((m: Record<string, unknown>) => ({ role: String(m.role ?? 'system'), content: String(m.content ?? '') })),
        extractTags: String(t.extractTags ?? ''),
        extractInjectTags: String(t.extractInjectTags ?? ''),
        minLength: Number(t.minLength ?? 0),
        order: Number(t.order ?? 0),
      }))
      .sort((a: DbAdvanceModule, b: DbAdvanceModule) => a.order - b.order);
    if (!tasks.length) return null;
    return {
      name: String(o.name ?? '数据库推进预设'),
      contextExcludeRules: (Array.isArray(o.contextExcludeRules) ? o.contextExcludeRules : [])
        .map((r: Record<string, unknown>) => ({ start: String(r.start ?? ''), end: String(r.end ?? '') }))
        .filter((r: { start: string; end: string }) => r.start),
      plotTasks: tasks,
      finalSystemDirective: String(o.finalSystemDirective ?? ''),
    };
  } catch { return null; }
}

export interface DbAdvanceCtx {
  U?: string; C?: string; bg?: string; overview?: string; prev?: string; input?: string;   // $U/$C/$1/$5/$7/$8
  tabletop?: string;                                   // {{tabletop}} 上轮
  stage?: string; scene?: string; recall?: string;     // {{stage}}/{{scene}}/{{recall}} 本轮产出
}

/** 占位符替换：$U/$C/$1/$5/$7/$8 + {{tabletop}}/{{stage}}/{{scene}}/{{recall}}。缺省→空串。 */
export function resolveDbPlaceholders(text: string, ctx: DbAdvanceCtx): string {
  if (!text) return '';
  const dollar: Record<string, string> = {
    '$U': ctx.U ?? '', '$C': ctx.C ?? '', '$1': ctx.bg ?? '',
    '$5': ctx.overview ?? '', '$7': ctx.prev ?? '', '$8': ctx.input ?? '',
  };
  let out = text;
  // 此格式仅 $1/$5/$7/$8/$U/$C 六个 $ 占位（无 $10 之类歧义）→ 直接 split-join 替换
  for (const k of Object.keys(dollar)) out = out.split(k).join(dollar[k]);
  out = out
    .replace(/\{\{tabletop\}\}/gi, ctx.tabletop ?? '')
    .replace(/\{\{stage\}\}/gi, ctx.stage ?? '')
    .replace(/\{\{scene\}\}/gi, ctx.scene ?? '')
    .replace(/\{\{recall\}\}/gi, ctx.recall ?? '');
  return out;
}

/** 把一个模块的 promptGroup 解析成带占位符替换的消息数组（role 归一小写）。 */
export function buildModuleMessages(mod: DbAdvanceModule, ctx: DbAdvanceCtx): DbAdvanceMessage[] {
  return (mod?.promptGroup ?? []).map((m) => ({
    role: (m.role || 'system').toLowerCase(),
    content: resolveDbPlaceholders(m.content, ctx),
  }));
}

/** 抽取输出里某标签内容（<tag ...>...</tag>·取最后一个·容忍属性）。无则 ''。 */
export function extractTag(text: string, tag: string): string {
  if (!text || !tag) return '';
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let m: RegExpExecArray | null; let last = '';
  while ((m = re.exec(text)) !== null) last = m[1];
  return last.trim();
}

/** 按 extractTags("a,b") 抽多个标签 → { a, b }（各取最后一个）。 */
export function extractTags(text: string, tagsCsv: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of (tagsCsv || '').split(',').map((s) => s.trim()).filter(Boolean)) out[t] = extractTag(text, t);
  return out;
}

const RE_ESC = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 按 contextExcludeRules 剥掉 <disclaimer>…</disclaimer>/<thinking>… 等技术块（喂下游前清理）。end 空则剥到下一个 `<` 或结尾。 */
export function stripExcluded(text: string, rules: { start: string; end: string }[]): string {
  let out = text || '';
  for (const r of rules || []) {
    if (!r.start) continue;
    const s = RE_ESC(r.start);
    out = r.end
      ? out.replace(new RegExp(`${s}[\\s\\S]*?${RE_ESC(r.end)}`, 'gi'), '')
      : out.replace(new RegExp(`${s}[\\s\\S]*?(?=<|$)`, 'gi'), '');
  }
  return out;
}

/** 解析 finalSystemDirective（$8 + {{stage}} + {{scene}} + {{recall}} → 实际注入正文的规划文本）。 */
export function resolveFinalDirective(preset: DbAdvancePreset, ctx: DbAdvanceCtx): string {
  return resolveDbPlaceholders(preset?.finalSystemDirective ?? '', ctx).trim();
}

/** 取某个模块（按名字，如 "召回"/"推进"）；找不到返回 undefined。 */
export function findModule(preset: DbAdvancePreset, name: string): DbAdvanceModule | undefined {
  return preset?.plotTasks?.find((t) => t.name === name);
}
