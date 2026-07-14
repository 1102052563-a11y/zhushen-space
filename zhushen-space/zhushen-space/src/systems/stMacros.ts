/* ── SillyTavern 宏引擎 ─────────────────────────────────────────────
   移植自 fanren presetAssembler 的 w()，覆盖 ST 常用宏，并在末尾清掉未识别的残留宏防泄漏成乱码。
   支持：{{//注释}} {{setvar}} {{addvar}} {{getvar}} {{random}} {{pick}} {{roll NdM}}
        ${var} {{lastUserMessage}} {{newline}} {{trim}} {{char}} {{user}} <user>
   用法：makeMacroCtx({...}) 建一次上下文（vars 跨块共享，故 setvar 后续 getvar 生效），
        对每个预设块 content 调 processMacros(content, ctx)。无宏文本走快速返回，零开销。 */

export interface MacroCtx {
  vars: Map<string, string>;
  lockedVars: Set<string>;
  random: () => number;
}

export function makeMacroCtx(opts: {
  user?: string; char?: string; lastUserMessage?: string;
  random?: () => number; runtimeVars?: Record<string, string>;
} = {}): MacroCtx {
  const vars = new Map<string, string>();
  if (opts.user) vars.set('user', opts.user);
  if (opts.char) vars.set('char', opts.char);
  if (opts.lastUserMessage != null) { vars.set('lastUserMessage', opts.lastUserMessage); vars.set('玩家输入', opts.lastUserMessage); }
  for (const [k, v] of Object.entries(opts.runtimeVars ?? {})) if (typeof v === 'string') vars.set(k, v);
  return { vars, lockedVars: new Set(), random: opts.random ?? Math.random };
}

const RE_COMMENT  = /\{\{\/\/[\s\S]*?\}\}/g;
const RE_SETVAR   = /\{\{setvar::([^}:]+)(?:(::|:)([\s\S]*?))?\}\}/g;
const RE_ADDVAR   = /\{\{addvar::([^}:]+)(?:(::|:)([\s\S]*?))?\}\}/g;
const RE_GETVAR   = /\{\{getvar::([^}]+)\}\}/g;
const RE_RANDOM   = /\{\{random::([\s\S]*?)\}\}/g;
const RE_PICK     = /\{\{pick::([\s\S]*?)\}\}/g;
const RE_ROLL     = /\{\{roll[ :]+(\d+)d(\d+)\}\}/gi;
const RE_DOLLAR   = /\$\{([^}]+)\}/g;
const RE_LASTUSER = /\{\{\s*lastUserMessage\s*\}\}/gi;
const RE_NEWLINE  = /\{\{\s*newline\s*\}\}/gi;
const RE_TRIM     = /\{\{\s*trim\s*\}\}/gi;
const RE_CHAR     = /\{\{\s*char\s*\}\}/gi;
const RE_USER     = /\{\{\s*user\s*\}\}/gi;
const RE_USERTAG  = /<user>/gi;
const RE_LEFTOVER = /\{\{[^{}]*?\}\}/g;   // 兜底：清未识别残留宏，防泄漏

function pick(arr: string[], rng: () => number): string {
  return arr.length === 0 ? '' : (arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))] ?? '');
}
function rollDice(n: number, sides: number, rng: () => number): string {
  if (n <= 0 || sides <= 0) return '0';
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.floor(rng() * sides) + 1;
  return String(sum);
}

export function processMacros(text: string, ctx: MacroCtx, stripLeftover = true, keepUnknown = false): string {
  if (!text || (!text.includes('{{') && !text.includes('${') && !text.includes('<user>'))) return text;
  let n = text.replace(RE_COMMENT, '');
  n = n.replace(RE_SETVAR, (_m, name, sep, val) => {
    const a = String(name).trim();
    if (sep === undefined) return ctx.vars.get(a) ?? '';
    if (ctx.lockedVars.has(a)) return '';
    ctx.vars.set(a, String(val ?? '').trim());
    return '';
  });
  n = n.replace(RE_ADDVAR, (_m, name, sep, val) => {
    const a = String(name).trim();
    if (sep === undefined) return ctx.vars.get(a) ?? '';
    if (ctx.lockedVars.has(a)) return '';
    ctx.vars.set(a, (ctx.vars.get(a) ?? '') + String(val ?? ''));
    return '';
  });
  n = n.replace(RE_GETVAR, (_m, name) => { const v = ctx.vars.get(String(name).trim()); return v !== undefined ? v : (keepUnknown ? _m : ''); });
  const randPick = (body: string) => {
    let parts = body.split('::').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) parts = body.split(',').map((s) => s.trim()).filter(Boolean);
    return pick(parts, ctx.random);
  };
  n = n.replace(RE_RANDOM, (_m, body) => randPick(String(body)));
  n = n.replace(RE_PICK, (_m, body) => randPick(String(body)));
  n = n.replace(RE_ROLL, (_m, a, b) => rollDice(parseInt(a, 10), parseInt(b, 10), ctx.random));
  n = n.replace(RE_DOLLAR, (_m, name) => { const v = ctx.vars.get(String(name).trim()); return v !== undefined ? v : (keepUnknown ? _m : ''); });
  n = n.replace(RE_LASTUSER, () => ctx.vars.get('lastUserMessage') ?? '');
  n = n.replace(RE_NEWLINE, () => '\n');
  n = n.replace(RE_TRIM, '');
  n = n.replace(RE_CHAR, () => ctx.vars.get('char') ?? '');
  n = n.replace(RE_USER, () => ctx.vars.get('user') ?? '');
  n = n.replace(RE_USERTAG, () => ctx.vars.get('user') ?? '');
  if (stripLeftover) n = n.replace(RE_LEFTOVER, '');   // 仅 ST 预设场景清残留；全局场景关掉以免误删代码提示词的合法 {{
  return n;
}
