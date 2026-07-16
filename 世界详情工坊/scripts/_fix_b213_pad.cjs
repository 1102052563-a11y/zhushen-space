const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '../产出/批次213');

const replacements = {
  '假面骑士空我.md': `
**【Pole Pole与市民编年】**
咖啡厅「慢慢来」是五代兄妹与老爹的生活装置：雄介无手机，联络常靠身边人转达；美理在若叶保育园；奈奈从京都来追演员梦，老师被第31号所杀后一度崩溃。元城恵子产子取名雄太郎，把「雄介」之名接进下一代。没有日常，战斗只剩杀戮。契约者在此过夜与欠人情债，也须面对「把怪人战火带进店」的风险。

**【未确认生命体编号作战史】**
第0号达古巴不完全体开局；初生白曾被误判为与第4号不同的号；第3号ゴオマ；第4号空我；其后ズメゴ依次编号。B群=人形态者。编号让警方能申请预算与对媒体说话，也制造误击空我。樱井色标笔记把击破形态数据化，反推游戏规则。本部场景应有白板编号与未解问号，而非魔法司令部。

**【阿玛达姆医学线】**
椿秀一自封世界唯一主治医，监测神经变化，警告雄介可能变成战斗生物。假死自愈、电击变质、黄金时限解除皆为医学事件。究极眼黑=医学预言可视化。持类似灵石者应被要求抽血与停战观察。

**【一条薰个人史】**
父在其生日救灾殉职故不收生日礼物；母民子名古屋护士长。严谨少笑，可弯曲规则救人。唯一完成巴尔巴击坠的人侧核心。战后回长野。与雄介对照：一竖拇指，一几乎不笑，同行守护。

**【SAT与特殊弹演进】**
从常规枪火无效，到瓦斯弹、追踪弹、神经断裂弹。每一代都有失败与伦理争议。神经弹对人类亦极端危险。一条八发击坠巴尔巴是人侧科技顶点时刻之一。

**【临多文与钩拉姆】**
樱子译经进度=形态理解进度。钩拉姆由碎片与研究唤醒，合体摩托改变车战格局。尚·索雷尔参与发掘与钩拉姆研究，并关心榎田家庭。译经室通宵是三阶核心场景。
`,
  '假面骑士亚极陀.md': `
**【风谷—美杉日常生活装置】**
翔一寄住后的洗碗吃饭、被真鱼训、被太一追问，是「普通人资格」主题的视觉化。Lord行刑若发生在通勤路上比荒野更恐怖。美杉义彦提供家庭是否接纳怪物的讨论场。契约者优先保护餐桌完整性。

**【G3后勤真实感】**
出阵要拖车、冷却、弹药模块、小泽在线校准。时限到强制撤退是设定。北条派系可调包冷却液、泄露出勤表、抢指挥权。二~四阶任务大量在机库与运输线。

**【超能力者社会】**
名单上的人可能不知资格含义；有人躲、有人觉醒、有人被举报。Lord「守护」辞令分裂舆论。数字谜让推理与动作并存。可做假死除名、转移身份、破译门牌数字。

**【三骑士误战样本】**
G3射击Agito、Gills袭击翔一、抢同一Lord人头波及平民——早期结构必然。协同口号出现前默认互不信任。

**【晓号与记忆碎片】**
船难、实验、失忆三位一体。恢复记忆不等于变强，可能带来更重罪感。四阶任务常是档案战。

**【电影G4要点】**
GA、纱绫香预言、蚁Lord、水城G4对冰川。主题是武器化预言与量产骑士。作五阶副本，不覆盖六阶神侧终局。
`,
  '游戏王ARC-V.md': `
**【游胜塾经营战】**
修造热血挡不住LDS资本与场地契约。断电挖角公开赛打压是二阶主菜。柚子助教兼青梅；游矢的笑是品牌也是弱点。拿LDS钱常附带放弃钟摆公开课等条款。

**【卡片化伦理现场】**
败者变成可收藏的卡。心之地废墟里家人认领卡册不是遗体。学院白墙不沾血。把卡片化写成封印休息违原作。救援成功标准是人还在。

**【同步城市阶级】**
上层光洁骑乘、下层地下赌斗；公安清理不稳定娱乐。杰克是体制顶层符号；克罗是地下出口。宣扬笑可能先被砸再被通缉。

**【赤马家双线】**
零儿抗父罪业建兰瑟斯；零王侧推动统一战争。说服零儿用战果与逻辑不用鸡汤。

**【四分命运操作手册】**
阻止错误吸收、保护少女碎片、维持游矢人格边界，是五~六阶核心任务类型。

**【动作决斗产业细节】**
动作卡、场地发生器、转播权、青少年锦标赛奖金。娱乐是经济也是意识形态。战争期产业崩溃本身即剧情。
`,
  '游戏王VRAINS.md': `
**【电脑岛双层生活】**
白天学校街头，夜里VRAINS。KOLTER据点后勤。SOL用协议与封号代替司法。只活在VR会错过失落事件现实线索。

**【骑士团理论】**
Varis先毁Cyberse防AI威胁；以失落事件为道德许可。与Playmaker对决常伴随理念辩论。Lightning期可临时同盟，条款含战后仍要解决Ai。

**【Ignis六属性政治】**
共存、支配、中立、被改写。Bohman是「完成人类」答案亦是嘲讽。吸收=种族灭绝式合并。五阶要写清帮哪一个未来。

**【终局模拟决定论】**
模拟中游作总为护Ai死。Ai约战为打断决定论。开放残留不等于无代价满血回归。

**【魅斗产业】**
Go人设、煌直播、收视率是SOL合法性。袭击公共区=袭击经济与信仰。

**【SOLtis社会接口】**
机器人入现实后，网络杀伤可变成街头物理事件。三季恐惧升级点。
`,
  '艾尔之光－Elsword－.md': `
**【城镇委托生态】**
各枢纽NPC给材料剧情声望。强化公会是合法战力。刷图须嵌史诗：同一只噗鲁开篇是教学，魔族期可能是异化预警。

**【班德与红骑士团】**
官军提供后勤与大规模战，搜查队是尖刀。攻城时指挥权冲突是戏。官军可能征用碎片。

**【元素主宰政治】**
罗索热情、盖亚稳重、丹尼弗冷智、温图斯循环、索雷斯罪与生命、伊贝伦安慰与阴影。主宰有试炼不是无条件援军。

**【魔界远征后勤】**
通道、魔气抗性、补给、君主外交。深红之塔可灭队。须准备撤退点。

**【爆炸纪念日阴影】**
和谐祭在后世既是节日也是创伤纪念日。五百年碎片政治由此开始。

**【职业分线叙事】**
骑士/法师/弓手/改造者/机械女王/炮骑士/枪武者/红骑士/时空/双人魔族/枪械/神官/镜/镰等分线，转职对应心境事件，禁止无剧情商场买3转。
`
};

for (const [file, body] of Object.entries(replacements)) {
  const p = path.join(dir, file);
  let t = fs.readFileSync(p, 'utf8');
  // normalize literal \n from bad pad write
  // Only fix within pad region carefully: replace whole pad through 阶位 header
  const padIdx = t.indexOf('<!--b213-pad-->');
  if (padIdx < 0) {
    console.log('no pad', file);
    continue;
  }
  // Find real or literal section header after pad
  let endIdx = t.indexOf('\n## 阶位切入点', padIdx);
  if (endIdx < 0) {
    // literal backslash-n before header
    const lit = t.indexOf('\\n## 阶位切入点', padIdx);
    if (lit >= 0) endIdx = lit;
  }
  if (endIdx < 0) {
    // search any 阶位切入点 after pad
    endIdx = t.indexOf('## 阶位切入点', padIdx);
  }
  if (endIdx < 0) {
    console.log('no end', file);
    continue;
  }
  // If we landed on header itself, keep it; if we landed on \n## or \\n##, include junk before header in removal
  const headerIdx = t.indexOf('## 阶位切入点', padIdx);
  t = t.slice(0, padIdx) + '<!--b213-pad-->\n' + body.trim() + '\n\n' + t.slice(headerIdx);
  // also fix any remaining literal \n in the whole file? dangerous. Only if file has many
  // Fix common corruption: sequences of \\n that should be newlines in expand sections
  // Count: if file contains '\\n\\n##' restore
  if (t.includes('\\n## ')) {
    t = t.replace(/\\n/g, '\n');
  }
  fs.writeFileSync(p, t);
  const plot = (t.split('## 剧情')[1] || '').split('## 阶位切入点')[0] || '';
  const entry = (t.split('## 阶位切入点')[1] || '').split('## 来源')[0] || '';
  console.log(file, 'plot', plot.replace(/\s/g, '').length, 'entry', entry.replace(/\s/g, '').length);
}
