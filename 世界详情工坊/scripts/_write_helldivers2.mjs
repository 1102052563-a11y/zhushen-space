import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, '产出', '批次203', '地狱潜兵2.md');

const md = `# 地狱潜兵2
<!--meta lib=主库 tiers=一、二、四-->

## 剧情

**【作品来源】**
《地狱潜兵2》（Helldivers 2）由瑞典工作室 Arrowhead Game Studios 开发、索尼互动娱乐发行，2024年2月8日登陆 PlayStation 5 与 Windows，后续登陆 Xbox 等平台。系列前作《地狱潜兵》（2015，俯视角）奠定「超级地球 Managed Democracy」军事讽刺科幻底色；本作改为第三人称四人协同射击，叙事不靠固定线性章节，而靠持续运行的**第二次银河战争（Second Galactic War）**与社区共同执行的 **Major Orders（重大指令）** 推进。整体气质：夸张爱国宣传、黑色幽默、友谊炮火、可替换的「英雄」与高烈度轨道火力。本档案忠于 HD2 可核设定（官方叙事节点 + Helldivers Wiki），不编造私设通关结局。

**【世界定位】**
约 22 世纪中叶（游戏内纪年以 2184 年再动员为开战锚点），**超级地球联邦（Federation of Super Earth）** 以「受管理的民主」统治人类殖民星域。玩家扮演 **地狱潜兵（Helldivers）**——自轨道 **超级驱逐舰（Super Destroyer）** 乘 **地狱舱（Hellpod）** 空降的精锐突击兵，任务是向银河传播自由、解放殖民地、击退三面之敌：**终结者虫族（Terminids）**、**机器人军团（Automatons）**、**光能族（Illuminate / Squ'ith）**。没有小说式唯一主角；主线是全舰队书写的活体战争，个人故事是「又一个穿斗篷的潜兵」在口号与伤亡之间的循环。

**【世界观 · 力量体系】**
本世界无修仙境界。战力由**体制编制 + 个人装具 + 轨道战略配置（Stratagems）**构成。死亡对地狱潜兵近乎「编制内可替换」：队友阵亡可呼叫 **Reinforce** 再投地狱舱；友谊炮火、轨道误伤、撤离失败是日常规则，不是bug。

**基本规则**
- 力量来源：工业军事科技、舰载轨道武器、鹰式战机、SEAF 常规军与潜兵空降体系；敌人侧为生物繁殖/酸液、机器人火控装甲、光能护盾与认知武器。
- 成长逻辑：完成任务获得 **征用券（Requisition）**、**勋章（Medals）**、样本等，解锁 Warbond 战约、舰船模块与战略配置；个人「变强」= 许可更多轨道火力与重型支援，而非肉身成圣。
- 死亡与复活：潜兵阵亡=本次部署结束，舰队可再部署新人；殖民地平民与 SEAF 无此叙事特权。
- 特殊系统：**Major Orders** 全服战时限目标，成功/失败直接改写银河星图颜色；**E-710** 由终结者尸体提炼，是联邦能源/FTL 战略命脉。

**编制与威胁等级（逐级列全）**
1. **平民 / 殖民者 / 训练营新兵**：徒手或轻武，遇虫即溃。破坏力=凡人。≈一阶初。
2. **SEAF 士兵 / 据点守军**：步枪、轻机枪、简易阵地，可守不可攻。≈一阶中~后。
3. **地狱潜兵新兵（Liberator 等主武器 + 基础手雷/机枪战略配置）**：可清 Scavenger、Warrior 级虫群与 Automaton Trooper 小队；惧 Charger、坦克与人潮淹没。≈一阶后~二阶初。
4. **成建制四人小队 + 轨道精确打击 / 鹰式空袭 / 中型支援武器**：稳定摧毁 Bug Hole、制造厂、中型装甲；可处理 Charger、Devastator、Hulk。≈二阶。
5. **资深潜兵（无后坐力炮、自动炮、轨道激光/轨道炮、Eagle 500kg、EXO 外骨骼等）**：单任务内反复击杀 **Bile Titan、Factory Strider、Harvester** 等战术级巨物，仍受冷却与弹药约束。≈二阶后~四阶。
6. **行星战役层级（编制武器，非个人肉体）**：TCS 行星杀虫网、**Dark Fluid** 崩星、**Democracy Space Station（DSS）**、梅里迪安奇点牵引、光能 **Great Host** 舰队——破坏力达行星/航线级。≈四阶高~**超阶**。

**三族典型战力表现**
- **Terminids**：人潮（Scavenger/Hunter/Warrior）+ 酸液（Bile 系）+ 重甲冲锋（Charger/Impaler）+ 巨兽（Bile Titan）+ 巢穴结构（Bug Hole/Nest/Spore Spewer）；Gloom 孢子雾催生 Predator / Rupture / Spore Burst 等变异品系；后期 Hive Lord、Dragonroach 等抬升威胁。
- **Automatons**：远程火力网（Trooper~Devastator）+ 重装（Hulk/坦克）+ 空中（Gunship/Dropship）+ 移动工厂（Factory Strider）；特化旅 **Jet Brigade**、**Incineration Corps**；起源与 **Cyberstan**、Vessel 00、Database One 相连；后期 **Cyborg Legion** 线。
- **Illuminate**：Voteless 丧尸潮 + Overseer 远程精英 + Harvester/Stingray/Leviathan/Overship；**Cognitive Disruptor** 干扰战略配置；Dark Energy 推动奇点；子派系 Appropriators、Mindless Masses；Exospire / **The Void** 等后续危机。

**乐园阶位映射**：平民~SEAF≈一阶；地狱潜兵新兵~稳定四人小队+常规轨道/鹰式≈一~二阶；资深潜兵+重型战略配置/外骨骼/反复击杀战术级巨物≈二~四阶；行星级武器与舰队战役（崩星、奇点、DSS、Great Host）=**超阶（存在·情报优先/条件性胜利）**。世界顶点不是某「无敌个人」，而是**联邦轨道火力网与敌方行星/舰队级手段**的相互摧毁能力；低阶切入严禁硬撼奇点与大舰队本体。

**【地理 · 舞台】**
银河以 **扇区（Sector）+ 行星（Planet）** 为推进单位，前线随 Major Order 每周变动。
- **Sol 系 / 超级地球（Super Earth）**：联邦首都与意识形态中心；七大 **Mega City**（如 Eagleopolis 等）在 2185 光能入侵中成为巷战舞台。**火星（Mars）** 曾遭光能焚掠，成为「为火星复仇」宣传符号。
- **东部虫线**：Umlaut 屏障行星（Erata Prime、Fenrir III、Meridia、Turing）、Hellmire、Estanu、Crimsica、Fori Prime、Oshaune 巢世界等；**The Gloom** 孢子雾覆盖区。
- **西部机器人线**：Trigon、Xzar、Severin、Valdis（**Cyberstan**）、Lacaille、Menkent 线、Tibit 工厂世界、Malevelon Creek 丛林焦土等。
- **光能/奇点相关**：Calypso 首袭；梅里迪安奇点航迹摧毁 Angel's Venture、Moradesh、Ivis 等；隐匿点如 Mog、Hydrobius 等。
- **任务地貌**：丛林、沙漠、冰原、真菌、城市殖民地、超级殖民地虫壳地表、机器人钢铁厂区、光能殖民地聚落。
- **舰内舞台**：超级驱逐舰舰桥、机库、弹药舱、民主官区域、舰载广播与 Strohmann 新闻。

**【世界剧情线】**
① **前史：第一次银河战争与「大民主化」**  
约 2044–2084，超级地球与 Bugs、Cyborgs、Illuminate 开战并宣称全胜。战后：虫被圈入 **E-710** 农场；赛博格被押往 **Cyberstan** 矿区「再教育」；光能被收缴科技并遭近乎灭绝——幸存者逃入未知深空（官方话术后来改口为「仁慈放逐」）。此后约百年 **Great Democratization（大民主化）**，FTL 殖民扩张，地狱潜兵编制解散，宣传称银河和平。

② **2184 初：终结者外溢与机器人先遣**  
终结者（Bugs 科学命名后裔）冲破农场，东部扇区沦陷。联邦研发 **Terminid Control System（TCS）** 与 **Termicide**，计划在屏障行星部署检疫网。同时 **Automatons** 突袭西南高人口殖民星，SEAF 崩溃，地狱潜兵编制紧急重启——开场即是征兵宣传片与 Brasch 训练。**Operation Valiant Enclosure** 推动解放 Heeth、Angel's Venture 等并推进屏障；机器人侧 Troost 远程通信阵被夺，发现其向银河边疆外广播，并截获 Gunship 蓝图。Tien Kwan 的 Morgunson 外骨骼产线一度遭机器人威胁，潜兵夺回后 **EXO-45 Patriot** 列装。

③ **TCS 激活、检疫区收割与 Swift Disassembly**  
屏障行星 TCS 塔启动，Termicide 短时屠杀海量终结者；联邦随即在检疫区部署生物质收集队（BCT）收割 E-710，甚至故意留虫「再繁殖」。**Operation Swift Disassembly** 分阶段试图根除机器人：断通信、打 Tibit 工厂、最终在约 4 月 7 日清除地图可见机器人据点。同步发生 **Malevelon Creek** 丛林拉锯——极高伤亡使其成为潜兵文化核心；解放后总统宣布 **Malevelon Creek Memorial Day**（约 4 月 3 日）并发放纪念斗篷。

④ **The Reclamation：假胜利后的真舰队**  
庆祝仅持续约两日。数万艘级机器人入侵舰队跃迁占领 **Valdis 扇区**，「光复」开始——此前被消灭的只是先遣队。Menkent 线建立又迅速崩溃；Factory Strider 等重单位全面亮相；E-710 储备因急行军告急，潜兵被要求「制造」海量虫尸以炼油。东西两线同时燃烧，Major Order 在虫与机器人之间反复抽调舰队。

⑤ **TCS 失败、超级殖民地与正式宣战**  
亚致死 Termicide 诱发终结者有利突变；**Meridia** 繁殖爆炸，升格 **Supercolony（超级殖民地）**，常规任务无效。潜兵紧急关闭其余屏障行星 TCS，以免更多世界步其后尘。5 月中联邦正式对「一切暴政代理人」宣战，此前行动改称「特别军事行动」。SEAF 训练营在 Aesir Pass、Vernen Wells、Heeth、Angel's Venture 等地扩建；Varylia 5 巨型工厂被夺后改装生产 **EXO-49 Emancipator**。

⑥ **Operation Enduring Peace：暗物质崩星**  
科学部在 **Moradesh** 将一战缴获的光能 **Dark Fluid** 武器化。潜兵打开通往 Meridia 的走廊，在超级殖民地地表部署载荷，**Meridia 坍缩为黑洞/奇点**。短期消灭超级殖民地，却打开与光能藏身处相连的航道伏笔。Moradesh 项目人员获「超级公民自由勋章」式表彰，暗物质库存耗尽后设施退役。

⑦ **Gloom、DSS、特化旅**  
**The Gloom** 孢子雾出现并扩张；**Democracy Space Station（DSS）** 在 Gaellivare 等地建造，约 11 月启用。机器人 **Jet Brigade** 喷气旅登场。潜兵在「指令成功=星图变色」的节奏里成为活体棋子——失败亦被宣传机器改写话术。

⑧ **光能回归、奇点东进与超级地球战役**  
约 2184 年 12 月，**Illuminate** 突袭 **Calypso**，以 Overseer + **Voteless**（被绑架殖民者改造的「无投票权」丧尸）作战。其后以 Dark Energy 推动梅里迪安奇点移动，沿途湮灭 **Angel's Venture、Moradesh、Ivis** 等。联邦用封锁、**Penrose Energy Siphon**、最终 **Repulsive Gravity Field Generator** 刹停奇点；光能暂退整备。约 2185 年 5 月 **The Great Host** 自大洞涌出，先毁 **Mars**，再登陆超级地球七城；潜兵与 SEAF 巷战，联邦险胜，光能焚掠部分港市后撤退并一度隐匿（后在 Mog 等暴露）。

⑨ **Gloom 远征、巢世界与战争延展（无终章）**  
Predator Strain、Rupture Strain 等变异出现；Hellmire 设 **Outpost Alpha** 获准长期入雾。**Oshaune** 巢世界解放迫使 Gloom 退缩。机器人侧 Database One 等情报将起源钉回 Cyberstan；宣传战与「集体」意识形态并行。光能侧出现 Appropriators、Exospire、**The Void** 等新节点。  
**结局方向**：第二次银河战争为**进行中活体叙事**，无「某人一统银河」的封闭结局。阶段性胜利=Major Order 成功、纪念日与星图颜色；永恒主题是：**为民主而死，下一具地狱舱已就位**。

**【主要人物】**
- **地狱潜兵（玩家角色/编制个体）**｜性格：被训练成绝对服从宣传的英雄，战场上靠小队沟通与黑色幽默续命｜装备·能力：斗篷、主副武器、手雷、护甲、战略配置四槽、地狱舱空降｜人物弧光：新兵训练→反复阵亡与再部署→成为舰队统计中的「解放贡献」｜立场关系：对超级地球表演或真心忠诚；对 SEAF 是刀锋；对三族是灭绝工具。
- **General Brasch（布拉施将军）**｜性格：咆哮励志、把一切训练都喊成 “the real deal”｜装备·能力：主持地狱潜兵训练设施与《Brasch Tactics》节目｜人物弧光：从训练官变成舰队文化图腾，软canon 中不断被神化晋升｜立场关系：塑造新兵意识形态；对潜兵是喜剧导师。
- **Democracy Officer（民主官）**｜性格：冷静教条，随时引用「历史定论」｜装备·能力：舰桥政委职能，解读 Major Order 与敌人「真相」｜人物弧光：话术从特别行动切换到全面战争｜立场关系：代表真理/国防话语，监视异议。
- **Ship Master（舰务长）**｜性格：务实疲惫，偶尔流露对官方叙事的裂缝（如光能「100%灭绝」）｜装备·能力：超级驱逐舰运行与调度｜人物弧光：三线战争的疲劳后勤中枢｜立场关系：潜兵直接后勤上司。
- **Service Technician（维修技师）**｜性格：吐槽役，关心设备多于口号｜装备·能力：舰船维修与模块｜人物弧光：战争螺丝钉视角｜立场关系：友军非战斗 NPC。
- **Eagle 1**｜性格：空中支援，通讯短促专业｜装备·能力：鹰式扫射、集束、凝固汽油、**500kg** 等｜人物弧光：天上的死神，亦是友谊炮火来源｜立场关系：可救命可误炸。
- **Pelican 1**｜性格：撤离飞行员，倒计时冷酷｜装备·能力：Pelican 穿梭机提取｜人物弧光：任务成败最后闸门｜立场关系：保命线。
- **Mission Control（任务控制）**｜性格：播报目标与增援警报｜装备·能力：战场信息中枢｜人物弧光：把混乱翻译成指令｜立场关系：无形指挥。
- **Coretta Kelly**｜性格：媒体/新闻语境具名人物｜装备·能力：舆论塑造｜人物弧光：把惨胜包装成必然｜立场关系：Strohmann 新闻体系。
- **Major Truth（真理少校）**｜性格：强硬信息管控｜装备·能力：真理部执行端｜人物弧光：战争中「真相」守门人｜立场关系：打压非法广播与异议研究。
- **Loyalty Officer（忠诚官）**｜性格：多疑、仪式化爱国｜装备·能力：忠诚审查｜人物弧光：全面战争时权重上升｜立场关系：政治威胁源。
- **Helldiver Dummy（教程假人战友）**｜性格：被设定为完美战友后立刻阵亡以教学｜装备·能力：无｜人物弧光：一分钟内从兄弟到「用 Reinforce 替换」｜立场关系：主题隐喻——潜兵可替换。
- **超级地球总统（时任总统职）**｜性格：演讲体宣传｜装备·能力：宣战、纪念日、LIBCON 等级｜人物弧光：把 Creek 定为节日、把溃败定义为话术｜立场关系：体制顶点象征（个人战力无意义）。
- **Stefan Holmes**｜性格：次要具名政务/文宣侧｜装备·能力：不详｜人物弧光：丰富官僚名单｜立场关系：体制齿轮。

**【势力图谱】**
- **超级地球联邦**：Managed Democracy（问卷算法投票）、公民等级 CCS、**C-01 生育许可**；部委含 Defense、Truth、Science、Humanity、Prosperity、Expansion、Unity 等。宗旨：传播民主、收割资源、消灭「暴政」。战力：SEAF + 地狱潜兵 + 超级驱逐舰群 + DSS。
- **地狱潜兵部队**：联邦刀锋；高伤亡、高宣传价值；与 SEAF 协同但被神化。
- **Terminid 虫潮**：宣传定性为「繁殖并摧毁民主」；实质是被剥削生物资源失控。子派系 Predator / Spore Burst / Rupture。
- **Automaton 军团（The Collective）**：与赛博格/Cyberstan 历史相连的智能机器人，瑞典语铭文文化；先遣→光复主舰队→特化旅。
- **Illuminate（Squ'ith）**：长寿古老种族，护盾/隐身/认知武器；百年建造 Great Host 复仇。子派系 Mindless Masses、Appropriators。
- **军工与传媒**：Morgunson、Ståhl Arms、Strohmann Media/News、Permacura 等——战争经济与话术工业。

**【贵重物品】**
- **Element-710（E-710）**：终结者死后产物，联邦战略能源/FTL 燃料，战争经济学核心。
- **Dark Fluid（暗物质流体）**：光能科技遗产；用于 Meridia 崩星，并关联奇点与后续光能工程。
- **Hellpod / Super Destroyer**：潜兵投送与轨道火力平台，个人「外挂」的制度来源。
- **Stratagem 信标与许可**：轨道精确打击、380mm HE、轨道激光、Eagle 500kg、Reinforce、NUX-223 Hellbomb 等——战场胜负手。
- **EXO-45 Patriot / EXO-49 Emancipator**：动力外骨骼，攻坚符号。
- **Terminid Control System / Termicide**：屏障杀虫体系；失败反噬成超级殖民地与变异。
- **Democracy Space Station（DSS）**：舰队级移动支援枢纽。
- **Repulsive Gravity Field Generator / Penrose Energy Siphon**：对抗奇点位移的科学武器。
- **R-2124 Constitution、CQC-1 One True Flag 等自由之日象征装备**：意识形态圣物化武器。
- **Database One / Vessel 00 情报**：钉死机器人与 Cyberstan 起源的关键数据。

**【隐藏剧情 · 伏笔】**
- **Managed Democracy 讽刺内核**：算法投票、生育许可、异议拘禁与「解放」话术——英雄史诗下的极权结构。
- **光能并未真正灭绝**：官方纪录与舰务长吐槽并存；梅里迪安「黑洞」实为连通其藏身处的**虫洞**。
- **机器人有情感与历史叙事**：拦截通讯出现哀悼与复仇；铭文「你是齿轮/你是集体」；与赛博格矿奴史互文。
- **E-710 伦理闭环**：联邦需要虫「可控地活着又死着」——农场—爆发—收割可能自我制造战争。
- **TCS/Termicide 自噬**：科学解决方案制造超级殖民地与 Gloom 变异。
- **友谊炮火与可替换英雄**：教程假人之死是世界观宣言。
- **活体战争无终局**：由运营/社区指令驱动；档案固定机制与已发生节点，不编造未发生的「最终魔王死亡」。

**【大事记时间线】**
- 2044–2084 → 第一次银河战争；三族「战败」。
- ~百年 → 大民主化殖民；潜兵解散；E-710 农场。
- 2180 → Vessel 00 离开 Cyberstan（后揭机器人起源线索）。
- 2184-02 → 终结者外溢 + 机器人先遣；地狱潜兵再动员。
- 2184-03 → TCS 激活；Swift Disassembly 推进；Patriot 外骨骼列装。
- 2184-04-01~07 → Creek 解放与纪念日；机器人地图清除。
- 2184-04-09 → The Reclamation 主舰队占领 Valdis。
- 2184-04 末 → TCS 失败；Meridia 超级殖民地。
- 2184-05 → 正式宣战；Enduring Peace 崩毁 Meridia。
- 2184-08 → Gloom 出现并扩张。
- 2184-11 → DSS 启用。
- 2184-12 → 光能袭 Calypso。
- 2185-02~04 → 奇点移动摧毁多星；引力发生器刹停。
- 2185-05 → Great Host；火烧火星；超级地球战役；联邦险胜。
- 2185 下半年起 → Gloom 远征、巢世界、特化敌与 Void 等；战争持续。
- 每年 10-26 → **Liberty Day（自由之日）** 全联邦庆典。

**【叙事基调 · 雷区】**
画风：军事科幻 + 政治讽刺 + 合作混乱喜剧；口号震天、尸体成山。口吻可学宣传广播，战场细节要血腥土。  
忌：把超级地球写成无瑕疵正义之师；忌取消友谊炮火与高死亡率；忌把三族写成单一「魔王个人」；忌低阶肉身硬抗崩星/奇点/大舰队；忌编造固定姓名的「唯一主角通关银河」。  
最早切入锚点：2184 初征兵动员 / 完成 Brasch 训练后的首次地狱舱空降。

## 阶位切入点

> 阶位↔编制/战场：一阶≈平民·SEAF·潜兵新兵（轻武+基础战略配置）；二阶≈成建制潜兵小队+稳定轨道/鹰式/中型支援；四阶≈资深潜兵·重型战略配置·外骨骼·反复处理战术级巨物，并触及行星战役边缘。世界顶点（梅里迪安奇点、光能 Great Host、联邦 Dark Fluid 崩星、Cyberstan 母星级战争）为**超阶**，低阶切入一律「规避顶点·情报优先/条件性胜利」。

**一阶（新兵动员 · 首次空降线）**

切入身份/时点：契约者以**刚通过 General Brasch 训练、披上斗篷的地狱潜兵新兵**身份切入，锚定 2184 年初征兵动员之后、首次编入四人小队执行东部虫线或基础解放任务前后。

初始事件：超级驱逐舰循环播放国歌与征兵广告；**Democracy Officer** 下达个人指令。你与三名陌生潜兵进入地狱舱，目标行星 SEAF 残部求援——落地即遭遇 Scavenger/Hunter 潮，必须在友军交叉火力中关闭最近的 Bug Hole，并学会：**乱丢轨道信标会杀死队友**。

开场白建议：「地狱舱的制动喷口把大气烧成白线。通讯里 Mission Control 报着虫潮方位，Ship Master 提醒战略配置冷却未转满——舱门炸开的瞬间，超级地球旗帜在毒孢子里猎猎作响，而你的第一个任务不是活下去，是把民主插进这颗正在失去的殖民星球。」

关键NPC立场：**General Brasch**——训练期神化导师，只通过广播激励，要求你把死亡当教学；**Democracy Officer**——审核爱国表现，厌恶质疑 E-710 伦理；**Ship Master**——给简报与撤离窗口，在意舰船损耗多于你的性命；**Eagle 1**——应召空袭，坐标错误即友谊炮火；**Pelican 1**——提取倒计时的冷酷执行者；**SEAF 前线士官**——乞求解围，也是你必须护送的「解放政绩」。

主线钩子/支线：完成首次解放/保卫任务并上交样本；支线＝搜集生物样本、在废墟阅读手写便条与非法广播、护送平民到提取点。蝴蝶点：是否在公开频道质疑「农场养虫」——可能招来 **Loyalty Officer** 关注。

危险度/规避：中——致命来自虫潮、酸液与友军误伤；须规避 Charger 以上重甲集群、轨道 380mm 覆盖区、擅自离队深入巢穴。

任务方向/奖励：活着提取、学会四槽战略配置基础配合；奖励取向＝征用券、入门支援武器（机枪/EAT）解锁线索、基础斗篷/武器、SEAF 好感与合格潜兵档案。

**二阶（双线焦土 · Creek 记忆与指令绞肉机）**

切入身份/时点：以**已有多次成功提取记录的地狱潜兵骨干队员**身份切入，锚定 2184 春夏：Malevelon Creek 惨烈战事前后，或 Operation Swift Disassembly 与 The Reclamation 之间的「假和平—真反扑」窗口；亦可落在 TCS 启用后的检疫区收割任务。

初始事件：Major Order 在任务中途切换——小队刚清空一处机器人 Fabricator 网，广播却命令转向东部关闭失控 TCS 塔或驰援 Creek 丛林。落地同时出现 Devastator 枪线与友军 Eagle 集束误区；必须在「完成旧目标」与「服从新指令撤离」之间抉择，Democracy Officer 与 Mission Control 口径冲突。

开场白建议：「征用终端把 Creek 的阵亡数字刷成纪念壁纸。你的斗篷还沾着上颗星的机油与虫酸，Ship Master 已把航线锁向下一场『必然胜利』。战略配置转轮提示音响起——这一次，敌人会射击、会冲锋，也会在你呼叫轨道炮时，站得离队友太近。」

关键NPC立场：**Democracy Officer**——把溃败解释为战略欺骗；**Ship Master**——透露补给与 E-710 告急；**Eagle 1 / Pelican 1**——高烈度下的救命与误杀双面；**Coretta Kelly（Strohmann 话术链）**——要英雄镜头不要真实伤亡；**General Brasch**——节目教条在战地完全不够用；**Helldiver 老兵队友**——教你优先拆除 Stratagem Jammer 与探测塔。

主线钩子/支线：参与 Creek 解放或纪念任务、Troost 通信阵破坏、Tibit 工厂压制造线；支线＝抢救被困人员、抢 RL-77 等新许可、在机器人残骸辨认瑞典语铭文「集体」。蝴蝶点：是否传回「Reclamation 前假胜利」证据——可能被真理部压下。

危险度/规避：高——Hulk、炮兵、Gunship、双线奔波疲劳；须规避 Factory Strider 正面硬刚、超级殖民地核心、单独深入作秀。

任务方向/奖励：在指令摇摆中保住提取率；奖励取向＝中型支援武器（无后坐力/自动炮）、鹰式重火力许可线索、勋章战约装备、机器人弱点击破经验。

**四阶（行星战役边缘 · 崩星/奇点/首都防线）**

切入身份/时点：以**获准携带重型战略配置与外骨骼、可被点名为行动尖兵的资深地狱潜兵**身份切入，锚定以下任一节点前后：Operation Enduring Peace（Meridia 暗物质部署）、光能回归后的奇点东进、或 2185 超级地球保卫战巷战阶段。

初始事件：你被编入「不可失败」优先行动——在超级殖民地壳层护送 Dark Fluid 载荷，或在超级地球 Mega City 废墟清除 Harvester/Leviathan 威胁并重启 SEAF 防空/炮兵。开局必须同时处理战术级巨物、战略配置干扰建筑、以及 Voteless 人潮中混杂的旧殖民者面孔；Mission Control 仍用愉快语调要求你「传播民主」。

开场白建议：「超级驱逐舰在高层大气拉出轨道灼痕。Democracy Officer 说历史将记住这一天；Ship Master 只说暗物质储量见底、奇点轨迹仍在逼近。你把轨道炮信标握在手心——这一掷，可能毁掉一座敌巢，也可能改写一颗行星的星图颜色。」

关键NPC立场：**Democracy Officer**——禁止称崩星为灭绝，只许称「持久和平」；**Ship Master**——计算撤离跃迁与平民窗口；**Eagle 1**——城市战限制投放角度；**Pelican 1**——首都提取点随时改坐标；**Major Truth**——封锁「虫洞=光能回廊」非官方解释；**General Brasch**——远程嘉奖你的「无敌」；光能 **Overseer 高价值单元**——战场猎杀目标，非可谈判个体。

主线钩子/支线：Meridia 载荷临界、奇点刹停装置护卫、超级地球七城逐一收复；支线＝摧毁 Cognitive Disruptor、保护 DSS 协同窗口、回收光能科技残骸。蝴蝶点：是否公开「Voteless 曾是公民」——触碰体制最大禁忌。

危险度/规避：极高~贴近顶点——战术上可击杀 Titan/Strider/Harvester，战略上仍是棋子；须规避梅里迪安奇点本体、Great Host 旗舰群核心、Dark Fluid 失控涟漪。**超阶巅峰：存在·情报优先/条件性胜利**，严禁用「被封印所以不强」解释奇点与大舰队。

任务方向/奖励：阶段性改写星图（订单成功）、活着看见烟花或废墟；奖励取向＝顶级战略配置使用许可、外骨骼、纪念斗篷/装备、奇点/光能相关情报型收获（非肉体成神）。

## 来源

- [Helldivers 2 - Helldivers Wiki (wiki.gg)](https://helldivers.wiki.gg/wiki/Helldivers_2)
- [Galactic War - Helldivers Wiki](https://helldivers.wiki.gg/wiki/Galactic_War)
- [Terminids - Helldivers Wiki](https://helldivers.wiki.gg/wiki/Terminids)
- [Automatons - Helldivers Wiki](https://helldivers.wiki.gg/wiki/Automatons)
- [Illuminate - Helldivers Wiki](https://helldivers.wiki.gg/wiki/Illuminate)
- [Federation of Super Earth - Helldivers Wiki](https://helldivers.wiki.gg/wiki/Federation_of_Super_Earth)
- [General Brasch - Helldivers Wiki](https://helldivers.wiki.gg/wiki/General_Brasch)
- [Liberty Day - Helldivers Wiki](https://helldivers.wiki.gg/wiki/Liberty_Day)
- [Stratagems - Helldivers Wiki](https://helldivers.wiki.gg/wiki/Stratagems)
- [Helldivers 2 - Fandom Wiki](https://helldivers.fandom.com/wiki/Helldivers_2)
- [搜笔趣阁检索：地狱潜兵2（游戏IP未收录小说全本，以wiki战史为准）](https://www.sobqg.com/searchBook.html?keyword=%E5%9C%B0%E7%8B%B1%E6%BD%9C%E5%85%B52)
`;

fs.writeFileSync(out, md, 'utf8');
const plot = md.split('## 剧情')[1].split('## 阶位切入点')[0];
const entry = md.split('## 阶位切入点')[1].split('## 来源')[0];
const cc = (s) => s.replace(/\s/g, '').length;
console.log('OK', out);
console.log('plot', cc(plot), 'entry', cc(entry));
