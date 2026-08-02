/* [Agent] V14.7 狐神抚 · 毓忻 —— 内置副本前端适配（cure）定义。
   该预设让模型输出自定义标签（<think_fox~>/<content>/<fox_selc|fox_tip>），ST 里靠配套正则包渲染，
   本前端没有 → 标签块漏进楼层（大段空白/黑胶唱片黑块等，Discord 玩家实测）。
   这里集中定义：① 等效适配正则（App.loadBuiltinDefaults 的 cure 块挂到内置副本上）；
                 ② 需默认关闭的条目（think_fox 思维链——Agent 直出跑偏+雷霆大思考元凶）。
   ⚠ 改动本文件的 pattern 时同步 bump CURE_KEY 版本（App 侧），否则老副本吃不到新脚本。
   单测：agentPresetEmbed.test.ts 用真实 compileFindRegex+runRegexReplace 逐条验证。 */
import type { RegexScript } from '../../store/settingsStore';

export const HUYU_PRESET_NAME = '[Agent] V14.7 狐神抚 · 毓忻';
/** 默认关闭的条目名（可在预设页签开回） */
export const HUYU_DISABLE_ENTRY_NAMES = ['⬆️🎞️思维链（多角色内心OS）'];

const mk = (id: string, scriptName: string, findRegex: string, replaceString: string, extra: Partial<RegexScript> = {}): RegexScript =>
  ({ id, scriptName, findRegex, replaceString, trimStrings: [], placement: [1], disabled: false, flags: 'g', ...extra });

export const HUYU_CURE_SCRIPTS: RegexScript[] = [
  mk('huyu-thinkfox', '狐神适配·剥离<think_fox~>思维链', '<think_fox~>[\\s\\S]*?</think_fox~>\\s*', ''),
  mk('huyu-content',  '狐神适配·拆<content>正文壳',      '</?content>\\s*\\n?', ''),
  mk('huyu-foxwrap',  '狐神适配·拆选项/吐槽标签',        '</?fox_(?:selc|tip)>\\s*\\n?', ''),
  mk('huyu-blank',    '狐神适配·收敛连续空行(仅显示)',   '\\n{3,}', '\n\n', { markdownOnly: true }),
  mk('huyu-brrun',    '狐神适配·收敛连排<br>(仅显示)',   '(?:<br\\s*/?\\s*>\\s*){3,}', '<br><br>', { markdownOnly: true, flags: 'gi' }),
];
