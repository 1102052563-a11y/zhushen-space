/* ════════════════════════════════════════════════════════════════════════
   轮回乐园 正文预设 · 变量驱动重写生成器
   ------------------------------------------------------------------------
   按「入门指南」的变量驱动架构重写 Claude / DeepSeek / Gemini 三份预设：
     变量初始化(清空) → 破限/世界/系统块 → 文风/角色块 → 功能区(setvar/addvar 写变量)
     → 三段思维链(开始/思考ing/结束·用 getvar 读变量) → 输出格式(getvar 总装) → 启动/确认/prefill
   · 共享块逐字沿用现有内容(从当前 JSON 读取，不改一字)；只在「模型适配层」分叉。
   · 适配 zhushen 前端 stMacros 引擎：setvar/addvar/getvar/trim/// 跨块共享上下文，按数组顺序求值。
   · 末尾自带宏求值自检：断言无残留 {{}}、变量正确解析。
   用法：node _gen_lunhui_presets.cjs   （在仓库根运行）
   ════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '正文预设');                       // 写入目标
const SRC_DIR = path.join(__dirname, '_lunhui_preset_backup_20260624'); // 原始素材(共享/模型块原文)——保证可重复运行
const FILES = {
  Claude:   '轮回乐园-Claude.json',
  DeepSeek: '轮回乐园-DeepSeek.json',
  Gemini:   '轮回乐园-Gemini.json',
};
const ZH = { Claude: 'Claude', DeepSeek: 'DeepSeek', Gemini: 'Gemini' };
const WORDS = { Claude: [2000, 3500], DeepSeek: [1500, 2500], Gemini: [1500, 2500] };

if (!fs.existsSync(SRC_DIR)) {
  console.error(`❌ 找不到原始素材目录 ${SRC_DIR}\n请先把三份「未改造的」原始预设放回该目录(本脚本只从这里取共享/模型块原文，再写入 正文预设/)。`);
  process.exit(1);
}
const read = (f) => JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8'));
const cur = {}; for (const k in FILES) cur[k] = read(FILES[k]);
const bmap = (p) => { const m = {}; for (const b of p.prompts) m[b.identifier] = b; return m; };
const M = {}; for (const k in cur) M[k] = bmap(cur[k]);
const SH = M.Claude;                 // 共享块以 Claude 版为准(三版逐字相同)
const V = (id) => SH[id].content;    // 取共享块原文

// ── 块工厂 ──────────────────────────────────────────────────────────────
const sysblk = (identifier, name, content, opts = {}) => ({
  identifier, name, role: 'system', content,
  system_prompt: true, marker: false,
  ...(opts.depth != null ? { injection_position: 1, injection_depth: opts.depth } : {}),
});
const roleblk = (identifier, name, role, content) => ({
  identifier, name, role, content, system_prompt: false, marker: false,
});
const depthOf = (b) => (b && b.injection_position === 1 ? (b.injection_depth ?? 4) : 4);

// setvar 包裹：把整段内容写进变量，块本身求值后为空(不进系统提示)，供后续 getvar 读取
function wrapSetvar(varName, content) {
  if (content.includes('}}')) throw new Error('wrapSetvar 内容含 }} ：' + varName);
  return `{{setvar::${varName}::\n${content}\n}}{{trim}}`;
}

// ── 新增·共享块文案 ─────────────────────────────────────────────────────
const GUIDE = (model) => `【本预设说明 · 仅编辑器内可见，本块未启用、不发给模型】
轮回乐园 · 正文预设（${ZH[model]} 版）—— 按「变量驱动」架构重写，配 zhushen 前端使用。
· 发送顺序＝本列表自上而下的数组顺序；prompt_order 只控开关、不控顺序，要调序请拖动条目本身。
· 变量机制：开头「变量初始化」先清空全部变量；下方各「功能块」用 setvar/addvar 写入；「思维链」与「输出格式」用 getvar 读取。换效果只需开关功能块，不必动思维链。
· 模型适配：本文件为 ${ZH[model]} 版，破限增强 / 反八股 / 动笔前思考 / 篇幅字数 / 温度 / 正则 均按 ${ZH[model]} 脾性调校。换模型请挂对应接口并选对应预设（Claude / DeepSeek / Gemini 三份），切模型时预设与路由一起切，勿互相 fallback。
· 视角：默认第三人称限知；「视角」组里五选一（只启用一个）；另可独立开「＋内心独白」。前端「设置→叙事人称」若开启，会以最高优先级覆盖本组。
· 对话功能：「转述/扩写」「防转述」「增加对白」三个补丁默认关，按需开（开启即追加进思维链补丁）。
· 玩家自主权铁则：默认关闭；一旦开启即最高优先级，绝不替主角做任何主动决定。
· 成人向：「成人向·写作质量」块在不需要时可直接禁用。
（本块保持禁用即可，仅作说明。）`;

const VAR_INIT = `{{//变量初始化：每次生成先清空全部变量，再由下方启用的功能块重新写入。带 :: 结尾即设为空。改动前请先读「① 说明」块。}}
{{setvar::output_lang::}}{{setvar::pov_rules::}}{{setvar::think_chain::}}{{setvar::anti_slop::}}{{setvar::word_min::}}{{setvar::word_max::}}{{trim}}`;

const COT_START = `【动笔前 · 思考】落笔前，先在 <think>…</think> 标签里完成一轮推演——这是给你自己的草稿，对读者完全隐藏（正文里绝不解释思考、不留分析痕迹、不写寒暄与作者注）。
- 先确认两件事：本轮叙事语言＝{{getvar::output_lang}}；叙事人称与视角遵循——{{getvar::pov_rules}}
- 然后按下面的步骤逐项推演：`;

// 思维链补丁：开启了「对话功能」等补丁才有内容，默认空→不显示(无残留)
const COT_BODY_TAIL = `
{{getvar::think_chain}}`;

const COT_END = `【落笔前 · 最后三道闸（仍在 <think> 内完成，逐项过）】
① 反八股自检——对照下面这份清单，逐条核对并改掉本段已经犯的：
{{getvar::anti_slop}}
② 防 OOC——在场 NPC（尤其同人原作世界里的原作角色）有没有降智、霸总腔、无理由倒贴主角、脱离原设？有就按「NPC 自主」「同人世界·原作融入」两块改回；同人世界还要核对其原作底色。
③ 玩家自主权——若已启用「抢话与防抢话·强化」铁则，严格遵守、凌驾一切：玩家这回合没写出的主角主动言行，一个字都不许替。
确认无误后写 </think>，随即开始正文；正文里绝不出现任何思考痕迹、分析术语或 <think> 标签。`;

const OUTPUT_FORMAT = `【输出格式 · 总装】严格按下面的结构产出本回合内容：
1) 先输出 <think>…</think> 思考块（按上文「动笔前思考」的要求，对读者隐藏，前端会自动剥除）。
2) 然后直接输出小说正文本体——用 {{getvar::output_lang}} 书写；不加任何标题、不加 <content> 之类包裹标签、不写"以下是正文""好的，这就为你续写"之类开场白。篇幅严格遵循上文「篇幅·字数」铁则：目标 {{getvar::word_min}}–{{getvar::word_max}} 字，不足下限绝不收尾。
3) 正文末尾，按系统随后给出的格式追加 <state> 块同步主角位置/外观/状态——照系统给的格式输出即可，不自创状态格式，也不输出"行动选项""剧情摘要"等正文之外的元信息。
4) 若上下文（世界书）定义了 【…】模块化输出块（结算/动作日志/任务推进/登场/离场 等），照其规范如常输出，这些块不受文风与反八股约束（须保持精确）。`;

const CLAUDE_PREFILL = `<think>
好的，我先在脑内完成这一轮推演——确认语言与视角、过一遍在场角色、排好节拍、做完反八股与防 OOC 自检，正文里不留任何思考痕迹。`;

// POV 五选一 + 内心独白
const POV = {
  pov_third_limited: { name: '视角·第三人称限知（默认开 · 五选一）', on: true,
    rule: '第三人称 · 限知视角——贴住当前视角人物，只呈现他此刻能看到、听到、感觉到的；不读心、不预知、不替读者下判断，叙述本身带上他的局限。' },
  pov_third_god: { name: '视角·第三人称全知（五选一）', on: false,
    rule: '第三人称 · 全知视角——可在不同人物间切换视点、可俯瞰全局与因果，但克制使用，不滥用上帝口吻替读者总结或说教。' },
  pov_first_char: { name: '视角·第一人称(主角"我")（五选一）', on: false,
    rule: '第一人称——以主角"我"的口吻叙事，只写"我"当下能感知到的；"我"的主动决定仍交给玩家，不替"我"做选择。' },
  pov_first_user: { name: '视角·第一人称(玩家代入)（五选一）', on: false,
    rule: '第一人称（玩家代入）——以玩家所扮主角的"我"叙事；主角的被动遭遇与即时感官如实写，主动选择仍留给玩家。' },
  pov_second: { name: '视角·第二人称("你")（五选一）', on: false,
    rule: '第二人称——以"你"称呼主角叙事（此处"你"特指玩家所扮的主角，非泛指读者）；主角主动选择仍交给玩家。' },
};
const FN_INNER = `{{addvar::pov_rules::
（追加）可适度写视角人物的内心独白与念头，但点到为止、与上面的视角/限知一致，不借内心话泄露他不可能知道的信息。}}{{trim}}`;

// 对话功能补丁(追加进 think_chain)
const DLG = {
  fn_relay: { name: '对话·转述/扩写（默认关）',
    rule: '· 转述/扩写：玩家输入较简短时，把它当作本回合剧情指导，润色并扩写成完整场景，但不超出玩家的安排、不替玩家做任何主动决定。' },
  fn_no_relay: { name: '对话·防转述（默认关）',
    rule: '· 防转述：不要把玩家这回合的话或动作原样复述、回显一遍才开始，直接从它之后接着往下写。' },
  fn_dialogue_more: { name: '对话·增加对白（默认关）',
    rule: '· 增加对白：让在场 NPC 多开口，用有来有往的对话推进剧情，少用旁白盖过；每个角色保持各自可辨识的声口。' },
};
const dlgBlk = (rule) => `{{addvar::think_chain::\n${rule}\n}}{{trim}}`;

// 篇幅块：写 word_min/word_max 变量(供输出格式引用)，并把原 prose_length 详则原文常驻发送(深注入·贴近生成)
function lengthBlock(model, proseLengthText) {
  const [lo, hi] = WORDS[model];
  return `{{setvar::word_min::${lo}}}{{setvar::word_max::${hi}}}{{trim}}\n${proseLengthText}`;
}

// ── 组装单份预设 ────────────────────────────────────────────────────────
function buildPreset(model) {
  const mm = M[model];
  const B = [];

  // 准备区
  B.push(sysblk('_guide', '① 说明 · 变量驱动架构（未启用 · 仅供查看）', GUIDE(model)));
  B.push(sysblk('var_init', '② 变量初始化（别动）', VAR_INIT));
  B.push(sysblk('fn_output_lang', '③ 输出语言＝简体中文', '{{setvar::output_lang::简体中文}}{{trim}}'));

  // 破限 / 世界 / 系统
  B.push(sysblk('core_persona', SH.core_persona.name, V('core_persona')));
  B.push(sysblk('model_jb', mm.model_jb.name, mm.model_jb.content, { depth: depthOf(mm.model_jb) }));
  B.push(sysblk('content_permit', SH.content_permit.name, V('content_permit')));
  for (const id of ['rp_frame', 'rp_fanfic', 'rp_terms', 'rp_pacing', 'rp_combat', 'rp_intrigue'])
    B.push(sysblk(id, SH[id].name, V(id)));

  // 文风 / 角色
  for (const id of ['prose_style', 'prose_craft', 'prose_humanlike', 'npc_autonomy', 'npc_interact', 'prose_realism', 'prose_scene', 'continuity'])
    B.push(sysblk(id, SH[id].name, V(id)));
  B.push(sysblk('prose_nsfw', SH.prose_nsfw.name, V('prose_nsfw')));   // 直出·可禁用

  // 功能区 —— 视角(五选一)
  for (const id of Object.keys(POV))
    B.push(sysblk(id, POV[id].name, wrapSetvar('pov_rules', POV[id].rule)));
  B.push(sysblk('fn_inner', '视角·＋内心独白（可独立开）', FN_INNER));
  // 功能区 —— 对话补丁
  for (const id of Object.keys(DLG))
    B.push(sysblk(id, DLG[id].name, dlgBlk(DLG[id].rule)));
  // 功能区 —— 玩家自主权(默认关·深注入)
  B.push(sysblk('player_agency', mm.player_agency.name, mm.player_agency.content, { depth: depthOf(mm.player_agency) }));
  // 功能区 —— 反八股(写 anti_slop) / 篇幅(写 word_min/max/length_rule)
  B.push(sysblk('model_antislop', mm.model_antislop.name, wrapSetvar('anti_slop', mm.model_antislop.content)));
  B.push(sysblk('fn_length', mm.prose_length.name, lengthBlock(model, mm.prose_length.content), { depth: depthOf(mm.prose_length) }));

  // 思维链(三段)
  B.push(sysblk('cot_start', '思维链 · 开始【共享】', COT_START));
  B.push(sysblk('cot_body', mm.model_cot.name, mm.model_cot.content + COT_BODY_TAIL));
  B.push(sysblk('cot_end', '思维链 · 结束(反八股/防OOC/玩家自主三道闸)【共享】', COT_END));

  // 输出
  B.push(sysblk('io_law', SH.io_law.name, V('io_law'), { depth: depthOf(SH.io_law) }));
  B.push(sysblk('output_format', '输出格式 · 总装(getvar)【共享】', OUTPUT_FORMAT, { depth: 2 }));

  // 启动 / 确认 / prefill
  B.push(sysblk('start_signal', SH.start_signal.name, V('start_signal')));
  B.push(roleblk('aff_user', SH.aff_user.name, 'user', V('aff_user')));
  B.push(roleblk('aff_asst', SH.aff_asst.name, 'assistant', V('aff_asst')));
  if (model === 'DeepSeek')
    B.push(roleblk('prefill', mm.prefill.name, 'assistant', mm.prefill.content));
  else if (model === 'Claude')
    B.push(roleblk('prefill', '末尾预填充 · <think> 开场（默认关 · 端点不支持 assistant 结尾就保持关）', 'assistant', CLAUDE_PREFILL));
  // Gemini：不加 prefill(Google 端点通常拒绝 assistant 结尾)

  // 开关
  const disabled = new Set([
    '_guide', 'pov_third_god', 'pov_first_char', 'pov_first_user', 'pov_second',
    'fn_inner', 'fn_relay', 'fn_no_relay', 'fn_dialogue_more', 'player_agency',
  ]);
  if (model === 'Claude') disabled.add('prefill');
  const order = B.map((b) => ({ identifier: b.identifier, enabled: !disabled.has(b.identifier) }));
  const charId = cur[model].prompt_order?.[0]?.character_id ?? 100001;

  const out = {
    name: cur[model].name,
    temperature: cur[model].temperature,
    top_p: cur[model].top_p,
    openai_max_tokens: cur[model].openai_max_tokens,
    stream_openai: cur[model].stream_openai,
    prompts: B,
    prompt_order: [{ character_id: charId, order }],
    extensions: cur[model].extensions,
    context_length: cur[model].context_length,
  };
  return out;
}

// ── 宏引擎自检(镜像 stMacros.ts) ────────────────────────────────────────
function processMacros(text, ctx) {
  if (!text || (!text.includes('{{') && !text.includes('${') && !text.includes('<user>'))) return text;
  let n = text.replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
  n = n.replace(/\{\{setvar::([^}:]+)(?:(::|:)([\s\S]*?))?\}\}/g, (_m, name, sep, val) => {
    const a = String(name).trim();
    if (sep === undefined) return ctx.vars.get(a) ?? '';
    if (ctx.locked.has(a)) return '';
    ctx.vars.set(a, String(val ?? '').trim()); return '';
  });
  n = n.replace(/\{\{addvar::([^}:]+)(?:(::|:)([\s\S]*?))?\}\}/g, (_m, name, sep, val) => {
    const a = String(name).trim();
    if (sep === undefined) return ctx.vars.get(a) ?? '';
    if (ctx.locked.has(a)) return '';
    ctx.vars.set(a, (ctx.vars.get(a) ?? '') + String(val ?? '')); return '';
  });
  n = n.replace(/\{\{getvar::([^}]+)\}\}/g, (_m, name) => ctx.vars.get(String(name).trim()) ?? '');
  n = n.replace(/\{\{\s*trim\s*\}\}/gi, '');
  n = n.replace(/\{\{[^{}]*?\}\}/g, '');   // 兜底清残留
  return n;
}

function selfTest(model, preset) {
  const ctx = { vars: new Map(), locked: new Set(), random: Math.random };
  const enabledMap = new Map(preset.prompt_order[0].order.map((o) => [o.identifier, o.enabled]));
  const enabled = preset.prompts.filter((e) => enabledMap.get(e.identifier) !== false);
  const processed = enabled.map((e) => ({ ...e, content: processMacros(e.content || '', ctx) }));

  const errs = [];
  // 1) 无残留 {{}}
  for (const e of processed)
    if (/\{\{/.test(e.content)) errs.push(`[${model}] 残留宏 in ${e.identifier}: ${e.content.slice(0, 60)}`);
  // 2) 关键变量已解析
  if ((ctx.vars.get('output_lang') || '') !== '简体中文') errs.push(`[${model}] output_lang=${ctx.vars.get('output_lang')}`);
  if (!(ctx.vars.get('pov_rules') || '').includes('限知')) errs.push(`[${model}] pov_rules 未取到第三人称限知`);
  if (!(ctx.vars.get('anti_slop') || '').includes('反八股')) errs.push(`[${model}] anti_slop 为空`);
  const [lo, hi] = WORDS[model];
  if (ctx.vars.get('word_min') !== String(lo) || ctx.vars.get('word_max') !== String(hi)) errs.push(`[${model}] 字数 ${ctx.vars.get('word_min')}/${ctx.vars.get('word_max')}`);
  if ((ctx.vars.get('think_chain') || '') !== '') errs.push(`[${model}] think_chain 默认应为空(补丁默认关)`);
  // 3) 思维链/输出格式 已内联到系统提示
  const sysText = processed.filter((e) => e.injection_position !== 1 && (e.role === 'system') && e.content).map((e) => e.content).join('\n\n');
  if (!sysText.includes('限知')) errs.push(`[${model}] 系统提示未含视角(cot_start getvar 失败?)`);
  if (!sysText.includes('反八股自检')) errs.push(`[${model}] 系统提示未含 cot_end 反八股闸`);
  const depthText = processed.filter((e) => e.injection_position === 1 && e.content).map((e) => e.content).join('\n\n');
  if (!depthText.includes('输出格式')) errs.push(`[${model}] 深注入未含 输出格式总装`);
  if (!depthText.includes(String(lo))) errs.push(`[${model}] 输出格式 word_min getvar 失败`);
  return { errs, ctx, processedCount: processed.length, totalCount: preset.prompts.length };
}

// ── 运行 ────────────────────────────────────────────────────────────────
let allErrs = [];
for (const model of Object.keys(FILES)) {
  const preset = buildPreset(model);
  const r = selfTest(model, preset);
  allErrs = allErrs.concat(r.errs);
  console.log(`【${model}】块数=${preset.prompts.length}  启用=${r.processedCount}  temp=${preset.temperature}  字数=${WORDS[model].join('-')}  prefill=${preset.prompts.some((b) => b.identifier === 'prefill') ? '有' : '无'}`);
  if (r.errs.length) { console.log('  ✗ ' + r.errs.join('\n  ✗ ')); }
}
if (allErrs.length) {
  console.error('\n❌ 自检未通过，未写文件。请修正后重跑。');
  process.exit(1);
}
// 内置目标：前端 loadBuiltinDefaults 从 public/presets 取(grab('zhushen-*.json'))
const BUILTIN_DIR = path.join(__dirname, 'zhushen-space', 'zhushen-space', 'public', 'presets');
const BUILTIN = { Claude: 'zhushen-claude.json', DeepSeek: 'zhushen-deepseek.json', Gemini: 'zhushen-gemini.json' };
for (const model of Object.keys(FILES)) {
  const preset = buildPreset(model);
  const json = JSON.stringify(preset, null, 2);
  fs.writeFileSync(path.join(OUT_DIR, FILES[model]), json, 'utf8');
  console.log(`✓ 写入 正文预设/${FILES[model]}`);
  if (fs.existsSync(BUILTIN_DIR)) {
    fs.writeFileSync(path.join(BUILTIN_DIR, BUILTIN[model]), json, 'utf8');
    console.log(`✓ 同步内置 public/presets/${BUILTIN[model]}`);
  }
}
console.log('\n全部完成（自检通过）。改 public/presets 后需重 build 让 dist/ 生效。');
