/* ── 统一提示词展开（表格模板 → ST 宏）───────────────────────────────────────
   一次构建共享上下文（runtimeVars 只采集一份），先 resolveTableTemplates（<if var/cell/seed/cond>、
   计算标签、$ref），再 processMacros（{{getvar}}/{{random}}/${变量} 等）。
   三处调用点共用，保证语法处处一致：
     · App.buildPresetMessages（正文预设/世界书块·seedContent=末条正文）
     · promptOverrideStore.renderPrompt（玩家自定义主提示词 + field 类注入点·keepUnknown=true）
     · apiChat.apiChatFallback（全局兜底·所有 AI 调用的最终消息）
   ⚠ 只做文本展开，无持久副作用：{{setvar}} 仅在本次 ctx 内生效（重 roll 不会双重应用），持久态只走 stateParser。 */
import { resolveTableTemplates, type TableTplCtx } from './tableTemplate';
import { processMacros, makeMacroCtx, type MacroCtx } from './stMacros';
import { buildRuntimeVars } from './runtimeVars';
import { snippetMap } from '../store/snippetStore';

export interface PromptExpandCtx {
  macroCtx: MacroCtx;
  tableCtx: TableTplCtx;
  /** 🧩 片段库快照（{{include::名}} 展开用·ctx 构建时采集一份）。 */
  snippets: Record<string, string>;
}

// ── 🧩 {{include::片段名}} 展开（片段库·借鉴 ST-PT define/getwi 思想的声明式替代）────────
const RE_INCLUDE = /\{\{include::([^{}]+?)\}\}/g;
/** 深度上限 3 防循环引用（A→B→A 第 4 层置空+warn）；未定义片段名→空串+warn（残留也会被宏层兜底清掉）。 */
export function expandIncludes(text: string, map: Record<string, string>): string {
  if (!text || !text.includes('{{include::')) return text;
  let out = text;
  for (let depth = 0; depth < 3 && out.includes('{{include::'); depth++) {
    out = out.replace(RE_INCLUDE, (_full, name) => {
      const n = String(name).trim();
      if (n in map) return map[n];
      console.warn('[片段库] 未定义片段：' + n);
      return '';
    });
  }
  if (out.includes('{{include::')) {
    console.warn('[片段库] include 嵌套超 3 层（疑似循环引用），剩余引用置空');
    out = out.replace(RE_INCLUDE, '');
  }
  return out;
}

/** 构建一份展开上下文：每轮/每次调用建一次，runtimeVars 采集一份、宏层与模板层共享；
    vars 跨块共享（同一 ctx 内 {{setvar}} 对后续块可见，与旧 _macroCtx 语义一致）。 */
export function makePromptExpandCtx(opts: {
  user?: string; char?: string; lastUserMessage?: string;
  /** 最新一条 AI 正文（<if seed> 关键词检测用）；拿不到就不传，seed 条件判否。 */
  seedContent?: string;
  random?: () => number;
} = {}): PromptExpandCtx {
  const vars = buildRuntimeVars();
  return {
    macroCtx: makeMacroCtx({ user: opts.user, char: opts.char, lastUserMessage: opts.lastUserMessage, random: opts.random, runtimeVars: vars }),
    tableCtx: { seedContent: opts.seedContent, random: opts.random, vars },
    snippets: snippetMap(),
  };
}

/** 展开一段提示词文本：表格模板 → ST 宏。stripLeftover/keepUnknown 语义同 processMacros
    （预设块场景默认清残留；玩家自定义/全局兜底场景传 false 保留合法 {{）。 */
export function expandPromptText(text: string, ctx: PromptExpandCtx, stripLeftover = true, keepUnknown = false): string {
  if (!text) return text;
  return processMacros(resolveTableTemplates(expandIncludes(text, ctx.snippets), ctx.tableCtx), ctx.macroCtx, stripLeftover, keepUnknown);
}
