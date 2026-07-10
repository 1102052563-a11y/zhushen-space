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

/** 拆出首尾空白，返回 [lead, core, trail]。 */
function splitWs(raw: string): [string, string, string] {
  const lead = raw.match(/^\s*/)![0];
  const trail = raw.match(/\s*$/)![0];
  const core = raw.slice(lead.length, raw.length - trail.length);
  return [lead, core, trail];
}

/** 通用「精确词库 + 插值正则」翻译：精确命中优先，其次锚定正则规则；未命中回退原文（保持中文）。 */
function dictTranslate(raw: string, exact: Record<string, string>, rules: [RegExp, string][]): string {
  const [lead, core, trail] = splitWs(raw);
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
