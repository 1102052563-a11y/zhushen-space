/* ══════════ 🎭 小剧场·花样模板库 · 纯逻辑层 ══════════
   借鉴 ST-SevenDaysCal「构画」的「棱·模板库」：把「这一则该怎么写」从**写死在提示词里的一行清单**
   变成**玩家可增删改的模板**。

   原状：MINI_THEATER_RULE 里硬编码 15 个风格词（「日常碎片 / 搞笑吐槽 / …」），玩家改不了、加不了、
   也没法只留自己爱看的那几种；而且只有词、没有写法指导，模型每次自由发挥、同质化。
   现状：每条模板 = 名字 + 一句**具体写法指导**；生成时只从**启用的**模板里随机抽 1~2 条注入。

   ⚠ 模板是玩家资产，不是存档进度 → theaterStore 是**配置类**（不给 clear，新游戏保留）。
   ⚠ 兜底：模板被全部禁用/删空时**回退内置全集**，绝不让小剧场因为空清单而写崩。 */

export interface TheaterTemplate {
  id: string;
  name: string;      // 花样名（如「四格漫画风」）
  prompt: string;    // 一句写法指导（注入给 AI）
  enabled: boolean;
  builtin: boolean;  // 内置（可禁用/可改/可删，删了「恢复内置」能找回来）
}

/** 内置花样：即原先写死在 MINI_THEATER_RULE 里那 15 个，每条补上具体写法指导。 */
export const BUILTIN_TEMPLATES: { id: string; name: string; prompt: string }[] = [
  { id: 'daily',     name: '日常碎片',      prompt: '写一段极其普通的日常片段：吃饭、赶路、发呆、排队、收拾东西。不要有事件，靠细节和小情绪撑起来。' },
  { id: 'banter',    name: '搞笑吐槽',      prompt: '让角色对某件小事持续吐槽，一句比一句离谱；旁人越正经，反差越好笑。' },
  { id: 'healing',   name: '治愈温情',      prompt: '写一个安静、暖的瞬间：递一杯水、留一盏灯、把外衣搭过去。不煽情，克制着写。' },
  { id: 'absurd',    name: '沙雕脑洞',      prompt: '把一个荒诞设定当真事严肃推演到底，角色全程一本正经，越正经越好笑。' },
  { id: 'fourkoma',  name: '四格漫画风',    prompt: '严格分四格：起、承、转、爆点。每格一到两句，最后一格必须有反转或吐槽。' },
  { id: 'mockdoc',   name: '伪采访·伪纪录片', prompt: '用纪录片旁白 + 角色对镜采访的形式写，旁白一本正经，采访内容却拆台。' },
  { id: 'whatif',    name: '「如果」架空',   prompt: '设一个「如果当时不是这样」的假设分支，把角色放进完全不同的处境里演一段。' },
  { id: 'dream',     name: '梦境',          prompt: '写一段梦：逻辑跳跃、意象怪诞、情绪却是真的；醒来时留一句余味。' },
  { id: 'food',      name: '美食料理',      prompt: '围绕做饭/吃饭展开：手艺灾难或意外好吃都行，重点写香味、口感和吃的人的反应。' },
  { id: 'festival',  name: '节日换装',      prompt: '给角色安排一个节日或场合，重点写换上的行头、别扭或得意的心情、旁人的反应。' },
  { id: 'gap',       name: '反差萌',        prompt: '让角色露出与其人设完全相反的一面，并且被人撞见；重点写被撞见那一刻。' },
  { id: 'latenight', name: '深夜对话',      prompt: '两人在深夜说话，白天不会说的话在这时说出口；写留白和沉默，别写满。' },
  { id: 'contest',   name: '才艺比拼',      prompt: '安排一场毫无意义的比拼（谁能憋气久、谁刀工好…），认真程度与事情的无聊程度成正比。' },
  { id: 'swap',      name: '身份互换',      prompt: '让两个角色互换身份/立场过一天，重点写各自不适应的地方和最后的理解。' },
  { id: 'chatlog',   name: '群聊截图风',    prompt: '整则用群聊消息的形式写：发言、撤回、表情、已读不回、突然有人 @ 全体。' },
];

/** 内置模板 → 完整条目（默认全部启用）。 */
export function buildBuiltinTemplates(): TheaterTemplate[] {
  return BUILTIN_TEMPLATES.map((t) => ({ ...t, enabled: true, builtin: true }));
}

/** 抽花样：只从启用的里抽；全禁用/空 → 回退内置全集（绝不返回空，否则注入块塌成空指令）。
    rand 可注入便于单测（默认 Math.random）。 */
export function pickTemplates(all: TheaterTemplate[] | undefined, count = 2, rand: () => number = Math.random): TheaterTemplate[] {
  const list = Array.isArray(all) ? all.filter((t) => t && t.enabled && String(t.name || '').trim()) : [];
  const pool = list.length ? list.slice() : buildBuiltinTemplates();
  const n = Math.max(1, Math.min(Math.floor(count) || 1, pool.length));
  const out: TheaterTemplate[] = [];
  for (let i = 0; i < n; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

/** 把抽中的花样拼成注入块（追加在人物档案之后）。空数组 → ''（调用方跳过）。 */
export function buildTheaterStyleBlock(picked: TheaterTemplate[]): string {
  const list = (picked ?? []).filter((t) => t && t.name);
  if (!list.length) return '';
  const body = list.map((t, i) => `${i + 1}. 【${t.name}】${t.prompt || ''}`).join('\n');
  const tail = list.length > 1
    ? '\n（两种花样可任选其一，也可揉在一起；别两则各写一种凑数。）'
    : '';
  return `【本次小剧场·花样（**本段优先于上面任何风格清单**，就按这里指定的写）】\n${body}${tail}`;
}
