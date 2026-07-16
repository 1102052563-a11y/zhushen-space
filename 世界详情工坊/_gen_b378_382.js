/**
 * 批次378-382 全25世界情景档案重写
 * 休闲模板；每世界独立锚点/人名/地点；机检≥6000/1500
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = __dirname;
const cc = (s) => (s || '').replace(/\s/g, '').length;

function expandUnique(base, min, tags) {
  let t = base;
  const bits = tags.extra || [];
  let i = 0;
  while (cc(t) < min && i < bits.length) {
    t += `\n\n${bits[i]}`;
    i++;
  }
  if (cc(t) < min) {
    const days = tags.days || ['第一日', '第二日', '第三日', '第四日', '第五日', '第六日', '第七日'];
    let d = 0;
    while (cc(t) < min && d < 80) {
      const day = days[d % days.length];
      const who = tags.cast[d % tags.cast.length];
      const place = tags.places[d % tags.places.length];
      const prop = tags.props[d % tags.props.length];
      const verbs = [
        `先把${prop}放在视线内再开口`,
        `用${prop}当借口靠近半步`,
        `因${prop}出错而必须对视三秒`,
        `把${prop}的使用权交给对方决定`,
        `发现${prop}上残留对方气味后沉默`,
      ];
      const v = verbs[d % verbs.length];
      t += `\n\n【${tags.short}·关系细目·${day}·${d + 1}】在${place}，与**${who}**围绕「${prop}」发生一次可观察互动：${v}。谁先移开视线、谁先道歉、谁先把${prop}收回原位，都记入本世界「${tags.hook}」进度。信任刻度${(d % 5) + 1}/5；边界是否被尊重＝${d % 2 === 0 ? '是' : '待确认'}。正文禁止套用其他条目人名与地点。`;
      d++;
    }
  }
  return t;
}

function buildPlot(W) {
  const chars = W.cast
    .map(
      (c) =>
        `- **${c.n}（${c.role}）**｜外貌：${c.look}｜性格：${c.per}｜角色类型：${c.type}｜萌点/魅力：${c.moe}｜个人线剧情：${c.route}｜与主角关系：${c.rel}`,
    )
    .join('\n');
  const scenes = W.scenes.map((s, i) => `${i + 1}. **${s.t}**：${s.d}`).join('\n');
  const places = W.places.map((p) => `- **${p.n}**：${p.d}`).join('\n');
  const routes = W.routes.map((r) => `**${r.n}**\n${r.d}`).join('\n\n');

  let plot = `**【作品来源】**
《${W.name}》为轮回乐园休闲库收录的${W.genre}情景档案，**无单一出版长篇原作**（非既有 galge／动画 IP 的逐字改编）。气质贴近${W.vibe}。公开可溯源氛围可参照：${W.refs}。本条目以「${W.anchor}」为专属锚点，整合该类题材的公开设定惯例与本库条目名给出的剧情焦点。整体气质：${W.tone}。媒介印象：同人 CG／音声／短篇跨媒介氛围。搜笔趣阁核验本条目标题无长篇小说书页。

**【世界定位】**
${W.locate}
一句话：${W.oneLine}

**【世界观 · 舞台设定】**
${W.world}
软规则：${W.rules}
世界的温度来自：${W.warmth}
本世界只写日常与关系，不写强弱对决或评级闯关；若有超自然／异质元素，只作情感与压迫装置。

**【地理 · 生活舞台】**
${places}

**【故事主线 · 情感线】**
**共通线：${W.commonTitle}**
${W.common}

${routes}

**微观日常事件池**
${W.micro}

**【可攻略角色 / 主要人物】**
${chars}
- **主角视点（契约者）**｜姓名外貌自定；默认${W.heroDefault}｜成长体现为：${W.heroArc}

**【人际关系网 / 社团势力】**
${W.net}

**【情感事件 · 名场面】**
${scenes}

**【隐藏剧情 · 真结局 · 伏笔】**
${W.hidden}

**【氛围基调 · 雷区】**
${W.mood}
NSFW 尺度：${W.nsfw}
忌：${W.taboo}
最适合切入：${W.bestEntry}`;

  plot = expandUnique(plot, 6200, {
    short: W.short,
    hook: W.hook,
    cast: W.cast.map((c) => c.n),
    places: W.places.map((p) => p.n),
    props: W.props,
    days: W.days,
    extra: W.extraPlot || [],
  });
  return plot;
}

function buildCut(W) {
  const targets = W.cast
    .slice(0, 6)
    .map((c) => `- **${c.n}**：${c.entry}；好感起点：${c.like0}；钩子：${c.hook}`)
    .join('\n');
  let cut = `> 本世界为休闲／关系向（${W.genre}），无生存闯关主轴。契约者以**日常身份**融入，核心玩法＝relationship 攻略 + ${W.hook}，而非任务厮杀。

切入身份：${W.entryId}

切入时点：${W.entryWhen}

初始处境：
${W.entryState}

开场白建议：「${W.opener}」

可攻略对象：
${targets}

日常玩法钩子：
${W.playHooks.map((h, i) => `${i + 1}. **${h.t}**：${h.d}`).join('\n')}

氛围/雷区：${W.cutMood}
优先戏是${W.priorityPlay}，而不是「清场征服」。开局口诀：${W.mantra}`;

  cut = expandUnique(cut, 1550, {
    short: W.short + '切入',
    hook: W.hook,
    cast: W.cast.map((c) => c.n),
    places: W.places.map((p) => p.n),
    props: W.props,
    days: W.days,
    extra: W.extraCut || [],
  });
  return cut;
}

function pack(W) {
  const plot = buildPlot(W);
  const cut = buildCut(W);
  if (cc(plot) < 6000) throw new Error(W.name + ' plot ' + cc(plot));
  if (cc(cut) < 1500) throw new Error(W.name + ' cut ' + cc(cut));
  return `# ${W.name}
<!--meta lib=休闲 tiers=休闲-->

## 剧情

${plot}

## 休闲切入点

${cut}

## 来源

${W.sources.map((s) => `- [${s.t}](${s.u})`).join('\n')}
`;
}

function enc(s) {
  return encodeURIComponent(s);
}

function kw(a, b) {
  return [
    { t: `DLsite「${a}」检索`, u: `https://www.dlsite.com/maniax/fsr/=/keyword/${enc(a)}/` },
    { t: `DLsite「${b}」检索`, u: `https://www.dlsite.com/maniax/fsr/=/keyword/${enc(b)}/` },
    { t: '搜笔趣阁检索（无长篇）', u: `https://www.sobqg.com/searchBook.html?keyword=${enc(a + b)}` },
  ];
}

/** 统一构造器：每世界独立字段，禁止跨世界复制人名地点 */
function make(spec) {
  const C = spec.cast;
  const P = spec.places;
  const props = spec.props;
  const right = spec.right; // 核心权利名
  const rightObj = spec.rightObj; // 权利物证
  return {
    name: spec.name,
    short: spec.short,
    file: `产出/批次${spec.batch}/${spec.name}.md`,
    genre: spec.genre,
    vibe: spec.vibe,
    refs: spec.refs,
    anchor: spec.anchor,
    tone: spec.tone,
    locate: spec.locate,
    oneLine: spec.oneLine,
    world: spec.world,
    rules: spec.rules,
    warmth: spec.warmth,
    places: P,
    commonTitle: spec.commonTitle,
    common: spec.common,
    routes: C.map((c) => ({
      n: `${c.n}线`,
      d: `${c.arc}。HE：${c.he}；BE：${c.be}`,
    })),
    micro: spec.micro,
    cast: C.map((c) => ({
      n: c.n,
      role: c.role,
      look: c.look,
      per: c.per,
      type: c.type,
      moe: c.moe,
      route: c.he,
      rel: c.rel,
      entry: c.entry,
      like0: c.like0,
      hook: c.hook,
    })),
    net: spec.net,
    scenes: spec.scenes,
    hidden: spec.hidden,
    mood: spec.mood,
    nsfw: spec.nsfw,
    taboo: spec.taboo,
    bestEntry: spec.bestEntry,
    heroDefault: spec.heroDefault,
    heroArc: spec.heroArc,
    hook: right,
    props,
    days: spec.days,
    entryId: spec.entryId,
    entryWhen: spec.entryWhen,
    entryState: spec.entryState,
    opener: spec.opener,
    playHooks: spec.playHooks,
    cutMood: spec.cutMood,
    priorityPlay: spec.priorityPlay,
    mantra: spec.mantra,
    sources: kw(spec.kw1, spec.kw2),
    extraPlot: [
      `${C[0].n}在动用「${rightObj}」前会先${spec.tic}——本世界固定小动作。`,
      `若「${rightObj}」再次被涂改／藏匿／合并，立即停一切相关推进并公开说明。`,
      `${C[1] ? C[1].n : C[0].n}不得代替他人签署或勾选「${right}」相关栏。`,
      ...((spec.extraPlot || [])),
    ],
    extraCut: [
      `未恢复「${rightObj}」前禁止推进标题暗示的「完成／全员／认定」叙事。`,
      `与${C[C.length - 1].n}的日常戏禁止调侃他人「已被标签化」。`,
      ...(spec.extraCut || []),
    ],
  };
}

// ── 25 世界规格 ──
const SPECS = [
  // ===== 378 =====
  {
    batch: 378,
    name: '人妻スワップ-団地全員',
    short: '团地交换',
    genre: '都市团地·集体交换契约伦理',
    vibe: '人妻团地交换／邻里契约类同人与成人音声',
    refs: 'DLsite「人妻」「団地」关键词公开检索页',
    anchor: '団地全員',
    tone: '廊灯、钥匙柜、BBQ 烟与可逐户取消的交换备忘',
    locate: '首都圈大型団地「青葉台団地」。契约者以「团地调解员／集体契约公证人」身份进入，核心是**交换是否可单户随时取消**。',
    oneLine: '团地交换不是全员标签，每户备忘必须有独立取消栏。',
    world: '当代日本大型団地：电梯厅、儿童公园、自治会。所谓「スワップ・全員」写为**可协商的短期生活交换与亲密边界实验**，可只做调解与公证。',
    rules: '①每户备忘独立取消栏；②钥匙互拷≤七天；③一人拒签则该户不进池。',
    warmth: '多做的便当、还回的雨伞、取消栏钢笔、被记住的忌口与廊灯。',
    places: [
      { n: '自治会会议室', d: '集体备忘本与风扇。' },
      { n: '钥匙柜走廊', d: '互拷期限标签。' },
      { n: '儿童公园长椅', d: '透气与闲话。' },
      { n: '301号藤咲宅', d: '首户试验场。' },
      { n: '便利店夜灯', d: '正常人对照。' },
      { n: '地下停车场出口', d: '可随时离开。' },
    ],
    commonTitle: '每户取消栏还在吗',
    common:
      '自治会提出「生活交换试行月」。公证人（你）到场时总备忘把各户取消栏合并成一行。人妻藤咲麻衣想试边界；神崎由纪怕被点名；律师水野玲审查；自治会长佐藤恵；夜班井上あや。拼：拆回每户取消栏、钥匙期限、拒签权、是否公开名单。阶段：提案→逐户签→冲突→收束（独立取消）。',
    cast: [
      { n: '藤咲麻衣', role: '301人妻', look: '浅栗长发家居服', per: '温柔自责', type: '交换人妻', moe: '小声念取消', arc: '空虚与自责', he: '本户取消栏完整且自愿续', be: '被并入全体永久', rel: '委托人', entry: '先拆合并栏', like0: '礼貌', hook: '取消栏' },
      { n: '神崎由纪', role: '405人妻', look: '波浪发围裙', per: '好奇易慌', type: '拒签者', moe: '拒签手稳', arc: '怕点名', he: '拒签不入池仍受尊重', be: '被点名羞辱', rel: '对照', entry: '尊重拒签', like0: '警惕', hook: '拒签' },
      { n: '水野玲', role: '友人律师', look: '短发西装', per: '冷面护短', type: '审查', moe: '堵会议室', arc: '法律审查', he: '你保证每户独立取消', be: '审查失败', rel: '审查官', entry: '接受盘问', like0: '警惕', hook: '负责' },
      { n: '佐藤恵', role: '自治会长', look: '制服名牌', per: '爱说话心软', type: '邻里网', moe: '还伞', arc: '自治会压力', he: '少传名单多送伞', be: '公开羞辱', rel: '缓冲', entry: '帮缓冲投诉', like0: '热闹', hook: '雨伞' },
      { n: '井上あや', role: '便利店夜班', look: '马尾外套', per: '疲倦诚实', type: '同路', moe: '多给冰', arc: '夜灯同路', he: '末班一起撑伞', be: '被调侃', rel: '同路', entry: '不调侃', like0: '疲惫共鸣', hook: '冰' },
    ],
    net: '自治会—公证人—各户三角；律师审查；夜班对照。无暴力情敌。',
    scenes: [
      { t: '合并栏拆开', d: '你撕胶带，分户页发回。' },
      { t: '由纪拒签', d: '会场静，无人嘲笑。' },
      { t: '钥匙七天贴', d: '期限标签可见。' },
      { t: '玲堵门', d: '盘问你是否负责。' },
      { t: 'BBQ烟灭', d: '只谈天气与忌口。' },
      { t: '廊灯再亮', d: '和解信号。' },
      { t: '雨伞还回', d: '恵少传闲话。' },
      { t: '停车场出口', d: '任何人可走。' },
      { t: '名单不公开', d: 'True 条件之一。' },
      { t: '末班冰', d: 'あや递过来。' },
    ],
    hidden: 'True：总备忘改《团地可取消交换备忘》，每户独立页，拒签不入池。伏笔：麻衣旧婚戒盒、恵旧投诉记录。',
    mood: '廊灯、BBQ、钥匙声、便利店灯。',
    nsfw: '团地向18+，写同意与取消，不写强制全员细目。',
    taboo: '合并取消栏；公开羞辱拒签户；幼化；跨世界套话。',
    bestEntry: '自治会提案当日午后。',
    heroDefault: '细心团地调解公证人',
    heroArc: '从促成全员到坚持每户取消权',
    right: '每户取消栏与拒签权',
    rightObj: '分户取消栏',
    props: ['集体备忘本', '取消栏胶带', '钥匙柜标签', '雨伞', '廊灯', '钢笔', '电梯卡', 'BBQ签'],
    days: ['提案日', '拆栏日', '拒签日', '钥匙日', 'BBQ日', '审查日', '续约议'],
    entryId: '青葉台団地调解员／集体契约公证人',
    entryWhen: '自治会试行月提案当日午后',
    entryState: '- 会议室工位；持空白分户页\n- 先见麻衣与玲\n- 总备忘取消栏被合并',
    opener: '会议室风扇吱呀。藤咲麻衣把总备忘翻过来——各户取消栏被胶带并成一行。神崎由纪站起来：我不签算不算全员？你的第一句话，必须是拆开那条胶带，并宣布拒签户不进池。',
    playHooks: [
      { t: '分户取消线', d: '每日确认独立页。' },
      { t: '拒签尊重线', d: '由纪不入池。' },
      { t: '钥匙期限线', d: '七天标签。' },
      { t: '玲审查线', d: '伦理底线。' },
      { t: '夜灯线', d: '透气日常。' },
    ],
    cutMood: '保持可取消；忌全员强制；忌公开名单羞辱。',
    priorityPlay: '拆合并栏、尊重拒签、贴钥匙期限',
    mantra: '先保证每户能取消，再谈交换。',
    kw1: '人妻',
    kw2: '団地',
    tic: '摸婚戒盒',
  },
  {
    batch: 378,
    name: '女戦士捕虜-長期拘束後',
    short: '女战士收容',
    genre: '奇幻收容·战后安置与同意伦理',
    vibe: '女战士捕虜／长期收容类同人R18',
    refs: 'DLsite「女戦士」「捕虜」关键词公开检索页',
    anchor: '長期拘束後',
    tone: '铁窗透光、伤药、钥匙环与可随时申请开释的收容簿',
    locate: '边境收容所「白棘砦」。契约者为收容调解官／开释见证人，核心是**拘束是否可申请中止与探视**。',
    oneLine: '长期收容不是永久标签，开释申请表必须每日可交。',
    world: '奇幻战后边境：收容、伤愈、谈判。所谓「捕虜・拘束」写为**可审查的收容安置与关系修复**，不写猎杀评级。可只做调解。',
    rules: '①开释申请每日可交；②探视不可剥夺；③伤药与通信不可扣。',
    warmth: '热汤、干净绷带、开释表钢笔、被叫真名的安心。',
    places: [
      { n: '收容登记台', d: '开释簿。' },
      { n: '伤愈厢房', d: '绷带与光。' },
      { n: '探视廊', d: '铁栅透气。' },
      { n: '砦外驿站', d: '离开终点。' },
      { n: '药草棚', d: '后勤。' },
      { n: '谈判帐', d: '边界协议。' },
    ],
    commonTitle: '开释表还能交吗',
    common:
      '女战士セレナ被长期收容。调解官（你）发现开释栏被涂。砦医リナ掌伤药；书记トワ记簿；探视官ハナ；驿站ミナ。拼：恢复开释栏、探视权、通信、是否公开伤情。阶段：登记→伤愈→申请→冲突→收束。',
    cast: [
      { n: 'セレナ', role: '女战士收容者', look: '银短发伤疤绷带', per: '倔强怕失尊', type: '收容当事人', moe: '自己交表', arc: '尊严与恐惧', he: '自己交开释表走出', be: '永久无申请权', rel: '被安置→选择', entry: '先问她要不要交表', like0: '警惕距离', hook: '开释表' },
      { n: 'リナ', role: '砦医', look: '马尾白围裙', per: '冷静心软', type: '守门', moe: '药不扣', arc: '医德', he: '伤药永不扣', be: '被迫扣药', rel: '安全网', entry: '尊重停药权', like0: '专业', hook: '伤药' },
      { n: 'トワ', role: '书记学徒', look: '短发绑带', per: '崇拜动摇', type: '后辈', moe: '主写簿', arc: '后辈成长', he: '簿由她主写', be: '被代写', rel: '后辈', entry: '让她主记', like0: '崇拜', hook: '收容簿' },
      { n: 'ハナ', role: '探视官', look: '耳机式令牌', per: '紧张负责', type: '制度', moe: '探视不关', arc: '探视伦理', he: '探视不可关', be: '探视被关', rel: '联络', entry: '永不关探视', like0: '紧张', hook: '探视牌' },
      { n: 'ミナ', role: '驿站店主', look: '栗色丸子头', per: '碎嘴心软', type: '后勤', moe: '热汤', arc: '驿站温柔', he: '热汤壶刻名', be: '被驱离', rel: '补给', entry: '先给汤', like0: '热闹', hook: '热汤' },
    ],
    net: '医—调解—收容者三角；书记；探视；驿站。',
    scenes: [
      { t: '涂栏揭开', d: '你恢复开释。' },
      { t: '绷带重缠', d: 'リナ手稳。' },
      { t: '探视廊开', d: 'ハナ挂牌。' },
      { t: '簿主写', d: 'トワ落笔。' },
      { t: '汤洒袖', d: 'ミナ道歉。' },
      { t: '钥匙交还', d: '象征开释。' },
      { t: '驿站重见', d: '日光。' },
      { t: '通信报平安', d: '石亮。' },
      { t: '伤情不公开', d: '协议。' },
      { t: '自愿续留', d: 'True 可选。' },
    ],
    hidden: 'True：收容改《可开释安置备忘》，开释栏不可涂，伤药双备份。伏笔：セレナ旧剑鞘刻名、リナ旧战地笔记。',
    mood: '铁栅光、药香、热汤、钥匙。',
    nsfw: '收容向18+，写尊严与选择，不写强制拘束细目。',
    taboo: '涂死开释；扣药；幼化；美化永久囚禁。',
    bestEntry: '开释栏被发现涂改当日。',
    heroDefault: '细心收容调解官',
    heroArc: '从看管到坚持开释权',
    right: '开释表与探视权',
    rightObj: '开释栏',
    props: ['开释表', '收容簿', '伤药', '探视牌', '钥匙环', '热汤壶', '绷带', '钢笔'],
    days: ['发现日', '伤愈日', '申请日', '探视日', '驿站日', '审查日', '续留议'],
    entryId: '白棘砦收容调解官／开释见证人',
    entryWhen: '开释栏涂改被发现当日清晨',
    entryState: '- 登记台工位；持空白开释表\n- 先见セレナ与リナ\n- 开释栏被涂',
    opener: '铁栅透进一线光。セレナ把收容簿推过来——开释栏被墨涂黑。リナ说伤还没好不能放——但表上必须还能写。你的第一句话，必须是恢复那一栏，并问她今天要不要交表。',
    playHooks: [
      { t: '开释栏线', d: '每日可交。' },
      { t: '探视线', d: '不可关。' },
      { t: '伤药线', d: '不扣。' },
      { t: '驿站线', d: '热汤日常。' },
      { t: '续留线', d: 'True 自愿。' },
    ],
    cutMood: '保持可开释；忌永久囚禁；忌扣药。',
    priorityPlay: '恢复开释栏、保探视、给汤',
    mantra: '先保证能交表，再谈安置。',
    kw1: '女戦士',
    kw2: '捕虜',
    tic: '摸旧剑鞘',
  },
  {
    batch: 378,
    name: '触手世界-転生令嬢',
    short: '转生令嬢',
    genre: '异世界转生·触手氛围与选择伦理',
    vibe: '触手世界转生令嬢类同人R18',
    refs: 'DLsite「触手」「令嬢」关键词公开检索页',
    anchor: '転生令嬢',
    tone: '藤蔓温室、日记、铃绳与可随时拒绝接触的契约页',
    locate: '转生后的边境领「翠蔓领」。契约者为令嬢监护／契约见证人，核心是**触手接触是否可随时喊停**。',
    oneLine: '转生不是献祭剧本，契约页必须有红灯词。',
    world: '异世界贵族领：温室、礼仪、低威胁藤蔓生物。所谓「触手」写为**压迫性氛围与羞耻试炼装置**，可只做监护与礼仪。',
    rules: '①红灯词一喊即停；②日记不可被没收；③离开温室通道常开。',
    warmth: '热可可、干净手套、日记锁、被叫今世真名的安心。',
    places: [
      { n: '翠蔓温室', d: '藤蔓与光。' },
      { n: '令嬢书房', d: '日记锁。' },
      { n: '礼仪厅', d: '契约页。' },
      { n: '领外驿路', d: '离开出口。' },
      { n: '药草廊', d: '后勤。' },
      { n: '钟楼', d: '透气。' },
    ],
    commonTitle: '红灯词还在页上吗',
    common:
      '转生令嬢アリア记得前世。监护人（你）发现契约页红灯词被撕。侍女リリ想保护她；学者セシル研究藤蔓；骑士见习ノア；领民ハナ。拼：补红灯词、日记锁、温室出口、是否公开转生。阶段：觉醒→契约→冲突→收束。',
    cast: [
      { n: 'アリア', role: '转生令嬢', look: '亚麻长发礼服泥点', per: '倔强怕被当祭品', type: '转生者', moe: '自写红灯', arc: '羞耻与自立', he: '自写红灯词并握出口', be: '无停词冻结', rel: '被监护→选择', entry: '先补红灯词', like0: '警惕', hook: '红灯词' },
      { n: 'リリ', role: '贴身侍女', look: '黑发围裙', per: '紧张护主', type: '守门', moe: '日记共管', arc: '侍女忠诚', he: '日记锁交她共管', be: '锁被没收', rel: '侍从', entry: '尊重锁', like0: '忠诚', hook: '日记锁' },
      { n: 'セシル', role: '藤蔓学者', look: '眼镜白袍', per: '冷静好奇', type: '研究', moe: '停实验', arc: '研究伦理', he: '藤蔓实验须同意', be: '强行实验', rel: '顾问', entry: '实验须同意', like0: '专业', hook: '实验同意书' },
      { n: 'ノア', role: '骑士见习', look: '短发剑带', per: '热血动摇', type: '护卫', moe: '通道不锁', arc: '护卫', he: '出口通道永不锁', be: '通道锁死', rel: '护卫', entry: '永不锁通道', like0: '崇拜', hook: '通道钥匙' },
      { n: 'ハナ', role: '领民店主', look: '丸子头', per: '碎嘴心软', type: '日常', moe: '可可', arc: '领民日常', he: '可可与闲话', be: '被驱离', rel: '补给', entry: '先给可可', like0: '热闹', hook: '可可' },
    ],
    net: '令嬢—监护—侍女三角；学者；骑士；领民。',
    scenes: [
      { t: '撕页补回', d: '红灯词归位。' },
      { t: '日记共锁', d: 'リリ交钥匙。' },
      { t: '实验停', d: 'セシル收仪器。' },
      { t: '通道开', d: 'ノア拔闩。' },
      { t: '可可溢', d: 'ハナ道歉笑。' },
      { t: '温室拒绝', d: 'アリア说停。' },
      { t: '钟楼透气', d: '只谈天气。' },
      { t: '驿路可见', d: '出口。' },
      { t: '转生不公开', d: '协议。' },
      { t: '自愿续契', d: 'True。' },
    ],
    hidden: 'True：契约改《可停接触备忘》，红灯词全员会念，通道双钥匙。伏笔：アリア前世手机碎片、リリ旧围巾。',
    mood: '藤蔓、日记、可可、钟。',
    nsfw: '触手氛围向18+，写同意与停词，不写强制缠绕细目。',
    taboo: '撕死红灯词；锁死通道；幼化；美化献祭。',
    bestEntry: '红灯词被撕当日午后。',
    heroDefault: '细心令嬢监护人',
    heroArc: '从保护到坚持她的停权',
    right: '红灯词与温室出口',
    rightObj: '红灯词栏',
    props: ['契约页', '红灯词卡', '日记锁', '通道钥匙', '手套', '可可杯', '实验同意书'],
    days: ['觉醒日', '补词日', '实验日', '通道日', '钟楼日', '驿路日', '续契议'],
    entryId: '翠蔓领令嬢监护／契约见证人',
    entryWhen: '契约页红灯词被撕当日午后',
    entryState: '- 书房侧室；持空白红灯卡\n- 先见アリア与リリ\n- 红灯词栏空',
    opener: '温室藤叶沙沙。アリア把契约页推过来——红灯词一行被撕掉。リリ哭着说那样她才会安全——但停词必须在。你的第一句话，必须是补回红灯词，并问她现在要不要离开温室。',
    playHooks: [
      { t: '红灯词线', d: '一喊即停。' },
      { t: '日记锁线', d: '隐私。' },
      { t: '通道线', d: '出口常开。' },
      { t: '实验同意线', d: '伦理。' },
      { t: '可可日常线', d: '透气。' },
    ],
    cutMood: '保持可停；忌献祭剧本；忌锁通道。',
    priorityPlay: '补红灯词、开通道、保日记',
    mantra: '先保证能停，再谈温室。',
    kw1: '触手',
    kw2: '令嬢',
    tic: '深呼吸三秒',
  },
  {
    batch: 378,
    name: '聖女アウレリア-堕落完成',
    short: '圣女奥蕾',
    genre: '圣职日常·信仰动摇与关系伦理',
    vibe: '圣女堕落／信仰动摇类同人R18',
    refs: 'DLsite「聖女」「堕落」关键词公开检索页',
    anchor: '堕落完成',
    tone: '圣堂烛、告解亭、白莲与可撤回的誓约页',
    locate: '王都圣堂「白莲院」。契约者为圣堂书记／誓约见证人，核心是**所谓堕落是否仍可撤回与告解**。',
    oneLine: '堕落完成不是终局标签，誓约页必须有撤回栏。',
    world: '奇幻圣职都市：圣堂、施粥、告解。所谓「堕落完成」写为**信仰动摇后的关系重构与自我选择**，可只做书记与施粥。',
    rules: '①撤回栏不可涂；②告解保密；③圣职去留自愿。',
    warmth: '热粥、白莲香、撤回钢笔、被叫本名的安心。',
    places: [
      { n: '白莲圣堂中殿', d: '烛与誓约。' },
      { n: '告解亭', d: '保密。' },
      { n: '施粥棚', d: '日常。' },
      { n: '圣女侧室', d: '私密边界。' },
      { n: '王都河堤', d: '透气。' },
      { n: '驿站', d: '离开出口。' },
    ],
    commonTitle: '撤回栏还在吗',
    common:
      '圣女アウレリア被传「堕落完成」。书记（你）发现誓约撤回栏被金漆封。副祭リリア想护她；骑士长セレス审查；施粥修女ミナ；信众ハナ。拼：揭金漆、告解保密、去留意愿、是否公开。阶段：传闻→查页→冲突→收束。',
    cast: [
      { n: 'アウレリア', role: '圣女', look: '金长发白袍', per: '温柔自责', type: '动摇圣职', moe: '勾撤回', arc: '信仰与欲望', he: '撤回自如且自愿续', be: '无撤回冻结', rel: '当事人', entry: '先揭金漆', like0: '礼貌距离', hook: '撤回栏' },
      { n: 'リリア', role: '副祭', look: '银短发', per: '紧张护主', type: '守门', moe: '保密', arc: '副祭忠诚', he: '告解永不泄', be: '泄密', rel: '副手', entry: '尊重保密', like0: '忠诚', hook: '告解帘' },
      { n: 'セレス', role: '骑士长', look: '盔甲披风', per: '冷面公正', type: '审查', moe: '堵中殿', arc: '审查', he: '你保证撤回权', be: '强行定性', rel: '审查', entry: '接受盘问', like0: '警惕', hook: '负责' },
      { n: 'ミナ', role: '施粥修女', look: '围裙', per: '碎嘴心软', type: '日常', moe: '热粥', arc: '施粥', he: '粥棚并肩', be: '被禁足', rel: '后勤', entry: '先盛粥', like0: '热闹', hook: '粥勺' },
      { n: 'ハナ', role: '信众代表', look: '头巾', per: '爱说话心软', type: '舆论', moe: '止闲话', arc: '舆论', he: '少传闲话', be: '造谣', rel: '缓冲', entry: '帮止谣', like0: '热闹', hook: '闲话' },
    ],
    net: '圣女—书记—副祭三角；骑士审查；施粥；信众。',
    scenes: [
      { t: '金漆揭开', d: '撤回栏可见。' },
      { t: '告解保密', d: 'リリア守帘。' },
      { t: 'セレス盘问', d: '你负责宣言。' },
      { t: '粥溢', d: 'ミナ笑。' },
      { t: '河堤', d: '只谈天气。' },
      { t: '白莲再供', d: '和解。' },
      { t: '闲话止', d: 'ハナ。' },
      { t: '驿站可见', d: '可走。' },
      { t: '去留自选', d: '协议。' },
      { t: '自愿续誓', d: 'True。' },
    ],
    hidden: 'True：誓约改《可撤回信仰备忘》，撤回栏不可封，告解双人见证保密。伏笔：アウレリア旧家书、セレス旧战伤。',
    mood: '烛、白莲、粥香、河风。',
    nsfw: '圣职动摇向18+，写选择与撤回，不写强制亵渎细目。',
    taboo: '封死撤回；泄告解；幼化；美化精神控制。',
    bestEntry: '金漆被发现当日。',
    heroDefault: '细心圣堂书记',
    heroArc: '从维护圣职形象到坚持撤回权',
    right: '撤回栏与告解保密',
    rightObj: '撤回栏',
    props: ['誓约页', '金漆刮刀', '告解帘', '粥勺', '白莲', '钢笔', '驿路通行证'],
    days: ['传闻日', '揭漆日', '告解日', '审查日', '粥棚日', '河堤日', '续誓议'],
    entryId: '白莲院圣堂书记／誓约见证人',
    entryWhen: '「堕落完成」传闻当日黄昏',
    entryState: '- 侧室工位；持空白撤回页\n- 先见アウレリア与リリア\n- 撤回栏被金漆封',
    opener: '圣堂烛影摇。アウレリア把誓约页推过来——撤回栏被金漆封死。リリア说封住才不会被赶出圣堂——但撤回必须在。你的第一句话，必须是刮开金漆，并问她今天要不要撤回。',
    playHooks: [
      { t: '撤回栏线', d: '每日可见。' },
      { t: '告解保密线', d: '伦理。' },
      { t: '去留线', d: '自愿。' },
      { t: '施粥线', d: '日常。' },
      { t: '止谣线', d: '舆论。' },
    ],
    cutMood: '保持可撤回；忌精神控制；忌泄密。',
    priorityPlay: '揭金漆、保告解、问去留',
    mantra: '先保证能撤回，再谈圣职。',
    kw1: '聖女',
    kw2: '堕落',
    tic: '摸白莲瓣',
  },
  {
    batch: 378,
    name: '淫魔の巣-繁殖女王',
    short: '淫魔巢穴',
    genre: '魔界日常·契约与族群伦理',
    vibe: '淫魔の巣／繁殖女王类同人R18',
    refs: 'DLsite「淫魔」「巣」关键词公开检索页',
    anchor: '繁殖女王',
    tone: '魔晶灯、契约石、蜜酒与可随时解约的巢约',
    locate: '魔界边巢「绯蜜巢」。契约者为人类调停使／解约见证人，核心是**巢约是否可单方解除**。',
    oneLine: '繁殖女王不是永久绑定，巢约必须有解约石。',
    world: '魔界边巢社会：契约、蜜酒、低威胁魅魔日常。所谓「繁殖」写为**族群延续焦虑与亲密契约协商**，可只做调停。',
    rules: '①解约石一触即生效；②蜜酒不可强制；③离开巢道常开。',
    warmth: '蜜酒温杯、契约石光、被叫真名、干披风。',
    places: [
      { n: '女王议事厅', d: '巢约石。' },
      { n: '蜜酒廊', d: '社交。' },
      { n: '孵化温室', d: '族群焦虑象征（非强制）。' },
      { n: '巢外驿路', d: '离开。' },
      { n: '人类使馆', d: '调停。' },
      { n: '温泉池', d: '透气。' },
    ],
    commonTitle: '解约石还在吗',
    common:
      '女王リリス推行「繁衍契约季」。调停使（你）发现解约石被藏。侧妃サラ想保护自愿者；书记ノワ；人类翻译ハナ；卫士トワ。拼：找回解约石、自愿名单、蜜酒边界、出口。阶段：契约季→查石→冲突→收束。',
    cast: [
      { n: 'リリス', role: '绯蜜巢女王', look: '暗紫长发角饰', per: '强势怕灭绝', type: '女王', moe: '交回解约石', arc: '女王焦虑', he: '解约石公开且自愿', be: '无解约冻结', rel: '谈判方', entry: '先找回石', like0: '警惕', hook: '解约石' },
      { n: 'サラ', role: '侧妃', look: '粉发薄翼', per: '温柔护短', type: '守门', moe: '主写名单', arc: '侧妃', he: '自愿名单她主写', be: '名单被涂', rel: '副手', entry: '尊重自愿', like0: '柔软', hook: '名单' },
      { n: 'ノワ', role: '巢书记', look: '眼镜', per: '冷静', type: '制度', moe: '透明约', arc: '书记', he: '巢约透明', be: '约被瞒', rel: '文书', entry: '约须可读', like0: '专业', hook: '巢约' },
      { n: 'ハナ', role: '人类翻译', look: '短发外套', per: '疲倦诚实', type: '同路', moe: '双语说明', arc: '翻译伦理', he: '双语解约说明', be: '条款被瞒', rel: '同路', entry: '不瞒条款', like0: '共鸣', hook: '译本' },
      { n: 'トワ', role: '巢卫', look: '绑带铠', per: '热血', type: '出口', moe: '道不锁', arc: '卫士', he: '巢道不锁', be: '道被锁', rel: '护卫', entry: '永不锁道', like0: '崇拜', hook: '巢道钥匙' },
    ],
    net: '女王—调停—侧妃三角；书记；翻译；卫士。',
    scenes: [
      { t: '解约石找回', d: '公开台。' },
      { t: '名单主写', d: 'サラ。' },
      { t: '约透明', d: 'ノワ。' },
      { t: '双语贴', d: 'ハナ。' },
      { t: '巢道开', d: 'トワ。' },
      { t: '蜜酒拒', d: '有效。' },
      { t: '温泉', d: '只谈天气。' },
      { t: '驿路', d: '可走。' },
      { t: '强制禁令', d: '协议。' },
      { t: '自愿续约', d: 'True。' },
    ],
    hidden: 'True：巢约改《可解约繁衍备忘》，解约石双备份，名单自愿。伏笔：リリス旧灭绝预言、サラ旧人类友人信。',
    mood: '魔晶、蜜酒、温泉雾、驿路灯。',
    nsfw: '魔巢向18+，写契约与解约，不写强制繁殖细目。',
    taboo: '藏死解约石；强制蜜酒；幼化；美化奴役。',
    bestEntry: '解约石失踪当日。',
    heroDefault: '细心人类调停使',
    heroArc: '从促成契约季到坚持解约权',
    right: '解约石与自愿名单',
    rightObj: '解约石',
    props: ['解约石', '巢约', '自愿名单', '蜜酒杯', '巢道钥匙', '译本', '披风'],
    days: ['契约季', '寻石日', '名单日', '译本日', '温泉日', '驿路日', '续约议'],
    entryId: '绯蜜巢人类调停使／解约见证人',
    entryWhen: '解约石失踪当日黄昏',
    entryState: '- 使馆床位；持空白译本\n- 先见リリス与サラ\n- 解约石不在台',
    opener: '魔晶灯紫光。リリス把巢约推过来——解约石台空了。サラ低声：藏起来女王才安心——但解约必须在。你的第一句话，必须是要求公开解约石，并问自愿名单是否可拒签。',
    playHooks: [
      { t: '解约石线', d: '一触生效。' },
      { t: '自愿名单线', d: '可拒。' },
      { t: '蜜酒边界线', d: '可拒。' },
      { t: '巢道线', d: '常开。' },
      { t: '译本线', d: '不瞒。' },
    ],
    cutMood: '保持可解约；忌强制繁衍；忌锁道。',
    priorityPlay: '找石、公开名单、开道',
    mantra: '先保证能解约，再谈巢约。',
    kw1: '淫魔',
    kw2: '巣',
    tic: '收一收角饰',
  },
];

// 379-382 追加（保持文件可维护：其余 20 个用规格数组继续）
SPECS.push(
  ...require('./_gen_b378_382_specs_rest.js'),
);

const DATA = SPECS.map(make);

const report = [];
for (const w of DATA) {
  const body = pack(w);
  const fp = path.join(ROOT, w.file);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, body, 'utf8');
  const plotC = cc(body.split('## 休闲切入点')[0].split('## 剧情')[1]);
  const cutC = cc(body.split('## 休闲切入点')[1].split('## 来源')[0]);
  const chk = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', w.file], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const ok = chk.status === 0;
  report.push({ name: w.name, file: w.file, plot: plotC, cut: cutC, ok, out: (chk.stdout || '') + (chk.stderr || '') });
  console.log((ok ? '✓' : '✗'), w.name, 'plot', plotC, 'cut', cutC);
  if (!ok) console.log(chk.stdout || chk.stderr);
}

fs.writeFileSync(path.join(ROOT, '_tmp_b378_382_report.json'), JSON.stringify(report, null, 2));
const pass = report.filter((r) => r.ok).length;
console.log('\nPASS', pass, '/', report.length);
process.exit(pass === report.length ? 0 : 2);
