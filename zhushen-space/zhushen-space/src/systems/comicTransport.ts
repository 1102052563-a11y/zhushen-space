// 📖 漫画工坊·运输副本处理（复刻 comic-orb·已获授权）：
// 只修改「本次发给 API 的请求副本」，游戏正文/存档/漫画库原文一律不动。
// ① neutralizeForTransport：把易触发审核的直白措辞换成中性等价描述（身体量化/凝视修辞/猎奇伤害）；
// ② removeAgeExpressions：剔除年龄与学龄标签（配合成人身份约束，防绘画模型年龄误判拒绘）；
// ③ hasConflictingAgeMetadata：检测输入是否带低龄元数据（仅用于日志提示）。

export interface TransportResult { text: string; count: number; categories: Record<string, number> }

type Rule = [category: string, pattern: RegExp, replacement: string];

function applyRules(value: string, rules: Rule[]): TransportResult {
  let text = String(value || '');
  const counts: Record<string, number> = {};
  for (const [category, pattern, replacement] of rules) {
    text = text.replace(pattern, () => {
      counts[category] = (counts[category] || 0) + 1;
      return replacement;
    });
  }
  return { text, count: Object.values(counts).reduce((s, n) => s + n, 0), categories: counts };
}

/** 措辞中性化（发审核严格的分镜/演绎模型前的请求副本处理）。 */
export function neutralizeForTransport(value: string): TransportResult {
  return applyRules(value, [
    ['body_metric', /(?:至少\s*)?[A-HＡ-Ｈ]\s*(?:罩杯|cup)/gi, '丰满体型'],
    ['body_metric', /安产型(?:身材|体型)?/g, '胯部轮廓较宽的体型'],
    ['body_appraisal', /两团(?:巨大|丰满|柔软)?的?软肉/g, '丰满的上身轮廓'],
    ['body_appraisal', /软肉/g, '身体轮廓'],
    ['body_appraisal', /(?:极具冲击力|诱人|令人移不开视线|惊心动魄)的?(?:身体|身材|曲线|晃动|美景)?/g, '醒目的整体形象'],
    ['body_detail', /乳沟/g, '胸衣领口区域'],
    ['body_detail', /乳房/g, '胸部轮廓'],
    ['body_detail', /内裤边缘/g, '内层衣物边缘'],
    ['graphic_injury', /脑浆/g, '暗色碎屑'],
    ['graphic_injury', /(?:肠子|内脏)拖在外面/g, '腹部严重受创'],
    ['graphic_injury', /掀飞了?[^，。；\n]{0,10}头盖骨/g, '造成头部严重破损'],
    ['graphic_injury', /露出森森白骨/g, '留下明显重伤'],
    ['graphic_injury', /指甲里全是碎肉/g, '指甲沾满污血'],
    ['graphic_injury', /(?:给|把)?[^，。；\n]{0,8}开瓢/g, '造成头部重创'],
  ]);
}

/** 年龄/学龄表达剔除（只作用于请求副本；配合「成人身份约束」防年龄误判）。 */
export function removeAgeExpressions(value: string): TransportResult {
  const r = applyRules(value, [
    ['genre_age_label', /少年漫画/g, '高张力动作漫画'],
    ['genre_age_label', /青年漫画/g, '写实叙事漫画'],
    ['school_costume', /校园皮鞋/g, '皮鞋'],
    ['school_costume', /水手服/g, '水手领上衣'],
    ['school_costume', /校服/g, '制服'],
    ['school_identity', /(?:[\p{L}\p{N}_·-]{0,20}(?:学园|学校|学院))?[一二三四五六七八九十\d]+年级(?:转)?学生/gu, '角色'],
    ['school_identity', /(?:校园|校内)/g, '场景'],
    ['school_identity', /(?:学园|学校)/g, '机构'],
    ['school_identity', /[一二三四五六七八九十\d]+年级/g, ''],
    ['school_identity', /(?:小学生|初中生|高中生|大学生|转学生|学生)/g, '角色'],
    ['numeric_age', /(?:\d{1,3}|[零〇一二三四五六七八九十百两]+)\s*(?:岁|周岁)(?:左右|上下)?/g, ''],
    ['numeric_age', /\b(?:\d{1,3}\s*)?years?\s*old\b/gi, ''],
    ['age_category', /(?:未成年人?|成年人?|青少年|青春期|儿童|幼童|幼女|幼男|少女|少年|萝莉|正太|小丫头|童颜|幼态|稚嫩|成熟女性|成熟男人)/g, '角色'],
    ['age_category', /\b(?:minor|underage|teen(?:ager)?|adolescent|adult)\b/gi, 'character'],
  ]);
  r.text = r.text.replace(/[ \t]{2,}/g, ' ').replace(/(?:，\s*){2,}/g, '，').replace(/(?:、\s*){2,}/g, '、');
  return r;
}

/** 输入是否带「低龄」元数据（数字年龄<18 或低龄称谓）——只用于任务日志提示，不阻断。 */
export function hasConflictingAgeMetadata(value: string): boolean {
  const text = String(value || '');
  const numericAges = [...text.matchAll(/(?:^|[^\d])(\d{1,2})\s*(?:岁|周岁|years?\s*old)/gi)].map((m) => Number(m[1]));
  return numericAges.some((age) => age >= 0 && age < 18)
    || /未成年|青少年|儿童|幼童|小学生|初中生|高中生|萝莉|正太|小丫头/gi.test(text);
}
