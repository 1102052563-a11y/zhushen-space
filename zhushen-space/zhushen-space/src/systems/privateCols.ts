/* 性相关/私密列定义（NPC 演化 + NpcDetail 私密信息版块 + 🔗调教系统 三方共用·单一真相源在 npc.extra）。
   抽成独立小模块：让 TrainingPanel 引用它而不必把 6 万字的 NpcDetail 拉进自己的 chunk。
   调教对话的隐私变化直接落这些键（systems/training.ts），三处 UI 即时同源反映。 */
export interface PrivateCol { key: string; label: string; alias: string; num?: boolean; inline?: boolean }

export const PRIVATE_COLS: PrivateCol[] = [
  { key: '8',  label: '性经验',   alias: '性经验' },
  { key: '17', label: '表性癖',   alias: '表性癖' },
  { key: '18', label: '里性癖',   alias: '里性癖' },
  { key: '20', label: '敏感部位', alias: '敏感部位' },
  { key: '21', label: '性器状态', alias: '性器状态' },
  { key: '22', label: '情欲值',   alias: '情欲值', num: true },
  { key: '23', label: '快感值',   alias: '快感值', num: true },
  { key: '24', label: '性观念',   alias: '性观念' },
  // 私密补充字段（命名键，由 NPC_PRIVATE_EXTRA_RULE 生成）；inline=短枚举项，横向胶囊排列省空间
  { key: '淫纹',     label: '淫纹',     alias: '淫纹' },
  { key: '解锁服装', label: '解锁服装', alias: '解锁服装', inline: true },
  { key: '独特技巧', label: '独特技巧', alias: '独特技巧' },
  { key: '性爱姿势', label: '性爱姿势', alias: '性爱姿势', inline: true },
  { key: '开发玩法', label: '开发玩法', alias: '开发玩法', inline: true },
  // 🔗 调教系统补充字段（借鉴V3.2 NSFW信息表·同样落 extra 命名键）
  { key: '调教值',   label: '调教值',   alias: '调教值', num: true },
  { key: '性爱次数', label: '性爱次数', alias: '性爱次数', num: true },
  { key: '最近性行为', label: '最近性行为', alias: '最近性行为' },
  { key: '床上淫语风格', label: '床上淫语风格', alias: '床上淫语风格' },
  { key: '羞耻点',   label: '羞耻点·心理防线', alias: '羞耻点' },
  { key: '泌乳',     label: '泌乳·体液状态', alias: '泌乳' },
  { key: '后庭状态', label: '后庭状态', alias: '后庭状态' },
  { key: '对主角的称呼', label: '对主角的称呼', alias: '对主角的称呼', inline: true },
  // 开发度六格（0~100·只增不可逆）
  { key: '开发·口部', label: '开发·口部', alias: '开发·口部', num: true },
  { key: '开发·乳部', label: '开发·乳部', alias: '开发·乳部', num: true },
  { key: '开发·下体', label: '开发·下体', alias: '开发·下体', num: true },
  { key: '开发·后庭', label: '开发·后庭', alias: '开发·后庭', num: true },
  { key: '开发·手足', label: '开发·手足', alias: '开发·手足', num: true },
  { key: '开发·全身感度', label: '开发·全身感度', alias: '开发·全身感度', num: true },
  // 纯洁·初次档案（借鉴V3.2大调查·⚠贞操不可逆写回处女、破处/初次记录首次写入即锁定——护栏见 training.ts）
  { key: '贞操状态', label: '贞操状态',   alias: '贞操状态', inline: true },
  { key: '破处对象', label: '破处对象',   alias: '破处对象' },
  { key: '破处时间', label: '破处时间',   alias: '破处时间', inline: true },
  { key: '部位初次', label: '部位初次明细', alias: '部位初次' },
  { key: '初体验',   label: '初体验',     alias: '初体验' },
  { key: '最难忘经历', label: '最难忘经历', alias: '最难忘经历' },
  // 统计计数（只增棘轮·num；"性爱次数"已在上）
  { key: '性爱人数', label: '性爱人数', alias: '性爱人数', num: true },
  { key: '高潮次数', label: '高潮次数', alias: '高潮次数', num: true },
  { key: '内射次数', label: '内射次数', alias: '内射次数', num: true },
  { key: '性爱频率', label: '性爱频率', alias: '性爱频率', inline: true },
  { key: '常用体位', label: '常用体位', alias: '常用体位', inline: true },
  { key: '常去场所', label: '常去场所', alias: '常去场所', inline: true },
  // 生育史（次数只增·num；子嗣记录·与生理周期🌸孕程联动）
  { key: '怀孕次数', label: '怀孕次数', alias: '怀孕次数', num: true },
  { key: '生产次数', label: '生产次数', alias: '生产次数', num: true },
  { key: '流产次数', label: '流产次数', alias: '流产次数', num: true },
  { key: '子嗣',     label: '子嗣',     alias: '子嗣' },
  // 魅力评估 + 关系占有
  { key: '性魅力标签', label: '性魅力TAG',     alias: '性魅力标签', inline: true },
  { key: '吸引力部位', label: '最具吸引力部位', alias: '吸引力部位', inline: true },
  { key: '声音魅力',   label: '声音魅力',       alias: '声音魅力' },
  { key: '服从度',     label: '服从度',         alias: '服从度', num: true },   // 可增减·日常听话度(区别于沉沦棘轮)
  { key: '依赖度',     label: '依赖度',         alias: '依赖度', num: true },   // 可增减
  { key: '专属印记',   label: '专属印记',       alias: '专属印记' },
  { key: '安全词',     label: '安全词',         alias: '安全词', inline: true },
  { key: '红线禁忌',   label: '红线禁忌',       alias: '红线禁忌' },
  // 性倾向（借鉴V3.2大调查·心理性向）
  { key: '性取向',     label: '性取向',         alias: '性取向', inline: true },
  { key: '性癖倾向',   label: '性癖倾向',       alias: '性癖倾向' },              // 主动⇄被动 / 施⇄受 / 主导⇄臣服
  { key: '性开放度',   label: '性开放度',       alias: '性开放度', num: true },   // 0~100·可增减
  { key: '性自信',     label: '性自信',         alias: '性自信', num: true },     // 0~100·可增减
  // 性癖圈子·角色扮演（BDSM / 主奴 / 宠物play 等小众圈子设定）
  { key: 'BDSM倾向',   label: 'BDSM倾向',       alias: 'BDSM倾向', inline: true }, // Dom主/sub奴/Switch·施虐/受虐
  { key: '角色扮演偏好', label: '角色扮演偏好',   alias: '角色扮演偏好' },          // 主人/宠物·主仆·师生…
  { key: '圈内代号',   label: '圈内代号',       alias: '圈内代号', inline: true }, // 小众圈子自我认同（如"小狗""主人"）
  { key: '喜欢的动作', label: '喜欢的动作',     alias: '喜欢的动作' },            // 偏爱/回应强烈的具体动作
  // 情感与依恋（关系走向的底层驱动）
  { key: '恋爱观',     label: '恋爱观',         alias: '恋爱观' },
  { key: '依恋类型',   label: '依恋类型',       alias: '依恋类型', inline: true }, // 安全/焦虑/回避型
  { key: '对主角期待', label: '对主角的隐秘期待', alias: '对主角期待' },
  // 心理软肋（调教/攻略的抓手·区别于原则底线）
  { key: '心结软肋',   label: '心结·软肋',      alias: '心结软肋' },
  { key: '执念渴望',   label: '执念·渴望',      alias: '执念渴望' },
  { key: '雷点禁忌',   label: '雷点·禁忌',      alias: '雷点禁忌' },
  { key: '当前心事',   label: '当前心事',       alias: '当前心事' },
  // 好恶趣味（非性·增强代入）
  { key: '喜好',       label: '喜好',           alias: '喜好' },
  { key: '厌恶',       label: '厌恶',           alias: '厌恶' },
  { key: '癖好趣味',   label: '癖好趣味',       alias: '癖好趣味' },
];

export const PRIVATE_KEYS = new Set(PRIVATE_COLS.flatMap((c) => [c.key, c.alias]));
