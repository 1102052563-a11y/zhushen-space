import type { TextGenPreset, RegexScript } from '../store/settingsStore';

/* 我们的正则脚本 → SillyTavern 原生格式（酒馆可直接导入）。
   placement 编号映射回 ST 体系（我们 0=用户输入→ST 1，我们 1=AI输出→ST 2；存量 ST 旧码 2 保留），
   其余字段本项目本就无损保留（runOnEdit/substituteRegex/minDepth/maxDepth），缺省补 ST 默认值。 */
export function toStRegexScript(s: RegexScript): Record<string, unknown> {
  const stPlacement = [...new Set(s.placement.map((p) => (p === 0 ? 1 : 2)))];
  return {
    id: s.id,
    scriptName: s.scriptName,
    findRegex: s.findRegex,
    replaceString: s.replaceString,
    trimStrings: s.trimStrings ?? [],
    placement: stPlacement.length ? stPlacement : [2],
    disabled: !!s.disabled,
    markdownOnly: !!s.markdownOnly,
    promptOnly: !!s.promptOnly,
    runOnEdit: !!s.runOnEdit,
    substituteRegex: typeof s.substituteRegex === 'number' ? s.substituteRegex : 0,
    minDepth: typeof s.minDepth === 'number' ? s.minDepth : null,
    maxDepth: typeof s.maxDepth === 'number' ? s.maxDepth : null,
  };
}
export function toStRegexScripts(arr: RegexScript[] | undefined): Record<string, unknown>[] {
  return (arr ?? []).map(toStRegexScript);
}

/* ── 导出为 SillyTavern 可导入的预设 ─────────────────────────────────
   zhushen 内部预设是 { entries: STPromptEntry[] } 格式，SillyTavern 不认；ST 需要
   { prompts: [...], prompt_order: [{character_id, order:[...]}], 生成参数 }。
   本函数把内部 entries → ST prompts + prompt_order，并补齐 ST 的 8 个标准 marker
   （chatHistory/worldInfoBefore… 让 ST 有注入点），生成参数映射回 ST 字段。 */

// ST 标准结构 marker（按典型顺序）；缺哪个补哪个
const ST_MARKERS: { identifier: string; name: string }[] = [
  { identifier: 'worldInfoBefore', name: 'World Info (before)' },
  { identifier: 'personaDescription', name: 'Persona Description' },
  { identifier: 'charDescription', name: 'Char Description' },
  { identifier: 'charPersonality', name: 'Char Personality' },
  { identifier: 'scenario', name: 'Scenario' },
  { identifier: 'worldInfoAfter', name: 'World Info (after)' },
  { identifier: 'dialogueExamples', name: 'Chat Examples' },
  { identifier: 'chatHistory', name: 'Chat History' },
];

export function toSTPreset(preset: TextGenPreset): Record<string, unknown> {
  const entries = preset.entries ?? [];
  const custom = entries.filter((e) => !e.marker);            // zhushen 自定义内容块
  const existingMarkerIds = new Set(entries.filter((e) => e.marker).map((e) => e.identifier));

  // 1) 自定义块 → ST prompt（补全 ST 字段）
  const customPrompts = custom.map((e) => ({
    identifier: e.identifier,
    name: e.name || e.identifier,
    system_prompt: !!(e.system_prompt || e.role === 'system'),
    role: e.role || 'system',
    content: e.content || '',
    injection_position: typeof e.injection_position === 'number' ? e.injection_position : 0,
    injection_depth: typeof e.injection_depth === 'number' ? e.injection_depth : 4,
    forbid_overrides: false,
    marker: false,
  }));

  // 2) 已有 marker 原样保留 + 补齐缺失的标准 marker
  const keptMarkers = entries.filter((e) => e.marker).map((e) => ({
    identifier: e.identifier, name: e.name || e.identifier,
    system_prompt: true, marker: true, role: 'system', content: '',
  }));
  const addedMarkers = ST_MARKERS.filter((m) => !existingMarkerIds.has(m.identifier)).map((m) => ({
    identifier: m.identifier, name: m.name,
    system_prompt: true, marker: true, role: 'system', content: '',
  }));

  const prompts = [...customPrompts, ...keptMarkers, ...addedMarkers];
  const allIds = new Set(prompts.map((p) => p.identifier));

  // 3) prompt_order：前置框架 marker → 自定义系统块（depth 块靠 injection_position:1 在 ST 里浮动）→ chatHistory 末尾
  const orderHead = ['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples'];
  const orderTail = ['chatHistory'];
  const seq = [...orderHead, ...custom.map((e) => e.identifier), ...orderTail];

  const placed = new Set<string>();
  const order: { identifier: string; enabled: boolean }[] = [];
  const push = (id: string) => {
    if (!allIds.has(id) || placed.has(id)) return;
    placed.add(id);
    const c = custom.find((e) => e.identifier === id);
    order.push({ identifier: id, enabled: c ? c.enabled !== false : true });
  };
  for (const id of seq) push(id);
  for (const p of prompts) push(p.identifier);   // 兜底：把没排到的也加上

  // 4) 生成参数 → ST 字段
  const out: Record<string, unknown> = {
    name: preset.name,
    temperature: preset.temperature ?? 1,
    frequency_penalty: preset.frequency_penalty ?? 0,
    presence_penalty: preset.presence_penalty ?? 0,
    top_p: preset.top_p ?? 1,
    top_k: 0,
    stream_openai: preset.stream ?? true,
    prompts,
    prompt_order: [{ character_id: 100001, order }],
    extensions: { regex_scripts: toStRegexScripts(preset.regexScripts) },   // placement 映射回 ST 编号，酒馆直接可用
  };
  if (preset.max_tokens) out.openai_max_tokens = preset.max_tokens;
  if (preset.context_length) out.openai_max_context = preset.context_length;
  if (typeof preset.seed === 'number' && preset.seed !== -1) out.seed = preset.seed;
  return out;
}
