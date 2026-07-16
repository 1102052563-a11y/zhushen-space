const fs = require('fs');
const path = require('path');

function buildWorld(cfg) {
  const {
    name, sourceBlurb, stage, worldPos, settingExtra, places, chars,
    heroFirst, manager, trueChar, bittersweet, stable, pressure,
    hookItem, festival, socialMoney, sources, avoidNames, uniqueFlavor,
    entryOpen, extraPlot,
  } = cfg;

  const charBlocks = chars.map(c =>
    `- **${c.name}（${c.role}）**｜外貌：${c.look}｜性格：${c.personality}｜角色类型：${c.type}｜萌点／魅力：${c.moe}｜个人线：${c.line}｜与主角关系：${c.rel}。`
  ).join('\n');

  const placeBlocks = places.map(p => `- **${p.name}**：${p.desc}`).join('\n');
  const src = sources.map(s => `- [${s.t}](${s.u})`).join('\n');
  const avoid = avoidNames ? `（忌复用：${avoidNames}）` : '';

  return `# ${name}
<!--meta lib=休闲 tiers=休闲-->

## 剧情

**【作品来源】**
《${name}》为轮回乐园休闲库收录的${sourceBlurb}。本条目以条目名给出的剧情焦点为专属锚点，整合该类题材的公开设定惯例与本库独立切片。整体气质：${uniqueFlavor}，NSFW 尺度为有 H 但不展开露骨描写。媒介印象：同人 R18／CG／音声／短篇跨媒介氛围。**本条人名与舞台与同库相邻切片互不混用**${avoid}。

**【世界定位】**
${worldPos}
一句话：这是「${stage}」里的恋爱与关系经营世界，核心玩法是日常站队、倾听与可拒绝的亲密，不是清场厮杀。

**【世界观 · 舞台设定】**
${settingExtra}
表面上一切按本地规约运转：排班、名册、告示、钥匙保管与投诉处理。真正让这里「与众不同」的，是一本被谨慎保管的《余响手账》——当${manager}用特定节奏说出倾听句式、当告示铃以特定次数响起、当信箱出现写着「今晚可以说话吗」的粉笺时，相关者会进入本地人称为「余响时间」的松弛状态：戒备变低、更愿意把真心话说完、对「再靠近一点」的羞耻被日常借口稀释。
超自然只服务日常与情感：余响不是无限改写记忆的魔法，而是「让人更愿意听完对方的委屈、更愿意在门口多停三秒」的软羁绊；强行要求他人做违背底线的事会触发「清醒反弹」——当事人头痛、对施压者产生强烈厌恶，名牌／钥匙也会暂时发烫拒绝交还。死亡与复活不在主轴；真正可怕的是被名册除名、被改成「只记编号不记名字」、或永远只是「那个新来的、谁也不记得名字的人」。
世界的温度来自：晨间的蒸汽与脚步、雨天共撑的伞、未喝完的热饮、走廊未说完的半句话，以及某位角色第一次在手账上划掉临时编号改写你的名字时的试探。
社交货币包括：${socialMoney}。AI 写场景时应先定「今天是排班第几周、谁缺席、契约者袖口名牌有没有被谁别上粉笺」，再决定人物语气。

**【地理 · 生活舞台】**
${placeBlocks}

**【故事主线 · 情感线】**
① **入场与点名（相遇·第一周）**
契约者因乐园偏差或以正当临时身份进入本舞台。${heroFirst}在入口帮他稳住第一件行李／名牌，随口说：「规矩写在告示板上——搞错会被记名的。」欢迎热饮尚未喝完，${trueChar}在角落点头却没多话；${bittersweet}只对视一秒就进门；${stable}在群组里发了「今晚汤多」。因果：新人＝可移动的「倾听对象」与情感催化剂；此后「与谁第一次共担班表」被解读为亲近信号。

② **余响周与秘密升温（第二至三周）**
日程被写成精致菜单：平日排班、周三例会、周六公开活动、周日休息区闲谈。
- 靠拢${heroFirst}：用「责任／招待／前辈义务」把关心说成流程；升温点是契约者接受关心但约定「不越底线、不在第三人醒着时越线」。
- 靠拢${manager}：程序句掩饰紧张，递${hookItem}时耳尖发红；破冰点是不拆穿她的失态。
- 靠拢${trueChar}：连续两次共担班表后说出心结——怕只被当成工具或编号。
- 靠拢${bittersweet}：用职场／任务话术说「合作愉快」，实际是第一次示弱。
- 靠拢${stable}：关店后的热汤与情报，成为「你在场内的眼睛」。
- 压力源${pressure}偶尔丢下一句善意或视线，把张力从外部悄悄加上。

③ **裂痕与反弹（冲突·第四周）**
第四周临时例会，外客提出「用高价买断排班／强制余响表演」的意向。流言分裂：一派说新人「不该插手」，一派求契约者在手账上「美化同意」。${heroFirst}与${manager}当众冷战；${trueChar}失踪半日去旧库核对禁止强制条款；有人要求代签——被当场打断。名场面：雨中必须先撑伞给谁；失败方的单独道歉；手账上的代签危机。

④ **${festival}前夜（告白窗口·第五周周五）**
${manager}把${hookItem}暂时放进契约者手中：「帮我在明天——递向谁／盖向谁，是你的公开答案，也可以放回空处。」此夜可触发各线告白：撒娇句、程序句、疑问句、只属于今晚的私情后要求次日仍做公正旁证。

⑤ **${festival}与结局（第五周周六）**
公开活动与轮值确认同日举行。分支：
- **${heroFirst}HE**：公开特别往来，日间共担班表，夜间散步；学会先问「可以吗」。
- **${manager}HE／程序线**：钥匙或印章公开，寂寞被规则化为每日共餐与交接。
- **${trueChar}True**：手账与投票支持「最会倾听的新人」写入本名；推动禁止强制余响与禁止代签。
- **${bittersweet}Bittersweet**：外调／离开，送空钥匙备份——致郁纯爱。
- **${stable}安定End**：权力戏退居，留下当长期帮工／情报站。
- **无名编号End**：五周内从未认真倾听，活着离开，场内不记名。

⑥ **后日谈**
${festival}后的舞台仍是日常：排班、投诉、热饮、处理新来者。余响被新规约限制在「缓解焦虑、促进倾听」；情感线转为如何在「同事与恋人」双重身份里保持边界感。${festival}不是黑屏，而是日常的新开端。
${extraPlot || ''}

**【可攻略角色 / 主要人物】**
${charBlocks}

**【人际关系网 / 社团势力】**
- **程序派**：拥${manager}，讲究流程与体面；口号是「印章不可戏」。
- **生活派**：暗中看好转倾听与互助；口号是「先吃饭再开会」。
- **外部压力**：${pressure}的视线与商会／制度；口号是「别浪费时间」。
三角与多角：${heroFirst}×${trueChar}因秘密目击产生裂痕；契约者是移动催化剂；谁请你共担第一轮班表≈流言站队；连续三天同班≈订婚预告（流言层面）。各派并非善恶二分，而是对「如何被记住」的不同答案：程序派要名册完整，生活派要热饮还温，外部压力要效率。AI 写对话时应让同一句话在不同派系嘴里变成不同温度。

**【情感事件 · 名场面】**
1. **入口点名**：${heroFirst}递第一句规矩，全场记住你的应答。
2. **${hookItem}事件**：公开场合失手，耳尖发红。
3. **雨中撑伞**：必须先选给谁。
4. **代签危机**：拒绝／妥协改写信任。
5. **递物前夜**：${hookItem}放入你手，盖向谁即站队。
6. **${festival}后第一句**：不是宣言，而是「你饿不饿」或「叫我的名字」。
7. **名册公开日**：根据共担班表次数调整座位。
8. **热饮关店**：${stable}的情报与告白未遂。
9. **匿名备用毯**：侧室门口出现来源不明的温柔。
10. **编号划掉瞬间**：手账上临时号被本名取代，全场安静一秒。

**【隐藏剧情 · 真结局 · 伏笔】**
- 《余响手账》真正强化的不是服从，而是「发令者能否允许别人说不」。
- True End：禁止强制余响、禁止代签、新人可写入本名。
- 若五周从未认真听任何人，触发无名编号 End。
- ${manager}推动公开活动的真实原因往往不是业绩，而是不愿再把亲密炼成工具；Bittersweet 线会亲口承认。
- ${trueChar}的条款藏在旧规约附录，有人其实早就看过却从未揭穿——正统线 HE 前可触发和解。
- 系列互文：同库相近题材可视为不同街区历史切片，人名互不复用。

**【氛围基调 · 雷区】**
基调：${uniqueFlavor}；慢热、可拒绝、制度感与体温并存。BGM 意象：脚步＋远处广播＋热饮杯沿。
忌：写成砍杀闯关本；忌无铺垫秒爱；忌抹去「说不」；忌把余响写成绝对洗脑；忌跨世界套话；忌复用相邻切片人名。
最适合切入：入场第一周，名牌尚温、${festival}预告刚贴出时。写正文优先「谁请你共担班表、谁在角落找到你、你有没有替谁说不」。契约者是情感变数，不是降维支配者。

## 休闲切入点

> 本世界为休闲/恋爱向（${stage}），无生存砍杀主轴。契约者以**日常身份**融入，核心玩法＝relationship 攻略 + 日常事件，而非任务厮杀。

切入身份：${entryOpen || '临时新人／记录见习／帮工'}。中立名分可进出主场与休息区，不被立刻拖入强制关系，又足够被各派当成值得拉拢的「倾听对象」。可挂名${stable}一侧的晚班赚好感。

切入时点：${festival}预告贴出后的入场第一周清晨。名册仍空白，不宜从表决夜或后日谈开局。

初始处境：
- 住宿：场内侧室或邻近短租，窗对主舞台方向；有人匿名放了备用毯。
- 日程：${manager}排班，缺席记态度。
- 圈子：可能撞上${heroFirst}的热闹、${trueChar}的沉默、${bittersweet}的通勤。
- 社交起点：${heroFirst}、${manager}、${stable}、${pressure}。
- 持有物：临时名牌、空白记事本、群组账号。

开场白建议：「你被铃声叫醒时，袖口还别着未焐热的临时名牌。${heroFirst}把写着今日规矩的便签塞进你掌心，墨水未干，低声说：这周${festival}，谁跟你共担最多轮班，全场都会当作站队。门外${manager}与${trueChar}几乎同时点头，${stable}在另一头朝你扬了扬热饮。杯子还烫——你的第一句应答，已经决定这一季空气里的气味。」

可攻略对象：
- **${heroFirst}**：接受关心但守底线；好感起点：被逗乐；钩子：责任与真心；破冰：在她失态时只递水不嘲讽。
- **${manager}**：公开场合给台阶；好感起点：礼貌距离；钩子：程序下的软弱；破冰：递备用${hookItem}墨／芯。
- **${trueChar}**：听完心结再表态；好感起点：安静陪伴；钩子：True 立法；破冰：雨中把伞倾向她而不说话。
- **${bittersweet}**：请教而非求宠；好感起点：项目搭档；钩子：离开前放手；破冰：加班后共食不追问隐私。
- **${stable}**：关店共犯与情报；好感起点：可靠；钩子：安定港；破冰：帮她收尾班并保守秘密。

日常玩法钩子：
1. **班表站队线**：连续共班改变座位与流言；三连≈流言订婚。
2. **手账线**：自愿／拒绝代签与强制余响，影响 True／BE。
3. **关店潜行线**：跟${stable}听壁脚，获取真心话。
4. **散步线**：每晚可约一人，触发阈值事件。
5. **递物选择**：前夜${hookItem}放入你手，锚定结局走廊。
6. **名册经营**：兑现承诺解锁隐藏协助。
7. **投诉调解线**：在公开纠纷中选择替谁说话，改写派系温度。
8. **编号改名线**：帮助某人从临时号写回本名，接近 True。

氛围/雷区：保持日常与可拒绝的亲密；**忌强行加入砍杀闯关、无脑强制、用对决输赢解释关系**；忌让角色失去「说不」；忌五周速通扁平化。NSFW 点到情绪与关系后果即可。开局口诀：先拿名牌，再选班表，最后才碰${hookItem}。收束：${festival}后的第一句若是关心而非命令，这条线就站稳了。离开时若袖口仍有粉笺，说明场内记得你的名字；粉笺消失则是无名编号 End 的无声宣判。

## 来源

${src}
`;
}

const commonSources = (kw1, kw2, title) => [
  { t: `DLsite「${kw1}」关键词检索`, u: `https://www.dlsite.com/maniax/fsr/=/language/jp/keyword/${encodeURIComponent(kw1)}` },
  { t: `DLsite「${kw2}」关键词检索`, u: `https://www.dlsite.com/maniax/fsr/=/language/jp/keyword/${encodeURIComponent(kw2)}` },
  { t: '搜笔趣阁检索（本条目标题无长篇小说书页，已核验未收录）', u: `https://www.sobqg.com/searchBook.html?keyword=${encodeURIComponent(title)}` },
];

const worlds = [
  {
    name: '淫欲の都市-地下闘技',
    file: '产出/批次338/淫欲の都市-地下闘技.md',
    sourceBlurb: '暗黑都市竞技场日常向条目，气质贴近日系同人R18中常见的「地下闘技場／都市裏社会／賭けと契約」题材：以地下斗技场的报名、观战包厢、选手休息室与胜负之外的情感契约为核心，而非致死闯关。公开可溯源可参照 DLsite「闘技場」「地下」关键词下大量都市竞技／契约向同人',
    stage: '霓虹湾地下黑蔷薇杯赛季',
    worldPos: '不夜城霓虹湾地下三层的灰色斗技场「黑蔷薇杯」赛季进行中。契约者不扮演用暴力征服全场的斗士，而以新人记录员／包厢服务生／选手经纪人见习身份卷入选手、赞助人与场馆职员的日常、赛程表与情感升温。',
    settingExtra: '霓虹湾地表是繁华商业区，地下由自动扶梯与会员闸机进入黑蔷薇杯：环形看台、中央表演性赛台（本条主轴为积分赛与表演对决，不写致死）、选手通道、医务室、赞助人包厢与契约公证处。',
    places: [
      { name: '会员闸机／检录台', desc: '新人记录员入职点；初遇、递工牌 L-07。' },
      { name: '中央赛台与环形看台', desc: '公开站队与流言发酵处。' },
      { name: 'A 包厢', desc: '加贺美玲主办席；香槟与合同。' },
      { name: '选手休息室东／西', desc: '卫宫飒与黑崎透的静音区。' },
      { name: '医务室', desc: '白峰奈央的冰袋与创可贴。' },
      { name: '契约公证处', desc: '余兴契约簿与粉笺印章。' },
      { name: '地下食堂黑蔷薇厨房', desc: '橘美咲的关店热汤。' },
      { name: '天台通风口', desc: '不想被看台看见时的避难所。' },
    ],
    chars: [
      { name: '卫宫飒', role: '东休息室选手／第一接触', look: '亚麻短发、指节绷带、运动外套', personality: '寡言、自我评价低', type: '文静隐忍', moe: '默默放运动饮料；只在雨中说长句', line: '怕只剩编号；HE 后公开往来', rel: '从路人到树洞' },
      { name: '加贺美玲', role: '场馆经理', look: '银短发、锐利眼线、灰白西装', personality: '克制、好面子', type: '冷艳上位', moe: '印章没墨时耳尖红', line: '从利用记录员到承认怕空白页', rel: '先上下级后对等' },
      { name: '夜叉神凛', role: 'A包厢赞助见习', look: '黑长直、深瞳、黑裙', personality: '冷、观察力强', type: '傲娇上位', moe: '雨中第一次说长句', line: 'True 推动禁止强制余兴', rel: '先距离后信任' },
      { name: '白峰奈央', role: '医务', look: '栗发马尾、白大褂', personality: '嘴硬心软', type: '能干大姐姐', moe: '骂完塞冰袋', line: '医务共居 HE', rel: '监护→恋人可选' },
      { name: '橘美咲', role: '食堂', look: '橘棕双马尾、围裙歪', personality: '慌张好奇', type: '妹系安定港', moe: '关店热汤', line: '安定 End', rel: '店员→依赖' },
      { name: '黑崎透', role: '西休息室', look: '中性短发、手套', personality: '中立惜字', type: '对照／信任线', moe: '打断代签', line: 'Bittersweet 外调前放手', rel: '对手→短暂恋人' },
      { name: '先代记录苍', role: '隐藏', look: '半隐居、旧工牌', personality: '遗憾温和', type: '导师残影', moe: '通风口旧印', line: '助 True 立法', rel: '镜鉴' },
    ],
    heroFirst: '卫宫飒', manager: '加贺美玲', trueChar: '夜叉神凛', bittersweet: '黑崎透', stable: '橘美咲', pressure: '外客商会联络人',
    hookItem: '粉笺印章', festival: '积分赛表决会',
    socialMoney: '共担记录班次数、帮对方包扎次数、是否在罚金纠纷中替对方说话、是否在余兴时间选择倾听而非利用',
    sources: commonSources('闘技場', '地下', '淫欲の都市'),
    avoidNames: '人妻催眠／まどか切片人名',
    uniqueFlavor: '霓虹、金属栏杆、香槟与创可贴并存的甜涩',
    entryOpen: '新人记录员 L-07／包厢临时服务生',
    extraPlot: '\n**【补充赛季细目】**\n积分赛周的气味是金属与消毒水：飒会在你记录失误时用毛巾盖住你的手背而不是当众纠正；玲会在商会施压时把你挡在身后却用程序句说「记录员需要完整视野」；凛的包厢永远多一杯不加冰的水——她说是给自己，其实是给你。医务室的冰袋用完要登记，奈央把登记写成「谁为谁留下体温」。食堂关店后的热汤是唯一不进入手账的温柔，美咲因此成为所有人的秘密树洞。',
  },
  {
    name: 'エルフの森と淫魔-侵蝕篇',
    file: '产出/批次338/エルフの森と淫魔-侵蝕篇.md',
    sourceBlurb: '奇幻森居日常向条目，气质贴近日系同人R18中常见的「エルフの森／淫魔／侵食と共生」题材：以精灵森林被淫魔气息缓慢渗透后的共居、告示牌、药汤与边界协商为核心，而非清林征伐。公开可溯源可参照マヨタマ《～孕ませエルフの森～》等森居日常、DLsite「エルフの森」「淫魔」关键词作品',
    stage: '银雾之森侵蝕观测周',
    worldPos: '精灵边陲「银雾之森」出现柔粉雾气侵蝕带，族长决定以「观测共居」而非驱逐处理。契约者不扮演猎魔者，而以临时观测员／药汤帮工／边界记录员身份卷入精灵与低阶淫魔居民的日常与情感试探。',
    settingExtra: '银雾之森有主步道、温泉、木构长屋、侵蝕观测塔与内林篱笆。侵蝕雾让人更容易说真心话，但强制命令会触发清醒反弹与雾气退去。',
    places: [
      { name: '森口告示柱', desc: '莉叶尔登记观测员处。' },
      { name: '观测塔三楼', desc: '族长席与余响手账。' },
      { name: '银叶长屋', desc: '蜜莉安的客房与蜜茶。' },
      { name: '温泉石槽', desc: '萨芙的分时入浴。' },
      { name: '内林篱笆', desc: '诺菈守根。' },
      { name: '淫魔驿站茶寮', desc: '薇尔的夜灯与情报。' },
      { name: '药棚工房', desc: '芙洛调制解雾汤。' },
    ],
    chars: [
      { name: '莉叶尔·银铃', role: '观测主持／第一接触', look: '银白长发、淡青瞳、尖耳', personality: '克制好面子', type: '冷艳官员', moe: '宣读共居条款时印章微颤', line: '从利用记录员到承认怕雾散后无人留下', rel: '先上下级后对等' },
      { name: '蜜莉安·旅宿', role: '长屋女将', look: '栗色波浪、蜜瞳、围裙', personality: '粘人占有欲', type: '元气女将', moe: '蜜茶里藏钥匙', line: 'HE 公开往来', rel: '一見缠人' },
      { name: '诺菈·根篱', role: '内林看守', look: '短亚麻发、深棕瞳', personality: '寡言正直', type: '文静隐忍', moe: '雨中长句', line: 'True 禁止强制侵蝕条款', rel: '路人到树洞' },
      { name: '萨芙·雾汤', role: '温泉主事', look: '深栗发、浴衣外披', personality: '干练嘴硬', type: '成熟 mentorship', moe: '教换巾低笑', line: 'Bittersweet 外派', rel: '同事／短暂恋人' },
      { name: '薇尔·茶铃', role: '淫魔驿站', look: '盘发、小角、围裙', personality: '事务狂心软', type: '能干大姐姐', moe: '骂完塞热汤', line: '安定 End', rel: '监护→恋人可选' },
      { name: '芙洛·药棚', role: '药师', look: '中性短发、药渍手套', personality: '惜字如金', type: '规则之友', moe: '打断强制吸雾', line: '柏拉图信任', rel: '规则搭档' },
      { name: '先代残影奥伦', role: '隐藏', look: '旧麻衣、缺票印', personality: '遗憾温和', type: '导师', moe: '观景台旧印', line: '助 True', rel: '镜鉴' },
    ],
    heroFirst: '莉叶尔·银铃', manager: '莉叶尔·银铃', trueChar: '诺菈·根篱', bittersweet: '萨芙·雾汤', stable: '薇尔·茶铃', pressure: '外谷商队',
    hookItem: '青叶印章', festival: '共居表决会',
    socialMoney: '共担观测班、帮收客房、是否在商队前替对方说话、是否拒绝强制吸雾',
    sources: [
      { t: '～孕ませエルフの森～（DLsite·マヨタマ）', u: 'https://www.dlsite.com/maniax/work/=/product_id/RJ01647392.html' },
      { t: 'DLsite「エルフの森」检索', u: 'https://www.dlsite.com/maniax/fsr/=/language/jp/keyword/%E3%82%A8%E3%83%AB%E3%83%95%E3%81%AE%E6%A3%AE' },
      { t: '搜笔趣阁检索（未收录）', u: 'https://www.sobqg.com/searchBook.html?keyword=%E3%82%A8%E3%83%AB%E3%83%95%E3%81%AE%E6%A3%AE' },
    ],
    avoidNames: '翠遊の森／レティシア系人名',
    uniqueFlavor: '银叶雾、药汤、尖耳名牌与粉色侵蝕边的慢热',
    entryOpen: '临时观测员／药汤帮工',
    extraPlot: '\n**【补充侵蝕日常】**\n侵蝕雾不是敌人，而是会放大寂寞的天气：莉叶尔在雾浓时更依赖记录员在场；蜜莉安会把「只此一次」说成客房服务；诺菈坚持篱笆内侧不设强制吸雾阵；薇尔的茶寮是精灵与淫魔唯一能并坐不吵的地方。契约者若把雾当武器，全员好感下降；若把雾当需要被翻译的心情，True 线打开。',
  },
  {
    name: '女教師・真紀-校内調教',
    file: '产出/批次338/女教師・真紀-校内調教.md',
    sourceBlurb: '现代校园教师日常向条目，气质贴近日系同人R18中常见的「女教師／放課後／指導と依存」题材：以学年主任真纪的课后指导、教员室排班与「调教」被重新锚定为严格指导＋情感边界协商为核心。公开可溯源可参照葛千代女教师系列、Amelialtie 眼镜女教师日记、DLsite「女教師」关键词作品',
    stage: '私立翠岭高校期中指导周',
    worldPos: '私立翠岭高等学校进入期中补习与生活指导强化周。契约者不扮演猎艳清单执行者，而以教育实习生／教务助理／课后自习室值班身份卷入学年主任真纪与其他女教师的日常、会议纪要与情感升温。',
    settingExtra: '舞台含教员室、自习室、天台、印刷室与校门口便利店。所谓「调教」在本条中指严格指导、罚抄式关心与可拒绝的亲密协商，不是无脑强制。',
    places: [
      { name: '教员室学年席', desc: '真纪的红笔与茶杯。' },
      { name: '课后自习室', desc: '契约者值班主场。' },
      { name: '印刷室', desc: '香织的试卷与粉尘。' },
      { name: '天台铁丝网', desc: '雨谈与告白窗口。' },
      { name: '保健室', desc: '奈绪的冰袋。' },
      { name: '校门便利店', desc: '美咲的情报与关东煮。' },
      { name: '校长室外侧长椅', desc: '公开站队与压力视线。' },
    ],
    chars: [
      { name: '高桥真纪', role: '学年主任／第一接触', look: '黑发盘起、细框眼镜、合身西装裙', personality: '严格、好面子、怕被看穿寂寞', type: '冷艳教师／ mentorship', moe: '红笔停顿；从姓叫到名', line: '从「只是指导」到承认需要被依靠', rel: '先师生式后对等' },
      { name: '佐藤香织', role: '国语教师', look: '栗波浪、围巾、笑时酒窝', personality: '粘人会演戏', type: '元气同事', moe: '试卷袋里藏点心', line: 'HE 公开约会式往来', rel: '一見缠人' },
      { name: '中村玲奈', role: '教务', look: '短发、名牌端正', personality: '死板后爆发', type: '文静隐忍', moe: '雨中说长句', line: 'True 禁止代签指导记录', rel: '路人到树洞' },
      { name: '伊藤奈绪', role: '保健', look: '白衣、浅棕马尾', personality: '嘴硬心软', type: '大姐姐', moe: '骂完塞冰袋', line: '安定向 HE', rel: '监护可选' },
      { name: '渡边美咲', role: '便利店晚班', look: '橘马尾、耳钉', personality: '慌张八卦', type: '妹系', moe: '关东煮半价', line: '安定 End', rel: '情报依赖' },
      { name: '校长代理黑川', role: '压力源', look: '灰西装', personality: '要业绩', type: '不可攻略', moe: '无', line: '视线压力', rel: '制度' },
    ],
    heroFirst: '高桥真纪', manager: '高桥真纪', trueChar: '中村玲奈', bittersweet: '佐藤香织', stable: '渡边美咲', pressure: '校长代理黑川',
    hookItem: '红笔与指导章', festival: '期中指导总结会',
    socialMoney: '共值班次数、代印试卷次数、是否在投诉中替对方说话、是否拒绝美化指导记录',
    sources: commonSources('女教師', '放課後', '女教師'),
    avoidNames: '翠岭教委切片人名',
    uniqueFlavor: '粉笔灰、红笔、自习室灯管与便利店关东煮的甜涩',
    entryOpen: '教育实习生／自习室值班',
    extraPlot: '\n**【补充校园细目】**\n真纪的「调教」清单其实是生活指导表：坐姿、交作业、睡目前来回报。她用严厉遮住「别消失」。香织会把真心话写成作文题目；玲奈把旧校规附录里「倾听者可任特别委员」找出来；美咲知道谁买了第二杯热饮给谁。契约者若在总结会代签「全员自愿加班」，会锁 BE；若公开拒绝，True 线启动。',
  },
];

// batch 339
worlds.push(
  {
    name: '触手屋敷-招待客',
    file: '产出/批次339/触手屋敷-招待客.md',
    sourceBlurb: '奇幻洋馆招待日常向条目，气质贴近日系同人R18中常见的「触手／洋館／招待」题材：以会呼吸的洋馆、触手侍从与「招待」被重写为可拒绝的侍奉礼仪为核心，而非捕食闯关。公开可溯源可参照 DLsite「触手」「洋館」关键词作品',
    stage: '雾月馆招待周',
    worldPos: '郊外雾月馆对少数宾客开放「观察式招待周」。契约者以特邀观察客／临时侍应见习／馆务记录员身份进入，卷入馆主与触手侍从的礼仪、茶会与情感试探。',
    settingExtra: '雾月馆有门厅、茶厅、温室、地下锅炉与客房。触手是馆的神经系统，会端茶、递毯、拦下越界者；强制命令会让触手缩回并记入拒绝簿。',
    places: [
      { name: '铁门与门厅', desc: '馆主埃琳初遇。' },
      { name: '茶厅圆桌', desc: '公开站队。' },
      { name: '温室', desc: '莉娅的植物与私谈。' },
      { name: '客房三号', desc: '契约者落脚。' },
      { name: '锅炉房', desc: '诺瓦维修触手管路。' },
      { name: '拒书陈列室', desc: 'True 线索。' },
    ],
    chars: [
      { name: '埃琳·雾月', role: '馆主／第一接触', look: '黑长发、苍瞳、高领礼服', personality: '优雅克制', type: '冷艳上位', moe: '递茶时触手发抖', line: '从利用观察客到承认怕空馆', rel: '主客→对等' },
      { name: '莉娅·温室', role: '植物师侍从', look: '绿褐卷发、泥点围裙', personality: '粘人', type: '元气', moe: '花盆藏钥匙', line: 'HE', rel: '缠人' },
      { name: '塞菈·拒书', role: '图书', look: '灰短发、眼镜', personality: '寡言', type: '文静', moe: '雨中长句', line: 'True 禁止强制侍奉', rel: '树洞' },
      { name: '诺瓦·管路', role: '锅炉', look: '工装、烫伤疤', personality: '嘴硬', type: '大姐姐', moe: '骂完递手套', line: 'Bittersweet 外派检修', rel: '搭档' },
      { name: '米娅·门厅', role: '侍应', look: '小角发饰、托盘', personality: '慌张', type: '妹系', moe: '洒茶又擦净', line: '安定 End', rel: '情报' },
    ],
    heroFirst: '埃琳·雾月', manager: '埃琳·雾月', trueChar: '塞菈·拒书', bittersweet: '诺瓦·管路', stable: '米娅·门厅', pressure: '外客收藏家',
    hookItem: '银匙印章', festival: '闭馆茶会',
    socialMoney: '共担茶会班、帮修管路、是否拒绝强制侍奉、是否替触手记拒绝',
    sources: commonSources('触手', '洋館', '触手屋敷'),
    avoidNames: '其他触手条目人名',
    uniqueFlavor: '旧木香、银匙、触手端茶的礼仪感慢热',
    entryOpen: '特邀观察客／馆务记录员',
    extraPlot: '\n**【补充馆务】**\n触手有名字编号，米娅会纠正你叫错编号；埃琳最怕你把触手当工具；塞菈的拒书里写满「曾经被命令的人最后如何离开」。',
  },
  {
    name: '鬼畜道-復讐譚',
    file: '产出/批次339/鬼畜道-復讐譚.md',
    sourceBlurb: '都市复仇情感向条目，气质贴近日系同人R18中常见的「復讐／闇落ち／関係修復」题材：以「鬼畜道」被重写为以牙还牙的情感博弈与可停止的报复清单为核心，而非无脑施虐。公开可溯源可参照 DLsite「復讐」「NTR」等关系崩坏后修复向作品氛围',
    stage: '旧校区复仇清单周',
    worldPos: '废弃商业街「末广通」上，前学生会长黑崎葵手持一份「曾经伤害过她的人」清单。契约者以中立调解员／旧书店店员／清单见证人身份介入，目标是把复仇改写成对质、道歉与可拒绝的亲密，而不是互相毁灭。',
    settingExtra: '舞台含旧书店、居酒屋、屋顶、派出所前长椅与废弃社团室。清单上的名字会发光，但强制执行「伤害」会触发反弹并烧掉条目。',
    places: [
      { name: '末广旧书店', desc: '契约者落脚与情报。' },
      { name: '废弃社团室', desc: '葵的据点。' },
      { name: '居酒屋「未明」', desc: '对质与和解。' },
      { name: '屋顶水塔', desc: '雨谈。' },
      { name: '派出所长椅', desc: '制度压力。' },
    ],
    chars: [
      { name: '黑崎葵', role: '清单持有者／第一接触', look: '黑直长、刀疤耳饰、校服改装', personality: '恨意与温柔并存', type: '病娇边缘／复仇者', moe: '划掉名字时手抖', line: '从毁灭到允许被劝停', rel: '先利用后依赖' },
      { name: '白石遥', role: '旧同学／清单上', look: '浅金短发、职业装', personality: '愧疚克制', type: '大和抚子', moe: '道歉说到一半', line: 'HE 共同修复', rel: '敌对→恋人可选' },
      { name: '神谷凛', role: '旧书店主', look: '眼镜、围裙', personality: '冷静', type: '文静', moe: '把清单复印件藏起来', line: 'True 推动公开对质规则', rel: '树洞' },
      { name: '藤崎芽衣', role: '居酒屋', look: '马尾、伤疤手腕', personality: '爽朗', type: '元气', moe: '免费续杯', line: 'Bittersweet 搬走', rel: '损友' },
      { name: '警官佐仓', role: '压力', look: '制服', personality: '按章', type: '不可攻略', moe: '无', line: '视线', rel: '制度' },
    ],
    heroFirst: '黑崎葵', manager: '神谷凛', trueChar: '神谷凛', bittersweet: '藤崎芽衣', stable: '神谷凛', pressure: '警官佐仓',
    hookItem: '清单钢笔', festival: '公开对质夜',
    socialMoney: '共读清单次数、陪对质次数、是否劝停伤害、是否替对方保密',
    sources: commonSources('復讐', '闇落ち', '復讐'),
    avoidNames: '其他复仇条目人名',
    uniqueFlavor: '旧书店纸尘、居酒屋烟、清单发光的致郁甜',
    entryOpen: '旧书店店员／清单见证人',
    extraPlot: '\n**【补充复仇伦理】**\n本条「鬼畜道」指情感上的以牙还牙冲动，正文禁止无描写地展开伤害过程；重点写对质台词、停手瞬间与事后递水。葵的 True 不是杀光名单，而是当众烧掉清单并留下「可以恨，但不可以代替对方道歉」的规则。',
  },
  {
    name: '淫獄病棟-深夜勤務',
    file: '产出/批次339/淫獄病棟-深夜勤務.md',
    sourceBlurb: '医院深夜班日常向条目，气质贴近日系同人R18中常见的「看護師／深夜勤務／病棟」题材：以夜班交接、值班室与「淫獄」被重写为高压制度下的情感依赖为核心。公开可溯源可参照 DLsite「看護師」「病棟」关键词作品',
    stage: '圣夜综合病院东栋深夜班',
    worldPos: '圣夜综合病院东栋进入连续夜班周。契约者以实习护理／夜班记录员／值班室帮工身份卷入护士长与同事的交接、投诉与情感升温，不写猎奇医疗恐怖主轴。',
    settingExtra: '东栋有护士站、值班室、天台吸烟角、自动贩卖机与院长巡视走廊。高压排班让人更容易互相依赖，但强制「服务」患者或同事会触发反弹与记过。',
    places: [
      { name: '护士站', desc: '氷室玲初遇。' },
      { name: '值班室双层床', desc: '小憩与私谈。' },
      { name: '天台', desc: '雨后告白。' },
      { name: '自动贩卖机', desc: '共饮。' },
      { name: '院长走廊', desc: '压力视线。' },
    ],
    chars: [
      { name: '氷室玲', role: '护士长／第一接触', look: '盘发、锐利眼线、白衣', personality: '严格嘴硬', type: '冷艳上位', moe: '交接时声线抖', line: '承认需要被接班', rel: '上下级→对等' },
      { name: '橘葵', role: '夜班护士', look: '短发、笑窝', personality: '元气', type: '元气', moe: '偷塞甜面包', line: 'HE', rel: '缠人' },
      { name: '森下结衣', role: '记录', look: '眼镜、小声', personality: '隐忍', type: '文静', moe: '雨中长句', line: 'True 禁止强制连班', rel: '树洞' },
      { name: '白峰美咲', role: '药剂', look: '白大褂', personality: '干练', type: 'mentorship', moe: '教分药低笑', line: 'Bittersweet 调科', rel: '导师' },
      { name: '小田奈奈', role: '清扫夜班', look: '马尾、耳机', personality: '八卦', type: '妹系', moe: '走廊情报', line: '安定 End', rel: '情报' },
    ],
    heroFirst: '氷室玲', manager: '氷室玲', trueChar: '森下结衣', bittersweet: '白峰美咲', stable: '小田奈奈', pressure: '院长代理',
    hookItem: '交接章', festival: '夜班总结会',
    socialMoney: '共值班、代写记录、是否拒强制连班、是否在投诉中挡刀',
    sources: commonSources('看護師', '病棟', '病棟'),
    avoidNames: '其他医院条目人名',
    uniqueFlavor: '消毒水、荧光灯、甜面包与天台风的致郁甜',
    entryOpen: '实习护理／夜班记录员',
    extraPlot: '\n**【补充夜班】**\n「淫獄」是夜班之间的黑话，指排班地狱而非字面牢狱。玲用严厉保护新人；结衣把旧劳动规约找出来；葵用玩笑掩饰崩溃。正文重点写交接眼神与递水，不写露骨医疗玩法。',
  },
  {
    name: '魔物娘の館-飼育篇',
    file: '产出/批次339/魔物娘の館-飼育篇.md',
    sourceBlurb: '魔物娘共居日常向条目，气质贴近日系同人R18中常见的「魔物娘／飼育／館」题材：以「饲育」被重写为照护日程、食谱与边界协商为核心。公开可溯源可参照《魔物娘的同居日常》氛围及 DLsite「魔物娘」关键词作品',
    stage: '星灯馆照护周',
    worldPos: '市郊星灯馆收容数位魔物娘进行「社会化照护试点」。契约者以照护见习／食谱记录员／散步监护身份进入，核心是日程、喜欢的食物与可拒绝的亲密，不是驯兽。',
    settingExtra: '馆内有食堂、温室、淋浴区、夜间巡逻廊。照护手账记录睡眠与心情；强制「服从训练」会触发反弹与主管部门警告。',
    places: [
      { name: '星灯门厅', desc: '馆长初遇。' },
      { name: '食堂长桌', desc: '共食。' },
      { name: '温室', desc: '拉米亚晒太阳。' },
      { name: '夜间廊', desc: '巡逻与私谈。' },
      { name: '市役所窗口', desc: '制度压力。' },
    ],
    chars: [
      { name: '馆长紫苑', role: '人类馆长／第一接触', look: '紫短发、白大褂', personality: '温柔强势', type: 'mentorship', moe: '读手账时耳红', line: '承认需要被照护者反过来接住', rel: '上司→恋人可选' },
      { name: '拉米亚·娜莎', role: '蛇女', look: '金瞳、长尾', personality: '粘人', type: '元气魔物', moe: '尾巴卷椅脚', line: 'HE', rel: '缠人' },
      { name: '史莱姆·米露', role: '史莱姆', look: '半透明蓝', personality: '好奇', type: '天然', moe: '变形递毛巾', line: 'True 相关证人', rel: '树洞' },
      { name: '鹰身·基莉', role: '鸟翼', look: '羽翼、护目镜', personality: '傲娇', type: '傲娇', moe: '送小石子', line: 'Bittersweet 转馆', rel: '对打到依赖' },
      { name: '店员小春', role: '邻接超市', look: '围裙', personality: '慌张', type: '妹系', moe: '多送罐头', line: '安定 End', rel: '情报' },
    ],
    heroFirst: '馆长紫苑', manager: '馆长紫苑', trueChar: '史莱姆·米露', bittersweet: '鹰身·基莉', stable: '店员小春', pressure: '市役所巡查',
    hookItem: '照护手账章', festival: '开放参观日',
    socialMoney: '共食次数、散步监护、是否拒强制服从训练、是否替魔物娘说话',
    sources: commonSources('魔物娘', '飼育', '魔物娘'),
    avoidNames: '其他魔物娘条目人名',
    uniqueFlavor: '罐头汤、羽屑、温室暖光与手账贴纸的治愈',
    entryOpen: '照护见习／食谱记录员',
    extraPlot: '\n**【补充饲育重写】**\n「饲育」在本条=照护日程：喂食、梳毛、情绪记录。禁止把魔物娘写成无意志玩物；米露的 True 是推动「可拒绝贴贴」条款。',
  },
  {
    name: 'レイプゲーム-生存確率',
    file: '产出/批次339/レイプゲーム-生存確率.md',
    sourceBlurb: '生存游戏情感向条目，气质贴近日系同人R18中常见的「デスゲーム／確率／選択」题材：以「生存概率」系统被重写为合作任务、信任骰与可退出条款为核心，标题中的暴力词在本库中仅作题材标签，正文聚焦选择、信任与关系，不描写性暴力过程。公开可溯源可参照各类生存游戏／选择式 ADV 氛围',
    stage: '白室概率周',
    worldPos: '封闭设施「白室」运行「生存概率」合作实验。契约者以志愿者记录员／概率解说员／退出条款见证人身份进入，目标是把概率从恐惧工具改成可协商的合作游戏。',
    settingExtra: '白室有任务厅、休息舱、观察廊与退出闸。概率面板显示合作成功率；强制他人承担风险会触发反弹与实验中止。',
    places: [
      { name: '白室门闸', desc: '初遇。' },
      { name: '任务厅', desc: '公开站队。' },
      { name: '休息舱', desc: '私谈。' },
      { name: '观察廊', desc: '压力视线。' },
      { name: '退出闸', desc: 'True 关键。' },
    ],
    chars: [
      { name: '雾岛葵', role: '实验主持／第一接触', look: '白大褂、平板', personality: '冷静怕失控', type: '冷艳', moe: '概率下降时声线抖', line: '承认实验该被退出权约束', rel: '主持→对等' },
      { name: '星野芽', role: '志愿者A', look: '双马尾、运动服', personality: '元气怕拖后腿', type: '元气', moe: '把零食分你', line: 'HE', rel: '缠人' },
      { name: '冰室玲', role: '志愿者B', look: '短发、耳机', personality: '寡言', type: '文静', moe: '雨声采样给你听', line: 'True 推动强制退出权', rel: '树洞' },
      { name: '神崎美咲', role: '观察员', look: '西装', personality: '干练', type: 'mentorship', moe: '递水不说话', line: 'Bittersweet 调职', rel: '导师' },
      { name: '门卫小南', role: '闸口', look: '保安服', personality: '吐槽', type: '妹系', moe: '多给一张餐券', line: '安定 End', rel: '情报' },
    ],
    heroFirst: '雾岛葵', manager: '雾岛葵', trueChar: '冰室玲', bittersweet: '神崎美咲', stable: '门卫小南', pressure: '上层监察',
    hookItem: '概率平板笔', festival: '中期评估会',
    socialMoney: '共任务次数、是否替对方承担风险、是否拒绝强制、是否守护退出权',
    sources: commonSources('デスゲーム', '選択', '生存'),
    avoidNames: '其他游戏条目人名',
    uniqueFlavor: '白光、提示音、零食袋与退出闸红灯的紧张甜',
    entryOpen: '志愿者记录员／退出条款见证人',
    extraPlot: '\n**【内容边界铁则】**\n标题含极端题材词，但正文与游玩主轴严格禁止描写性暴力与伤害过程；「游戏」=合作任务与信任选择。任何强制他人的选项都应触发反弹与掉好感。True 线核心是写入「随时可退出且不被惩罚」的条款。',
  },
);

// batch 340
worlds.push(
  {
    name: '女戦士エフトラ-敗北者',
    file: '产出/批次340/女戦士エフトラ-敗北者.md',
    sourceBlurb: '奇幻女战士后日谈日常向条目，气质贴近日系同人R18中常见的「女戦士／敗北／虜」题材：以「敗北」被重写为停战协定后的伤员照护、勋章归还与自尊修复为核心，而非继续厮杀。公开可溯源可参照 DLsite「女戦士」「敗北」关键词作品氛围',
    stage: '边塞停战照护周',
    worldPos: '边塞城镇「灰棘」刚签署停战。女战士艾芙特拉作为「名义上的败者」被安置在伤员馆。契约者以伤员馆记录员／勋章保管见习／停战监督助手身份进入，核心是自尊、伤口与可拒绝的亲密。',
    settingExtra: '伤员馆有疗伤室、兵器库（上锁）、食堂与城墙夜巡。停战条款禁止侮辱性表演；强制「败者侍奉」会触发反弹与外交抗议。',
    places: [
      { name: '伤员馆门厅', desc: '初遇。' },
      { name: '疗伤室', desc: '包扎。' },
      { name: '城墙夜巡', desc: '雨谈。' },
      { name: '食堂', desc: '共食。' },
      { name: '兵器库外', desc: 'True 线索。' },
    ],
    chars: [
      { name: '艾芙特拉', role: '女战士／第一接触', look: '赤发、伤疤、绷带', personality: '傲、怕被可怜', type: '傲娇战士', moe: '拒绝拐杖却接过水', line: '从恨「败者」标签到允许被接住', rel: '敌意→依赖' },
      { name: '疗伤官莉娜', role: '医师', look: '白袍、金瞳', personality: '温柔强势', type: 'mentorship', moe: '包扎时低笑', line: 'HE', rel: '监护→恋人' },
      { name: '书记官诺尔', role: '停战文书', look: '眼镜、墨迹', personality: '死板后爆发', type: '文静', moe: '雨中长句', line: 'True 禁止侮辱条款', rel: '树洞' },
      { name: '斥候玛露', role: '夜巡', look: '斗篷、短刃', personality: '寡言', type: '隐忍', moe: '扔来干粮', line: 'Bittersweet 归队', rel: '搭档' },
      { name: '食堂婶婶波波', role: '后勤', look: '围裙', personality: '吵闹', type: '大姐姐', moe: '多盛汤', line: '安定 End', rel: '情报' },
    ],
    heroFirst: '艾芙特拉', manager: '疗伤官莉娜', trueChar: '书记官诺尔', bittersweet: '斥候玛露', stable: '食堂婶婶波波', pressure: '城主特使',
    hookItem: '停战章', festival: '勋章归还仪式',
    socialMoney: '共巡夜、包扎协助、是否拒侮辱表演、是否归还勋章尊严',
    sources: commonSources('女戦士', '敗北', '女戦士'),
    avoidNames: '其他女战士条目人名',
    uniqueFlavor: '绷带、铁锈、炖汤与城墙风的硬派甜',
    entryOpen: '伤员馆记录员／停战监督助手',
    extraPlot: '\n**【补充敗北重写】**\n「敗北者」是外交标签，不是人格判决。正文禁止继续虐杀描写；重点写艾芙特拉如何重新拿起木剑训练、如何允许别人叫她的名字而不是「败者」。',
  },
  {
    name: '妖艶くノ一-密命失敗',
    file: '产出/批次340/妖艶くノ一-密命失敗.md',
    sourceBlurb: '和风忍者情感向条目，气质贴近日系同人R18中常见的「くノ一／密命／失敗」题材：以任务失败后的潜伏、身份暴露危机与「妖艳」被重写为社交伪装下的真心为核心。公开可溯源可参照 DLsite「くノ一」关键词作品',
    stage: '花街潜伏周',
    worldPos: '花街「薄红町」里，女忍者红叶因密命失败被迫以艺者见习身份潜伏。契约者以新来的账房／屋敷帮工／联络人身份与她纠缠，核心是身份、信任与可拒绝的亲密。',
    settingExtra: '薄红町有茶屋、屋顶夜路、河岸与屋敷账房。密命失败使红叶随时可能被组织召回；强制她继续「美色任务」会触发反弹与她的逃离。',
    places: [
      { name: '茶屋缘侧', desc: '初遇。' },
      { name: '屋顶夜路', desc: '真实身份对话。' },
      { name: '河岸', desc: '雨谈。' },
      { name: '账房', desc: '契约者主场。' },
      { name: '组织联络点', desc: '压力。' },
    ],
    chars: [
      { name: '红叶', role: 'くノ一／第一接触', look: '赤褐长发、勾玉耳饰、艺者半妆', personality: '妖艳是伪装，内里疲惫', type: '冷艳／妖艳', moe: '卸妆后声音变软', line: '从利用账房到请求被记住本名', rel: '利用→恋人' },
      { name: '若女将小铃', role: '茶屋', look: '振袖、笑', personality: '精明温柔', type: '大姐姐', moe: '多给一碗茶泡饭', line: 'HE', rel: '监护' },
      { name: '账房阿雪', role: '前辈', look: '短发、算盘', personality: '死板', type: '文静', moe: '雨中长句', line: 'True 推动伪身分保护', rel: '树洞' },
      { name: '组织使者黑', role: '压力', look: '蒙面', personality: '冷', type: '不可攻略', moe: '无', line: '召回威胁', rel: '压力' },
      { name: '河岸摊贩小桃', role: '情报', look: '斗笠', personality: '慌张', type: '妹系', moe: '多串团子', line: '安定 End', rel: '情报' },
    ],
    heroFirst: '红叶', manager: '若女将小铃', trueChar: '账房阿雪', bittersweet: '红叶', stable: '河岸摊贩小桃', pressure: '组织使者黑',
    hookItem: '假名木牌', festival: '花街祭',
    socialMoney: '共守秘密次数、屋顶同行、是否拒美色任务、是否帮她留下',
    sources: commonSources('くノ一', '花街', 'くノ一'),
    avoidNames: '其他忍者条目人名',
    uniqueFlavor: '脂粉、河风、算盘与屋顶瓦的和风甜',
    entryOpen: '新账房／屋敷帮工',
    extraPlot: '\n**【补充密命】**\n失败的密命内容可写「传信未送达／身份暴露风险」，不写露骨色诱过程。红叶的 True 不是杀回组织，而是在祭典上以本名鞠躬并获町内保护条款。',
  },
  {
    name: '淫魔の契約-代償',
    file: '产出/批次340/淫魔の契約-代償.md',
    sourceBlurb: '淫魔契约日常向条目，气质贴近日系同人R18中常见的「淫魔／契約／代償」题材：以契约条款、代价记账与「性」被情绪化处理的共居为核心。公开可溯源可参照 DLsite「淫魔」「契約」关键词作品',
    stage: '契约事务所代价周',
    worldPos: '都市角落的「暮契约事务所」专门处理人类与淫魔的对等契约。契约者以见习公证人／代价记账员／茶水帮工身份进入，核心是条款、代价与可解除权。',
    settingExtra: '事务所有会客室、条款柜、茶水间与解除室。契约必须三次确认；强制不平等条款会触发反弹与公会吊销。',
    places: [
      { name: '会客室', desc: '初遇。' },
      { name: '条款柜', desc: 'True 线索。' },
      { name: '茶水间', desc: '私谈。' },
      { name: '解除室', desc: '结局关键。' },
      { name: '公会窗口', desc: '压力。' },
    ],
    chars: [
      { name: '淫魔莉丝', role: '合伙人／第一接触', look: '小角、粉瞳、西装', personality: '笑面怕被讨厌', type: '妖艳／傲娇', moe: '读代价时停顿', line: '从诱签到主动写解除权', rel: '交易→恋人' },
      { name: '公证人白', role: '人类所长', look: '银发、眼镜', personality: '严格', type: '冷艳', moe: '章印歪时耳红', line: 'HE', rel: '上司' },
      { name: '见习小梅', role: '茶水', look: '双马尾', personality: '慌张', type: '妹系', moe: '洒茶', line: '安定 End', rel: '情报' },
      { name: '老契约者灰', role: '常客', look: '风衣', personality: '疲惫', type: '对照', moe: '说「别学我」', line: 'Bittersweet 解除后离开', rel: '镜鉴' },
      { name: '公会巡查', role: '压力', look: '制服', personality: '按章', type: '不可攻略', moe: '无', line: '吊销威胁', rel: '制度' },
    ],
    heroFirst: '淫魔莉丝', manager: '公证人白', trueChar: '公证人白', bittersweet: '老契约者灰', stable: '见习小梅', pressure: '公会巡查',
    hookItem: '契约火漆', festival: '条款公开审查会',
    socialMoney: '共拟条款、拒不平等、守护解除权、茶水共处',
    sources: commonSources('淫魔', '契約', '淫魔'),
    avoidNames: '其他淫魔契约条目人名',
    uniqueFlavor: '火漆香、钢笔、茶渍与解除室冷光的法务甜',
    entryOpen: '见习公证人／代价记账员',
    extraPlot: '\n**【补充代价】**\n代价可以是时间、故事、陪伴，不写强制肉体剥削过程。True 线是把「可随时解除且不报复」写进所有模板合同。',
  },
  {
    name: '学園ハーレム-支配者',
    file: '产出/批次340/学園ハーレム-支配者.md',
    sourceBlurb: '学园后宫日常向条目，气质贴近日系同人R18中常见的「学園／ハーレム／支配」题材：以学生会「支配」被重写为排班、预算与可拒绝的人气经营为核心。公开可溯源可参照各类学园后宫 ADV 氛围与 DLsite「学園」关键词',
    stage: '私立星见学园文化祭前',
    worldPos: '私立星见学园学生会进入文化祭筹备。契约者以转学生／学生会书记见习／放送部助手身份进入，所谓「支配者」是被流言推上的人气中心，不是绝对统治。',
    settingExtra: '校园有学生会室、天台、放送部、社团街。人气点数会涨落；强制他人服从会触发反弹与弹劾。',
    places: [
      { name: '校门', desc: '初遇。' },
      { name: '学生会室', desc: '排班。' },
      { name: '天台', desc: '告白。' },
      { name: '放送部', desc: '情报。' },
      { name: '社团街', desc: '公开站队。' },
    ],
    chars: [
      { name: '会长冰华', role: '学生会长／第一接触', look: '银长发、蓝瞳', personality: '完美主义', type: '冷艳女王', moe: '预算表手抖', line: '承认需要被反对', rel: '上下级→对等' },
      { name: '副会炽', role: '副会长', look: '赤短发', personality: '元气', type: '元气', moe: '塞点心', line: 'HE', rel: '缠人' },
      { name: '书记月', role: '书记', look: '黑短发、眼镜', personality: '隐忍', type: '文静', moe: '雨中长句', line: 'True 弹劾权与拒绝权', rel: '树洞' },
      { name: '放送柚', role: '主播', look: '双马尾', personality: '八卦心软', type: '妹系', moe: '偷偷剪掉黑料', line: '安定 End', rel: '情报' },
      { name: '顾问老师雾', role: '顾问', look: '白衣', personality: '旁观', type: 'mentorship', moe: '递茶', line: 'Bittersweet 调校', rel: '导师' },
    ],
    heroFirst: '会长冰华', manager: '会长冰华', trueChar: '书记月', bittersweet: '顾问老师雾', stable: '放送柚', pressure: '理事长特使',
    hookItem: '学生会章', festival: '文化祭开幕',
    socialMoney: '共排班、放送站台、拒强制服从、预算透明',
    sources: commonSources('学園', 'ハーレム', '学園'),
    avoidNames: '其他学园后宫条目人名',
    uniqueFlavor: '广播声、粉笔、天台风与预算表的青春甜',
    entryOpen: '转学生／学生会书记见习',
    extraPlot: '\n**【补充支配重写】**\n「支配者」是流言头衔。正文重点写排班公平与拒绝权；强制后宫服从会触发弹劾事件。',
  },
  {
    name: '姫君たちの牢獄-奴隷市',
    file: '产出/批次340/姫君たちの牢獄-奴隷市.md',
    sourceBlurb: '奇幻拍卖都市日常向条目，气质贴近日系同人R18中常见的「姫／奴隷市／牢獄」题材：以「奴隶市」被重写为身份抵押拍卖、赎回条款与公主们的尊严博弈为核心，正文禁止物化无意志描写，强调赎回、公证与可拒绝。公开可溯源可参照 DLsite「姫」「奴隷」关键词作品氛围',
    stage: '砂金市赎回周',
    worldPos: '沙漠商都砂金市的「身份抵押市」正值赎回周。数位落难姬君以「可赎回契约」暂居白塔。契约者以公证人见习／赎回账房／塔内记录员身份进入，核心是赎回金、尊严与同盟。',
    settingExtra: '白塔有展示廊（仅身份牌）、会客室、赎回柜台与密道。强制侮辱性展示会触发反弹与商会制裁。',
    places: [
      { name: '赎回柜台', desc: '初遇。' },
      { name: '白塔会客室', desc: '公主们。' },
      { name: '展示廊', desc: '身份牌。' },
      { name: '密道', desc: 'True 线索。' },
      { name: '商会大厅', desc: '压力。' },
    ],
    chars: [
      { name: '姬君奥莉薇', role: '第一公主／第一接触', look: '金长发、锁骨旧伤、旅行斗篷', personality: '傲、护妹妹', type: '高傲姬', moe: '被叫本名时愣住', line: '从利用账房到请求并肩赎回', rel: '利用→恋人' },
      { name: '姬君露娜', role: '次女', look: '银发、大瞳', personality: '软、观察强', type: '文静', moe: '塞半块干粮', line: 'True 推动禁止侮辱展示', rel: '树洞' },
      { name: '公证人赛拉', role: '柜台', look: '墨镜、墨水', personality: '冷面热心', type: 'mentorship', moe: '章印歪', line: 'HE', rel: '上司' },
      { name: '商会克洛', role: '压力', look: '金链', personality: '贪', type: '不可攻略', moe: '无', line: '压价', rel: '压力' },
      { name: '塔仆米娅', role: '后勤', look: '头巾', personality: '慌张', type: '妹系', moe: '多送水', line: '安定 End', rel: '情报' },
    ],
    heroFirst: '姬君奥莉薇', manager: '公证人赛拉', trueChar: '姬君露娜', bittersweet: '姬君奥莉薇', stable: '塔仆米娅', pressure: '商会克洛',
    hookItem: '赎回火漆', festival: '赎回公开日',
    socialMoney: '共拟赎回条款、拒侮辱展示、护送、保守密道秘密',
    sources: commonSources('姫', '奴隷', '姫'),
    avoidNames: '其他公主奴隶条目人名',
    uniqueFlavor: '砂尘、火漆、白塔铃与干粮的硬派甜',
    entryOpen: '公证人见习／赎回账房',
    extraPlot: '\n**【内容边界】**\n「奴隶市」在本条=身份抵押与可赎回契约市场。禁止把姬君写成无意志玩物；重点写赎回谈判、本名被叫出的瞬间与公开日的尊严。True 线禁止侮辱性展示并确立赎回冷静期。',
  },
);

const results = [];
for (const w of worlds) {
  const dir = path.dirname(w.file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // skip already good ones if re-run? overwrite all remaining
  if (w.name === '人妻催眠-隣人の妻' || w.name === '魔法少女まどか☆マギカ-堕落IF') continue;
  const md = buildWorld(w);
  fs.writeFileSync(w.file, md, 'utf8');
  const plot = md.split('## 休闲切入点')[0];
  const entry = (md.split('## 休闲切入点')[1] || '').split('## 来源')[0];
  results.push({
    name: w.name,
    plot: plot.replace(/\s/g, '').length,
    entry: entry.replace(/\s/g, '').length,
    file: w.file,
  });
}
console.log(JSON.stringify(results, null, 2));
