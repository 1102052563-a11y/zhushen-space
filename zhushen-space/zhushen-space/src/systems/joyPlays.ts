/* ════════════════════════════════════════════
   欢愉宫·玩法库（借鉴 色色灵感状态栏V3.2 的 458 条 PLAY_DATA + 「按选注入」思路）
   - 数据在 public/joy-plays.json（构建期由 V3.2 PLAY_DATA 转换：name/category/content，分类 体位/多人/侍奉/附加/情境）；
   - 「按选注入」：玩家在包间勾选 ≤3 个玩法 → 每轮发送时拼成单块 system 注入（不挂世界书、不靠关键词命中）；
     清空即移除。content 含 ST 的 {{random::A::B}} 变体宏 → **每轮注入时现场展开**（同一玩法每轮随机不同变体）。
   编排：块拼接在 App.onJoySend；选择状态在 joyStore.selectedPlays；UI 在 JoyPanel 包间 🎲玩法 按钮。
════════════════════════════════════════════ */
import { useJoy } from '../store/joyStore';

export interface JoyPlay { name: string; category: string; content: string }
export interface JoyPlayLib { version: number; categories: string[]; plays: JoyPlay[] }

export const MAX_SELECTED_PLAYS = 3;   // 勾选上限（控 token：单条玩法平均 ~600 字）

let _lib: JoyPlayLib | null = null;
let _loading: Promise<JoyPlayLib> | null = null;

/** 惰性加载玩法库（幂等；失败返回空库，不炸调用方） */
export async function loadJoyPlays(): Promise<JoyPlayLib> {
  if (_lib) return _lib;
  if (_loading) return _loading;
  _loading = fetch('/joy-plays.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      _lib = (j && Array.isArray(j.plays)) ? j as JoyPlayLib : { version: 0, categories: [], plays: [] };
      return _lib!;
    })
    .catch(() => { _lib = { version: 0, categories: [], plays: [] }; return _lib!; });
  return _loading;
}

/** 同步取已加载的库（未加载=null；UI 打开选择器时先 await loadJoyPlays） */
export function getLoadedPlays(): JoyPlayLib | null { return _lib; }

/** 展开 ST 变体宏 {{random::A::B::C}} → 随机取一支。
    内层优先（正文体内不含 `{{` 才匹配）+ 多遍处理嵌套；收尾清理源数据里个别未闭合的残破标记。 */
export function expandStMacros(text: string, rand: () => number = Math.random): string {
  let t = String(text ?? '');
  for (let i = 0; i < 6; i++) {
    const next = t.replace(/\{\{random::((?:(?!\{\{)[\s\S])*?)\}\}/g, (_, body: string) => {
      const opts = body.split('::').map((x) => x.trim()).filter(Boolean);
      if (!opts.length) return '';
      return opts[Math.floor(rand() * opts.length)] ?? '';
    });
    if (next === t) break;
    t = next;
  }
  // 残破清理：未闭合的 {{random:: 前缀与落单的 }}（V3.2 源数据存在个别缺闭合条目）
  return t.replace(/\{\{random::/g, '').replace(/\}\}/g, '');
}

/** 把选中的玩法拼成单块注入文本（每次调用重新展开宏＝每轮变体不同）；无选中/查无=空串。 */
export function buildPlayGuideBlock(names: string[], lib: JoyPlayLib, rand: () => number = Math.random): string {
  const picked = names
    .map((n) => lib.plays.find((p) => p.name === n))
    .filter((p): p is JoyPlay => !!p)
    .slice(0, MAX_SELECTED_PLAYS);
  if (!picked.length) return '';
  const body = picked.map((p) => expandStMacros(p.content, rand).trim()).filter(Boolean).join('\n\n');
  if (!body) return '';
  return `【本场玩法指引（玩家钦点 · 共 ${picked.length} 项）】
以下玩法由玩家从玩法库选定，作为当前亲密场景的演出蓝本：按其中 basics / steps / options / eroticism_focus 的要点自然编排进剧情与 <交互> 描写，允许按当下姿态衔接顺序、微调细节；不要照抄原文措辞，要写成活的画面与动作。多项玩法可先后衔接或择机切换。

${body}`;
}

/** onJoySend 用的一站式注入：读 store 选中项 → 确保库已加载 → 拼块（无选中时零开销返回 ''）。 */
export async function buildSelectedPlaysInjection(): Promise<string> {
  try {
    const names = useJoy.getState().selectedPlays ?? [];
    if (!names.length) return '';
    const lib = await loadJoyPlays();
    return buildPlayGuideBlock(names, lib);
  } catch { return ''; }
}
