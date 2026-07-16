/**
 * 已停用：通用模板批量生成违反工坊铁则（真名、禁重复、禁套话凑字）。
 * 正确流程见 世界详情工坊/README.md「内容质量铁则」+ 流水线：
 *   联网检索 → 真名写作 → compile --check → QA → compile。
 * 若重写本脚本：必须每世界独立检索字段，禁止跨世界相同正文/代称人名。
 */
console.error(
  [
    'auto-batch.mjs 已停用。',
    '请按 世界详情工坊/README.md：',
    '  1) 工单模板 + 联网检索（百科/维基）',
    '  2) 人物真名、禁止重复/套话凑字',
    '  3) node scripts/compile-worldbook.mjs --check <md>',
    '  4) node scripts/compile-worldbook.mjs',
  ].join('\n'),
);
process.exit(1);
