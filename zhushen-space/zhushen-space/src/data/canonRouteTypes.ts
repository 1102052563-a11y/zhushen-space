/** 原著路线（canon route）站点数据类型 — 数据由 tools/build-canon-route.mjs 从 lunhui-wiki 抽取生成到 canonRoute.ts */

/** 六维（缺项=页面未记录） */
export interface CanonAttrs { 力量?: number; 敏捷?: number; 体力?: number; 智力?: number; 魅力?: number; 幸运?: number }

/** 原著同期人物（该站时间线上存在；vol=首次出现卷·已过滤 ≤ 本站卷） */
export interface CanonNpcEntry { name: string; brief?: string; vol: number }

/** 苏晓在该世界的一段轨道锚点（按剧情顺序） */
export interface CanonTrackPhase {
  title: string;      // 这一阶段他在做什么（短句）
  chapters?: string;  // 原著章节参照（如「二卷3–4章」）
  note?: string;      // 补充一句（仅部分站点有）
}

/** 离世定格快照（该站结束时苏晓的状态；下一站入场基准 = 本快照 + paradiseAfter） */
export interface CanonSnapshot {
  lv?: number;         // 离世时等级
  realm?: string;      // 阶位（一阶/二阶…）
  attrs?: CanonAttrs;  // 六维
  text: string;        // 完整定格文本（压缩版：等级/职业/技能/装备/携出物…）
}

export interface CanonStation {
  id: string;         // 来源文件名（去 .md），路线内唯一
  order: number;      // 1 起的站序
  name: string;       // 展示名（wiki 页 title）
  navLabel: string;   // wiki nav 里的完整标注（含通关评级等，路线图展示用）
  volume: string;     // 原著卷（如「二」＝第二卷）
  file: string;       // wiki 源文件相对路径（溯源用）
  stationType: string;    // 任务世界 / 生存试炼 / 晋升考核 / 世界争夺战 …
  difficulty?: string;    // 页面 frontmatter 难度
  status?: string;        // 页面 frontmatter 状态（含通关评价）
  recommendedTier: string; // 推荐阶位（≈苏晓入场阶位）
  world: {
    desc: string;            // 世界信息（压缩）
    era?: string;            // 时间点锚定（原著哪个时期切入）
    currency?: string;       // 本地货币
    rules?: string;          // 世界规则 / 警告（压缩）
    tasksText?: string;      // 任务节全文（压缩，含支线/成就/猎杀等）
    mainMission?: string;    // 原著主线任务（净化完成标记后的原文）
    mainReward?: string;     // 主线奖励
    sideMissions?: string[];
    triggerQuests?: string[]; // 触发 / 隐藏任务（GM 提示用，勿直接发布）
    npcRoster?: CanonNpcEntry[]; // 原著同期人物名册（wiki 人物 nav 世界分组抽取·卷≤本站·≤20人）
  };
  suxiao: {
    alias: string;               // 该站化名（默认「白夜」）
    track: CanonTrackPhase[];    // 原著轨道锚点
    exit: CanonSnapshot;         // 离世定格
    settle?: { sourcePct?: number; rating?: string; text?: string }; // 世界结算基准（世界之源% / 评价）
    endingNote?: string;         // 通关结局（压缩）
    paradiseAfter?: string;      // 离世后在乐园/现实的强化与经历（＝下一站入场增量）
  };
}

export interface CanonSuxiao {
  name: string;
  defaultAlias: string;
  persona: string;   // 人设简介（早期章节来源，不含后期剧透）
}

export interface CanonRouteMeta {
  generatedAt: string;     // 生成时间（ISO）
  stationCount: number;    // 本次生成的站数
  totalNavWorlds: number;  // wiki nav 里任务世界总数（路线远景展示用）
}
