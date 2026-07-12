/* 翻译核心（纯函数）。运行时翻译层 DomI18n 对「界面文本节点」逐个调用。
   - 繁體：交给 OpenCC 转换函数（见 opencc.ts）。
   - 英文：先精确查 en.ts 词库，再按有序正则规则匹配插值串；都不中则原样返回（回退中文，不报错）。
   保留原文的首尾空白，只翻中间实体，避免破坏排版（如「  设置 」→「  Settings 」）。 */
import { EN_EXACT, EN_RULES } from './en';
import { VI_EXACT, VI_RULES } from './vi';
import { userMap } from './userDict';

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

/** 取「去首尾装饰」后的 core（SEEN 记录用，与词库/导出表 key 口径对齐）。 */
export function coreOf(raw: string): string {
  return splitCore(raw)[1];
}

/** 通用「精确词库 + 插值正则」翻译：精确命中优先，其次锚定正则规则；未命中回退原文（保持中文）。 */
function dictTranslate(raw: string, exact: Record<string, string>, rules: [RegExp, string][], override?: Record<string, string>): string {
  // ① 整串（仅去首尾空白）精确匹配——用户导入表 > 内置词库；容纳带标点/括号/斜杠的完整句子键
  const wl = raw.match(/^\s*/)![0];
  const wt = raw.match(/\s*$/)![0];
  const full = raw.slice(wl.length, raw.length - wt.length);
  if (full) {
    const ov = override?.[full];
    if (ov) return wl + ov + wt;
    const fh = exact[full]; if (fh !== undefined) return wl + fh + wt;
  }

  // ② 去首尾「装饰」（emoji/图标/标点）后再精确匹配（治图标前缀标签）
  const [lead, core, trail] = splitCore(raw);
  if (!core) return raw;

  const ovc = override?.[core];
  if (ovc) return lead + ovc + trail;
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

/** 简体 → 英文（用户导入表优先 + 内置词库）。 */
export function translateToEn(raw: string): string {
  return dictTranslate(raw, EN_EXACT, EN_RULES, userMap('en'));
}

/** 简体 → 越南语（人工本地化词库；题材术语用汉越词，界面用现代越南语）。 */
export function translateToVi(raw: string): string {
  return dictTranslate(raw, VI_EXACT, VI_RULES, userMap('vi'));
}

export type ConvertLang = 'zh-Hant' | 'en' | 'vi';

/** 按目标语言转换单段界面文本。tw = 已加载的繁體转换函数（en/vi 模式忽略）。 */
export function convert(text: string, lang: ConvertLang, tw: ((s: string) => string) | null): string {
  if (lang === 'en') return translateToEn(text);
  if (lang === 'vi') return translateToVi(text);
  if (lang === 'zh-Hant') return tw ? tw(text) : text;
  return text;
}

/* ── 正文「结构化结算块」标签本地化（时间结算块/任务/状态栏 等） ──
   这些块由 narrativeHtml 渲染在 .narrative-content 内（DOM 翻译层排除·永不动正文散文），
   但块的**固定标题/字段/单位**是模板格式（非剧情），越南语/英文界面下应随之本地化。
   AI 仍按正文世界书用中文输出这些标签（渲染靠中文关键词识别成琥珀格子），此处**仅在展示时**逐个中文串替换。
   ⚠ 因 CJK 连续串按最大长度切分，孤立的单字单位串(天/分/时/秒)必是数字旁的计量单位（如「06天21小时00分」），
      故整串映射安全，不会误翻正文里「今天/天空」这类词（它们是多字串，走不到单位映射）。 */
const NARR_STRUCT_VI: Record<string, string> = {
  // 块标题 / 关键词
  结算: 'Kết Toán', 时间结算: 'Kết Toán Thời Gian', 时间结算块: 'Khối Kết Toán Thời Gian',
  动作日志: 'Nhật Ký Hành Động', 击杀结算: 'Kết Toán Hạ Gục', 成长结算: 'Kết Toán Trưởng Thành',
  判定: 'Phán Định', 判定块: 'Khối Phán Định', 战斗块: 'Khối Chiến Đấu', 战报: 'Chiến Báo',
  信息卡: 'Thẻ Thông Tin', 登场: 'Xuất Hiện', 离场: 'Rời Sân', 装备替换: 'Thay Trang Bị',
  任务: 'Nhiệm Vụ', 任务推进: 'Tiến Triển Nhiệm Vụ', 任务目标: 'Mục Tiêu Nhiệm Vụ',
  任务简介: 'Tóm Tắt Nhiệm Vụ', 任务区域: 'Khu Vực Nhiệm Vụ', 任务期限: 'Thời Hạn Nhiệm Vụ',
  任务世界时间: 'Thời Gian Thế Giới Nhiệm Vụ', 任务世界绝对时刻: 'Thời Khắc Tuyệt Đối Thế Giới Nhiệm Vụ',
  目标: 'Mục Tiêu', 提示: 'Gợi Ý', 主角资源: 'Tài Nguyên Nhân Vật Chính', 资源: 'Tài Nguyên',
  敌方信息: 'Thông Tin Phe Địch', 敌方: 'Phe Địch', 环境效果: 'Hiệu Ứng Môi Trường',
  掉落: 'Rơi Đồ', 战利品: 'Chiến Lợi Phẩm', 开启: 'Mở', 宝箱: 'Rương Báu', 商店: 'Cửa Hàng',
  交易: 'Giao Dịch', 购买: 'Mua', 获得: 'Nhận Được', 获取: 'Nhận', 入手: 'Có Được', 拾取: 'Nhặt',
  奖励: 'Phần Thưởng', 惩罚: 'Hình Phạt', 状态栏: 'Thanh Trạng Thái', 状态结算: 'Kết Toán Trạng Thái',
  状态: 'Trạng Thái', 成长: 'Trưởng Thành', 获得途径: 'Nguồn Gốc',
  // 字段 / 状态词
  剩余: 'Còn Lại', 临界: 'Ngưỡng', 世界时间: 'Thời Gian Thế Giới', 乐园时间: 'Thời Gian Lạc Viên',
  固定放开头: 'Cố Định Đặt Ở Đầu', 正常: 'Bình Thường', 异常: 'Bất Thường', 警戒: 'Cảnh Giác',
  危险: 'Nguy Hiểm', 安全: 'An Toàn', 已完成: 'Đã Hoàn Thành', 进行中: 'Đang Tiến Hành', 未完成: 'Chưa Hoàn Thành',
  // 单位（孤立单字串必为计量单位，安全）
  分钟: 'phút', 小时: 'giờ', 天: 'ngày', 秒: 'giây', 分: 'phút', 时: 'giờ', 年: 'năm', 月: 'tháng', 日: 'ngày', 周: 'tuần',
};
const NARR_STRUCT_EN: Record<string, string> = {
  结算: 'Settlement', 时间结算: 'Time Settlement', 时间结算块: 'Time Settlement Block',
  动作日志: 'Action Log', 击杀结算: 'Kill Settlement', 成长结算: 'Growth Settlement',
  判定: 'Check', 判定块: 'Check Block', 战斗块: 'Combat Block', 战报: 'Battle Report',
  信息卡: 'Info Card', 登场: 'Enter', 离场: 'Exit', 装备替换: 'Gear Swap',
  任务: 'Quest', 任务推进: 'Quest Progress', 任务目标: 'Objective', 任务简介: 'Brief',
  任务区域: 'Area', 任务期限: 'Deadline', 任务世界时间: 'World Time', 任务世界绝对时刻: 'Absolute World Time',
  目标: 'Objective', 提示: 'Tip', 主角资源: 'Resources', 资源: 'Resources', 敌方信息: 'Enemy Info', 敌方: 'Enemy',
  环境效果: 'Environment', 掉落: 'Drops', 战利品: 'Loot', 开启: 'Open', 宝箱: 'Chest', 商店: 'Shop',
  交易: 'Trade', 购买: 'Buy', 获得: 'Gained', 获取: 'Obtain', 入手: 'Acquired', 拾取: 'Pick Up',
  奖励: 'Reward', 惩罚: 'Penalty', 状态栏: 'Status', 状态结算: 'Status Settlement', 状态: 'Status', 成长: 'Growth',
  剩余: 'Remaining', 临界: 'Threshold', 世界时间: 'World Time', 乐园时间: 'Paradise Time',
  固定放开头: 'Fixed at Start', 正常: 'Normal', 异常: 'Abnormal', 警戒: 'Alert', 危险: 'Danger', 安全: 'Safe',
  已完成: 'Done', 进行中: 'Active', 未完成: 'Pending',
  分钟: 'min', 小时: 'h', 天: 'd', 秒: 's', 分: 'min', 时: 'h', 年: 'y', 月: 'mo', 日: 'd', 周: 'w',
};
const CJK_RUN = /[㐀-鿿豈-﫿]+/g;

/** 把一段文本里的中文「结构化标签串」本地化：逐个 CJK 连续串——先查专用结构表(整串)、再退通用界面词库、
    都不中则保留中文；非中文(数字/越南语/标点)原样。仅 en/vi 生效。
    ⚠ 只做**整串**匹配、不做串内切分——避免把「今天」这类正文词按单字单位表误拆成「今ngày」。
    结构块的拼接标题(时间结算块/判定块/状态栏…)已作为整串键收录，故无需串内贪婪。 */
export function translateNarrativeLabels(text: string, lang: ConvertLang): string {
  if (lang !== 'en' && lang !== 'vi') return text;
  const map = lang === 'en' ? NARR_STRUCT_EN : NARR_STRUCT_VI;
  const dict = lang === 'en' ? translateToEn : translateToVi;
  return text.replace(CJK_RUN, (run) => {
    if (map[run]) return map[run];         // ① 整串命中结构表（含单位·消歧）
    const d = dict(run);
    return d !== run ? d : run;            // ② 通用词库整串命中，否则保留中文
  });
}
