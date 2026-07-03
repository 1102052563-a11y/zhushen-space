/* 分阶段人设 · 生成器（纯函数·无依赖）───────────────────────────────────────
   把「属性表/行/列 + 各阶段阈值→人设文」编译成嵌套 <if cell="表/行/列 >= N"> 条件块，
   供玩家粘进正文预设 / 世界书；运行时由 systems/tableTemplate.ts 的 resolveTableTemplates
   按当前表里的属性值选中对应阶段（阈值高的先判，命中最高达标阶段）。
   这是「数据库·分阶段人设」的现成糖：引擎(<if cell>)早已具备，此处只做「表单→条件串」免手写。 */

export interface PersonaStage {
  /** 达到该值（含）起启用本阶段文案（数值阈值）。 */
  min: number;
  /** 本阶段的人设/语气文案。 */
  text: string;
}

export interface StagedPersonaCfg {
  /** 属性所在表名（如「主角信息表」或自建「好感度表」）。 */
  table: string;
  /** 行名（通常是角色名，cell 取值时任意列匹配该行名）。 */
  row: string;
  /** 列名（如「好感度」「堕落值」）。 */
  column: string;
  /** 各阶段（min=阈值·text=文案）；编译时按 min 降序成 else-if 链。 */
  stages: PersonaStage[];
  /** 都不满足（低于最低阈值）时的兜底文案；留空则最低阶段无 else。 */
  fallback?: string;
}

/** 生成嵌套 <if cell="表/行/列 >= min"> 链：阈值高的在最外层。无有效阶段/缺表行列→''。 */
export function buildStagedPersona(cfg: StagedPersonaCfg): string {
  const table = (cfg?.table ?? '').trim();
  const row = (cfg?.row ?? '').trim();
  const column = (cfg?.column ?? '').trim();
  if (!table || !row || !column) return '';
  const stages = (cfg.stages ?? [])
    .filter((s) => s && typeof s.min === 'number' && Number.isFinite(s.min) && (s.text ?? '').trim() !== '')
    .sort((a, b) => b.min - a.min);   // 降序：外层先判最高阈值
  if (!stages.length) return '';
  const path = `${table}/${row}/${column}`;
  // 从最低阶段往上包：内层 else 起初=fallback，逐层往外套一层 <if>
  let acc = (cfg.fallback ?? '').trim();
  for (let i = stages.length - 1; i >= 0; i--) {
    const body = stages[i].text.trim();
    acc = acc
      ? `<if cell="${path} >= ${stages[i].min}">${body}<else>${acc}</if>`
      : `<if cell="${path} >= ${stages[i].min}">${body}</if>`;
  }
  return acc;
}

/** 一份可直接演示/内置的示例配置（好感度 4 阶）。 */
export const STAGED_PERSONA_EXAMPLE: StagedPersonaCfg = {
  table: '好感度表',
  row: '{{char}}',
  column: '好感度',
  stages: [
    { min: 80, text: '【热恋】她眼里藏不住笑意，主动靠近，语气黏软，处处为你着想。' },
    { min: 50, text: '【亲近】她放下了戒备，会打趣你、也会认真听你说话，偶尔脸红。' },
    { min: 20, text: '【熟识】她客气而礼貌，保持分寸，但不再冷淡。' },
  ],
  fallback: '【陌生】她对你冷淡疏离，话很少，眼神带着审视。',
};
