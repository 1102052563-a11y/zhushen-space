/* 翻译核心（纯函数）。运行时翻译层 DomI18n 对「界面文本节点」逐个调用。
   - 繁體：交给 OpenCC 转换函数（见 opencc.ts）。
   - 英文：先精确查 en.ts 词库，再按有序正则规则匹配插值串；都不中则原样返回（回退中文，不报错）。
   保留原文的首尾空白，只翻中间实体，避免破坏排版（如「  设置 」→「  Settings 」）。 */
import { EN_EXACT, EN_RULES } from './en';
import { VI_EXACT, VI_RULES } from './vi';

const CJK_RE = /[㐀-鿿豈-﫿]/;

/** 含中日韩表意文字（用于快速跳过纯 ASCII/数字/emoji 节点）。 */
export function hasCJK(s: string): boolean {
  return CJK_RE.test(s);
}

/** 拆出首尾「装饰」（空白 / emoji 图标 / 箭头符号 / 标点），返回 [lead, core, trail]。
   core 以字母·数字·汉字开头结尾，便于命中词库：「✎ 编辑」→core「编辑」、「（推荐）」→core「推荐」、「← 系统设置」→core「系统设置」。
   翻译后再把 lead/trail 原样拼回，图标/符号不丢。 */
const LEAD_DECOR = /^[^\p{L}\p{N}]+/u;
const TRAIL_DECOR = /[^\p{L}\p{N}]+$/u;
function splitCore(raw: string): [string, string, string] {
  const lead = raw.match(LEAD_DECOR)?.[0] ?? '';
  const rest = raw.slice(lead.length);
  const trail = rest.match(TRAIL_DECOR)?.[0] ?? '';
  const core = trail ? rest.slice(0, rest.length - trail.length) : rest;
  return [lead, core, trail];
}

/** 通用「精确词库 + 插值正则」翻译：精确命中优先，其次锚定正则规则；未命中回退原文（保持中文）。 */
function dictTranslate(raw: string, exact: Record<string, string>, rules: [RegExp, string][]): string {
  const [lead, core, trail] = splitCore(raw);
  if (!core) return raw;

  const hit = exact[core];
  if (hit !== undefined) return lead + hit + trail;

  for (const [re, to] of rules) {
    re.lastIndex = 0;
    if (re.test(core)) {
      re.lastIndex = 0;
      return lead + core.replace(re, to) + trail;
    }
  }

  // 分隔符复合标签（「清理图片 · 存档瘦身」「攻击/防御」）：拆成段，仅当每段都命中词库才整体替换，
  // 避免半中半外的尴尬输出。保留原分隔符（含两侧空格）。
  const parts = core.split(/(\s*[·/|、]\s*)/);
  if (parts.length >= 3) {
    let allHit = true;
    const out = parts.map((seg, i) => {
      if (i % 2 === 1) return seg;                 // 奇数位=分隔符，原样
      const key = seg.trim();
      if (!key || !CJK_RE.test(key)) return seg;   // 非中文段（数字/Lv.1/英文缩写）原样保留
      const h = exact[key];
      if (h === undefined) { allHit = false; return seg; }
      return h;
    });
    if (allHit) return lead + out.join('') + trail;
  }
  return raw;
}

/** 简体 → 英文（人工词库）。 */
export function translateToEn(raw: string): string {
  return dictTranslate(raw, EN_EXACT, EN_RULES);
}

/** 简体 → 越南语（人工本地化词库；题材术语用汉越词，界面用现代越南语）。 */
export function translateToVi(raw: string): string {
  return dictTranslate(raw, VI_EXACT, VI_RULES);
}

export type ConvertLang = 'zh-Hant' | 'en' | 'vi';

/** 按目标语言转换单段界面文本。tw = 已加载的繁體转换函数（en/vi 模式忽略）。 */
export function convert(text: string, lang: ConvertLang, tw: ((s: string) => string) | null): string {
  if (lang === 'en') return translateToEn(text);
  if (lang === 'vi') return translateToVi(text);
  if (lang === 'zh-Hant') return tw ? tw(text) : text;
  return text;
}
