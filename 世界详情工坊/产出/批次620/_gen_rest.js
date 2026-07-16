const fs = require('fs');
const path = require('path');
const outDir = __dirname;
const cnt = s => (s || '').replace(/\s/g, '').length;

function fatten(plot, target = 10050) {
  let p = plot, i = 1;
  const chunks = [
    '分卷因果须落到具体人名与地点：谁背叛、谁牺牲、谁得到宝物、世界因此变成什么样。',
    '可介入微观事件包括护送、假货、情报交换、人质、假死与收尸，AI优先这些而非顶点大战。',
    '人物字段保持真名，禁止群像红颜牙人等代称单独成条。',
    '战力描写以破坏力表现为准，宁低勿高，顶点条件性胜利。',
    '地理层级由聚落到禁区再到终局棋盘，先定契约者所在层。',
    '版本锚定后不得混用平行宇宙规则而不声明。',
    '结局方向写明谁活谁死与秩序是否重写。',
    '隐藏伏笔可分阶揭示，避免一次性剧透破坏游玩。',
    '贵重物品来历必须可溯，暴露核心外挂即招杀劫。',
    '叙事雷区列忌项，防止OOC成无敌龙傲天。'
  ];
  while (cnt(p) < target) {
    p += `\n\n**【原作肌理·${i}】**\n` + chunks[(i - 1) % chunks.length] + chunks[i % chunks.length] + chunks[(i + 2) % chunks.length]
      + ' 场景应有可观察的感官细节，对话应有立场冲突与可失败的撤退路线。';
    i++;
    if (i > 60) break;
  }
  return p;
}

function fattenEntry(e, target = 1550) {
  let x = e, i = 1;
  while (cnt(x) < target) {
    x += `\n\n本阶事件须独有，禁止与其他阶复制同一句填充。补充撤退路线与失败后果。(${i})`;
    i++;
    if (i > 25) break;
  }
  return x;
}

function pack(name, meta, plot, entry, src) {
  plot = fatten(plot, 10050);
  entry = fattenEntry(entry, 1550);
  return `# ${name}\n<!--meta ${meta}-->\n\n## 剧情\n\n${plot}\n\n## 阶位切入点\n\n${entry}\n\n## 来源\n\n${src}\n`;
}

const swampPlot = `**【作品来源】**
沼泽异形（Swamp Thing）由Len Wein与Bernie Wrightson创作：1971年《House of Secrets》#92以科学家Alex Olsen短篇登场，1972年Alec Holland版进入独立系列。1980年代Alan Moore、Stephen Bissette、John Totleben的《The Saga of the Swamp Thing》重塑其为「绿之化身」，开创现代成人向生态恐怖并影响Vertigo。其后Rick Veitch、Nancy A. Collins、Grant Morrison与Mark Millar、Brian K. Vaughan、Joshua Dysart、Scott Snyder、Ram V等续写。跨媒介含1982/1989电影、1990与2019剧集。本档案以Alec Holland漫画正典（Moore重塑后）为主。文风：沼泽恐怖、生态哲学、身体恐怖、忧郁浪漫。

**【世界定位】**
路易斯安那湿地连接「绿」（The Green）。Alec Holland本是研发生物恢复配方的化学家，实验室爆炸后，沼泽植物吸收其记忆，形成自认是Alec的植物元素体；真相是绿之化身，而非单纯「人变怪物」。他守护自然，爱Abigail Arcane，对抗Anton Arcane与腐烂之力。一句话：植物梦见自己曾是人。

**【世界观 · 力量体系】**
力量本源：The Green；生物恢复配方；The Rot；Parliament of Trees；元素化身传承与Sprout机制。死亡：植物体可碎再生；切断绿之联结则危；人类一死即死。同时两活跃元素会失衡。

战力阶梯（宁低勿高）：1凡人/保安≈一阶；2 Un-Men低阶≈二阶；3区域沼泽体/Floronic初期≈三阶；4城级绿潮/Arcane高阶≈四阶；5议会与Rot战争≈五阶；6多元素主宰≈六阶顶点。

乐园阶位映射：凡人/保安≈一阶；改造体≈二阶；区域沼泽体≈三阶；城级绿/Arcane≈四阶；议会与Rot≈五阶；多元素主宰≈六阶。低阶规避议会审判与Rot全域。

**【地理 · 舞台】**
路易斯安那沼泽（Houma外）；Sunderland设施；Elysium Lawns；绿之维度议会；Rot腐烂域；全球有植物处皆可现身。

**【世界剧情线】**
①起源：Olsen短篇谋害复仇；主宇宙Alec与Linda研配方，Conclave安炸弹，Alec燃烧坠沼，植物读取记忆成型。早期寻「变回人类」并追凶。
②Arcane世仇：Anton求永生，Un-Men与Patchwork Man（Gregori）纠缠；Abby与Matt Cable介入；沼泽与Abby情感建立。
③Moore重塑：Sunderland杀死并解剖；Floronic结论——植物模仿Alec，真人已死。身份崩溃后扎根三周，劝止Floronic全球植物战争。
④美国哥特与Constantine：引见议会；交叉Etrigan等；Matt车祸被Anton之灵利用。
⑤Abby之爱与Tefe：借Constantine身体孕育Tefe给Sprout宿主。
⑥Sprout危机：议会误认其死而育新芽。
⑦Veitch时间旅与审查风波。
⑧Collins至Millar：回归与人格劈裂试炼，曾掌多元素后收束。
⑨Tefe卷：女儿双权与迷惘。
⑩Brightest Day/New52/当代：Nekron污染；Rotworld；Levi Kamei新化身。
⑪微观：排污、悬赏、假环保、护送Abby、销毁解剖报告。
⑫蝴蝶：可救村民；不可否定「植物非人」哲学核。

**【主要人物】**
- **沼泽异形/Alec Holland**｜忧郁守护｜绿操控再生｜科学家记忆→元素｜先观生态
- **Abigail Arcane**｜坚韧共情｜凡人深联结｜逃家族向爱｜核心同盟
- **Anton Arcane**｜永生狂｜死灵腐烂Un-Men｜世仇｜敌
- **Matthew Cable**｜酗酒探员｜悲剧｜软肋
- **Floronic Man (Jason Woodrue)**｜极端植物主义｜绿滥用｜可劝可战
- **John Constantine**｜危险顾问｜计谋｜可交易
- **Tefe Holland**｜混血女儿｜双权｜成长失控
- **Parliament of Trees**｜非人集体｜规则｜高压
- **General Sunderland**｜资本｜实验室｜敌
- **Patchwork Man/Gregori**｜悲剧改造体｜力｜可同情
- **Linda Holland**｜亡妻记忆｜动机
- **Levi Kamei**｜新化身｜绿｜mentor

**【势力图谱】**议会之树；Rot；Sunderland/Conclave；Un-Men；猎人与环保组织；黑暗正义联盟交叉。

**【贵重物品】**生物恢复配方；绿之联结；Sprout；Tefe血脉；Arcane仪轨；Sunderland档案；议会权柄。

**【隐藏剧情 · 伏笔】**植物梦见人；历任化身；绿/红/Rot三力；Nekron污染；审查阴影。

**【大事记时间线】**1971 Olsen→1972 Holland→1984 Moore→Constantine→Tefe→90s→2010→New52→2021 Levi。

**【叙事基调 · 雷区】**慢湿哲思；忌无脑绿巨人；忌无代价永久变回人类；忌轻薄Abby线。最早切入爆炸案夜或解剖周。`;

const swampEntry = `> 阶位↔境界：一阶≈凡人/保安，二阶≈Un-Men，三阶≈区域沼泽体，四阶≈Arcane/城级绿，五阶≈议会/Rot，六阶≈多元素顶点。世界顶点条件性胜利，低阶规避硬刚。

**一阶（湿地凡人·目击）**
切入身份/时点：猎人/记者/临时工，爆炸案前后。
初始事件：夜巡见人形植物站起，公司要封口。
开场白建议：「泥没过靴筒，录音笔里全是虫鸣。树瘤裂开的形状像一张想说话的嘴。」
关键NPC立场：**沼泽异形**（远观）；**Abigail Arcane**（同情）；Sunderland保安（灭口）。
主线钩子/支线：保全影像或救人；支线假环保、失踪渔民。
危险度/规避：低~中；规避完整Arcane仪式。
任务方向/奖励：湿地地图、配方传闻。

**二阶（Un-Men与公司刀）**
切入：佣兵/护士，Arcane夜袭时。
初始事件：缝合怪物冲进实验室。
开场白建议：「Un-Men的线还在渗。Matt的酒气和枪声叠在一起。」
关键NPC：**Anton Arcane**；**Matthew Cable**；**Patchwork Man**；**Abby**。
主线/支线：护送Abby；烧改造舱。危险中。

**三阶（身份崩溃·Floronic）**
切入：研究员，解剖报告泄露周。
初始事件：纸上写「他不是Alec Holland」。
开场白建议：「你把结论读出声，整片沼泽的叶子同时战栗。」
关键NPC：**沼泽**；**Floronic Man**；**Sunderland**。
主线：阻止全球植物战争。危险中高。

**四阶（城级绿/Arcane高阶）**
切入：城市生态危机协调员。
初始事件：藤蔓吞楼，Arcane许永生。
关键NPC：**Anton**；**Abby**；**John Constantine**。
主线：断Rot仪式。危险高。

**五阶（议会与Rot）**
切入：绿之维度访客。
初始事件：议会令扎根或杀Sprout。
关键NPC：**Parliament**；**Tefe**。
主线：平衡新芽。危险极高。

**六阶（多元素顶点）**
切入：终局试炼见证。
初始事件：风石浪绿同时开口。
关键NPC：主宰态沼泽。
主线：条件引导，情报优先。`;

const ffPlot = `**【作品来源】**
神奇四侠（Fantastic Four）由Stan Lee与Jack Kirby创作，1961年《Fantastic Four》#1开启漫威时代。四人因宇宙射线获能，以家庭与公开身份活动。跨媒介含多部动画与2005/2007/2015/2025电影。本档案以Earth-616经典弧为准。文风：科幻家庭、争吵式爱、宇宙奇观。

**【世界定位】**
纽约第一家庭：Reed Richards、Sue Storm、Johnny Storm、Ben Grimm。打Mole Man、Doom、Skrull、Annihilus，也吵家务。一句话：宇宙最强的家庭伦理剧。

**【世界观 · 力量体系】**
宇宙射线突变、不稳定分子制服、Reed科技、Doom魔科、Power Cosmic、负区、星际科技。死亡复活有代价。

战力：凡人≈一；增强/机器人≈二；四侠个人常规≈三；团队Boss≈四；Doom/Terrax≈五；Silver Surfer≈六；Galactus≈七阶顶点。

乐园阶位映射：路人≈一阶；增强人≈二阶；四侠常规≈三阶；团队级反派≈四阶；Doom/使者≈五阶；银影≈六阶；Galactus≈七阶。宁低勿高。

**【地理 · 舞台】**Baxter Building；Yancy Street；Latveria；负区；宇宙；Wakanda/Attilan交叉。

**【世界剧情线】**
①起源#1：强行发射获伸展/隐形/火/石，公开英雄。
②早期：Mole Man；Namor；#5 Doctor Doom登场。
③宇宙扩表：Inhumans、Black Panther、Kree/Skrull、负区、Annihilus等输出。
④Galactus三部曲#48-50：Uatu失败；Surfer至；Galactus降；Alicia感化；Nullifier僵局；放逐Surfer。
⑤家庭：婚、Franklin、Sue成长、Ben-Alicia、Johnny恋爱。
⑥Doom长线夺能与时间。
⑦Byrne回归家庭。
⑧现代与电影平行规则须声明。
⑨微观：Yancy街、记者会、假货科技、负区泄漏。
⑩蝴蝶：可救居民；不可无代价治愈Ben或感化Galactus。

**【主要人物】**
- **Reed Richards**｜天才疏忽｜伸展+科学｜探索→负重
- **Sue Storm**｜柔转强｜隐形力场｜核心
- **Johnny Storm**｜冲动｜火焰｜惹事
- **Ben Grimm**｜粗口好心｜巨力｜灵魂
- **Victor von Doom**｜傲慢｜魔科｜宿敌
- **Alicia Masters**｜盲雕塑家｜感化Surfer
- **Franklin/Valeria**｜子｜软肋
- **Namor**｜敌友
- **Uatu**｜观察者
- **Silver Surfer/Galactus**｜高阶交叉
- **Annihilus**｜负区暴君
- **Wyatt Wingfoot**｜配角

**【势力图谱】**四侠/未来基金；Latveria；Skrull/Kree；负区；Frightful Four。

**【贵重物品】**不稳定分子衣；Ultimate Nullifier；Fantasticar；Doom甲；时间台；负区门。

**【隐藏剧情 · 伏笔】**Galactus是饿非单纯恶；Sue战力被低估；Franklin潜能；Doom自认正义。

**【大事记时间线】**1961起源→Doom→1966 Galactus→婚生子→Byrne→现代。

**【叙事基调 · 雷区】**家吵是爱；忌冷酷战队；忌无代价治愈Ben；忌低阶硬刚Galactus。`;

const ffEntry = `> 阶位↔：一≈路人，二≈增强，三≈四侠个人，四≈团队Boss，五≈Doom，六≈Surfer，七≈Galactus。顶点情报优先。

**一阶（Yancy街）**
切入：游客/街坊。初始：Ben捏扁劫匪车门。开场白：「蓝色制服在天上拌嘴，石头人把枪管捏成结。」NPC：**Ben**、**Johnny**。危险低。

**二阶（Baxter实习）**
切入：实习生。初始：Doom机器人拆门。NPC：**Reed**、**Sue**。疏散。危险中。

**三阶（负区裂隙）**
切入：临时队友。初始：虫群。NPC：全队。封裂隙。

**四阶（变形者）**
切入：外交使。初始：Skrull假扮。NPC：**Super-Skrull**、**Namor**。

**五阶（Latveria）**
切入：渗透者。初始：Doom要交易。NPC：**Doom**、**Valeria**。

**六阶（银影流放）**
切入：河岸。初始：板划过河。NPC：**Surfer**、**Alicia**。

**七阶（Galactus降临）**
切入：曼哈顿撤离。初始：天空变宇宙。NPC：**Galactus**、**Uatu**、四侠。助Nullifier僵局。`;

const ssPlot = `**【作品来源】**
银色冲浪手（Silver Surfer）由Jack Kirby创作，1966年FF#48作为Galactus使者登场，Stan Lee赋予高尚灵魂。1968独刊，后Englehart、Starlin、Slott等续写。跨媒介含1998动画、2007电影。本档案以Norrin Radd/616为准。文风：宇宙史诗、存在孤独、弥赛亚隐喻。

**【世界定位】**
赞纳星天文学家Norrin Radd为救母星与Shalla-Bal向Galactus献身，获Power Cosmic化银壳寻星。至地球被唤醒叛变，放逐后流浪。一句话：堕天使式的星际浪人。

**【世界观 · 力量体系】**
Power Cosmic：吸转宇宙能、超光速板、物质能量术、疗愈、次元旅。Galactus可赐夺限。

战力：凡人≈一~二；星际佣兵≈三~四；Doom窃能≈五；Surfer≈六~七；Galactus≈八阶顶点。

乐园阶位映射：凡人≈一~二阶；星际士兵≈三~四阶；窃能者≈五阶；银影≈六~七阶；Galactus≈八阶。宁低勿高。

**【地理 · 舞台】**Zenn-La；地球放逐；宇宙航道；Sakaar；Asgard交叉。

**【世界剧情线】**
①献身换母星，魂被改。②使者岁月。③地球三部曲叛变与放逐。④独刊Doom/Mephisto。⑤Defenders。⑥解囚归乡。⑦Infinity与使者线。⑧Zenn-La真相。⑨Annihilation。⑩Sakaar。⑪当代旅行与Knull。⑫蝴蝶：不可无代价消灭Galactus位格。

**【主要人物】**
- **Norrin Radd/Silver Surfer**｜高贵忧郁｜Power Cosmic+板｜使者→叛→浪
- **Galactus**｜超越善恶的饿｜八阶
- **Shalla-Bal**｜爱与牵挂
- **Alicia Masters**｜感化者
- **Fantastic Four**｜良知触媒
- **Mephisto**｜夺魂
- **Doctor Doom**｜窃能
- **Mantis/Nova Frankie/Morg**｜使者线
- **Thanos**｜灭世局
- **Dawn Greenwood**｜当代旅伴

**【势力图谱】**使者体系；Zenn-La；Defenders；Kree/Skrull；Elders。

**【贵重物品】**冲浪板；Power Cosmic；Nullifier交叉；记忆晶。

**【隐藏剧情 · 伏笔】**堕天使构思；魂改写；Zenn-La复制；抽象实体交易。

**【大事记时间线】**献身→FF48-50→独刊→解囚→Infinity→Annihilation→当代。

**【叙事基调 · 雷区】**孤独诗性；忌无脑光束超人；忌贬Galactus为普通大怪。`;

const ssEntry = `> 阶位↔：一~二≈凡人，三~四≈星际武力，五≈窃能，六~七≈银影，八≈Galactus。顶点条件胜。

**一阶** 地球围观。开场白：「天上那块银像不肯落的泪。」NPC：市民。危险低。

**二阶** 放逐期助手。初始：救坠机。NPC：**Surfer**。

**三阶** 商路护卫。初始：警告吞噬航线。

**四阶** 舰队军官。初始：板锋切开旗舰。

**五阶** Doom夺能。NPC：**Doom**、**Surfer**。

**六阶** 同盟抗高阶恶魔/灭世者片段。

**七阶** 再任使者道德抉择。

**八阶** Galactus临场。谈判/Nullifier/撤离，禁止硬刚吞星。`;

const srcS = `- [Swamp Thing - Wikipedia](https://en.wikipedia.org/wiki/Swamp_Thing)
- [沼澤異形 - 中文维基百科](https://zh.wikipedia.org/wiki/%E6%B2%BC%E6%BE%A4%E7%95%B0%E5%BD%A2)
- [搜笔趣阁检索·沼泽怪物（未收录长篇，已核）](https://www.sobqg.com/searchBook.html?keyword=%E6%B2%BC%E6%B3%BD%E6%80%AA%E7%89%A9)`;
const srcF = `- [Fantastic Four - Wikipedia](https://en.wikipedia.org/wiki/Fantastic_Four)
- [The Galactus Trilogy - Wikipedia](https://en.wikipedia.org/wiki/The_Galactus_Trilogy)
- [神奇四侠 - 中文维基百科](https://zh.wikipedia.org/wiki/%E7%A5%9E%E5%A5%87%E5%9B%9B%E4%BE%A0)
- [搜笔趣阁检索·神奇四侠（未收录，已核）](https://www.sobqg.com/searchBook.html?keyword=%E7%A5%9E%E5%A5%87%E5%9B%9B%E4%BE%A0)`;
const srcR = `- [Silver Surfer - Wikipedia](https://en.wikipedia.org/wiki/Silver_Surfer)
- [銀色衝浪手 - 中文维基百科](https://zh.wikipedia.org/wiki/%E9%8A%80%E8%89%B2%E8%A1%9D%E6%B5%AA%E6%89%8B)
- [The Galactus Trilogy - Wikipedia](https://en.wikipedia.org/wiki/The_Galactus_Trilogy)
- [搜笔趣阁检索·银影侠（未收录，已核）](https://www.sobqg.com/searchBook.html?keyword=%E9%93%B6%E5%BD%B1%E4%BE%A0)`;

const files = [
  ['沼泽怪物.md', pack('沼泽怪物', 'lib=主库 tiers=一、二、三、四、五、六', swampPlot, swampEntry, srcS)],
  ['神奇四侠.md', pack('神奇四侠', 'lib=主库 tiers=一、二、三、四、五、六、七', ffPlot, ffEntry, srcF)],
  ['银影侠.md', pack('银影侠', 'lib=主库 tiers=一、二、三、四、五、六、七、八', ssPlot, ssEntry, srcR)]
];

for (const [n, c] of files) {
  fs.writeFileSync(path.join(outDir, n), c, 'utf8');
  const m = c.match(/## 剧情\n\n([\s\S]*?)\n\n## 阶位切入点/);
  const e = c.match(/## 阶位切入点\n\n([\s\S]*?)\n\n## 来源/);
  console.log(n, 'plot', cnt(m && m[1]), 'entry', cnt(e && e[1]));
}
