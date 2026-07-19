const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '产出', '批次99');

function strip(s) {
  return s.replace(/\s/g, '').length;
}
function measure(t) {
  const story = t.split('## 阶位切入点')[0].replace(/^[\s\S]*?## 剧情\s*/, '');
  const cut = t.split('## 阶位切入点')[1].split('## 来源')[0];
  return { story: strip(story), cut: strip(cut) };
}
function inject(file, block) {
  let t = fs.readFileSync(file, 'utf8');
  const marker = '## 阶位切入点';
  const i = t.indexOf(marker);
  if (i < 0) throw new Error('no cut ' + file);
  t = t.slice(0, i) + block + '\n\n' + t.slice(i);
  fs.writeFileSync(file, t, 'utf8');
  const m = measure(t);
  console.log(path.basename(file), 'story', m.story, 'cut', m.cut);
}

const s3 = `
**⑲ 学院日常作息与可观察细节（写正文用）**
清晨温室喷壶与研磨药草；中午礼仪课掩护防御咒练习；黄昏 Fiona 若在宅则香水先于脚步抵达；夜半阁楼娃娃房有时有脚步——Spalding 已死，魂仍自称管家。食堂对话优先谈谁开始发光、理事会是否来访、第九区美发店今开不开。契约者伪装学生时最容易露馅：不会应付真言试探、对火刑史一脸无知、把 Marie 当成旅游景点。正确伪装：先怕 Fiona，再恨猎巫，最后才谈理想与姐妹情。

**⑳ 七大奇迹逐项可操作说明**
Telekinesis：课堂可控粉笔，战场可翻巴士。Concilium：Nan 线已示范逼人自杀级精神控制。Descensum：入个人地狱，日出未归即如 Misty 永囚。Transmutation：瞬移，Zoe 穿铁门失败是致命案例。Divination：Cordelia 天眼变体，Madison 败在此项。Pyrokinesis：Madison 在邻里冲突中觉醒。Vitalum Vitalis：Misty 招牌，Cordelia 用以救 Zoe。考验日观众是理事会与学生，政治表演与实力测试叠合。契约者宜做保护考生、防暗杀，而不是代考硬刚。

**㉑ 种族与历史债务的场景写法**
LaLaurie 线禁止写成有趣的不朽名媛奇观；须写奴隶阁楼的血、牛头面具的羞辱、Queenie 被迫与其共处的结构暴力。Marie 的美发店是社区权力核。Hank 的枪指向可见的他者。Cordelia 公开化后门外少女种族多样，媒体会选择性剪辑——正文应让契约者面对镜头政治，而不是只庆祝女巫出柜。

**㉒ 额外可介入微观事件**
帮 Myrtle 藏火刑前的真言录音，供复活后清算。在 Stevie Nicks 演出夜控制后门人流，防 Delphi 混入。为 Kyle 智力恢复期设安全词，减少误伤。复制院史中 Anna-Lee 被杀相关无档碎片交给 Cordelia 而非 Fiona。七奇迹后协助登记新生，识别混入的猎巫眼线。保护 Nan 被献祭前的最后证词。在丧尸围城夜为温室留通风口当备用呼吸点。

**㉓ 法术与凡人武器对照（防膨胀）**
单能力女巫约三阶观感；多能力候选人四阶；Fiona 全盛与 Marie 亡灵军五阶；Legba 与公开化全国舆论七阶。猎巫步枪在近距可杀未设防女巫，故「魔法碾压现代枪」不成立。契约者持枪突袭学院可能被念动缴械，更可能被程序（理事会）与契约（Legba）反杀。
`;

const s4 = `
**⑲ 营地经济与分账政治（写正文用）**
畸形秀的真实货币是门票、拍照费、私下加演、阔少支票、标本馆订单。Elsa 用「家」话术掩盖分账不公；Ethel 用毒舌维持底线；Dell 用拳头改规则。契约者入营若只想打怪，会错过主线：谁有权签你的身体。日场观众多是带着恶心表情的镇民，夜场可能有 Dandy 式买家。节目单上的一行字可以救命也可以定价出售。

**⑳ Twisty 与 Dandy 的杀戮语法差异**
Twisty：创伤驱动的表演式囚禁，目标常是儿童与情侣，巴士是移动监狱。Dandy：金钱与空虚驱动的神化自我，从模仿面具到血浴母亲到买团屠尽。Mordrake 收 Twisty 因「最悲」；Dandy 不按灵体剧团逻辑走，他是活人资本怪物。对策不同：Twisty 可救童并条件性引 Mordrake；Dandy 须断资金、夺面具、集体处刑，禁止无布局单挑。

**㉑ Pepper 跨季接口的正确用法**
Pepper 在本季是被 Elsa 收藏又转交的工具人，九年后被姐家嫁祸入 Briarcliff，见 Mary Eunice，杂志封面是 Elsa——宇宙钉，不是让契约者跳转 S2 开新档的许可证。本世界任务最多到认出封面、保护 Pepper 不被二次买卖；禁止在 S4 正文剧透 S2 终局细节。

**㉒ 额外可介入微观事件**
Meep 入狱前调换指认证词。给 Massimo 送材料加速 Jimmy 义肢，缩短无手窗口。Tupperware 屠前匿名警告聚会女主人提防 Mott 家的儿子。截断 Stanley 与 Lillian 的电话订单。1960 线在艳情片发布前调换拷贝（可能触发别种勒索）。万圣夜为 Elsa 准备干扰 Mordrake 选拔的伪叙事道具（极高风险，可能改收别人）。保护 Ma Petite 的血衣作为团内起诉 Dell 的物证。

**㉓ 展演节目单上的具名身体（防群像）**
Paul the Illustrated Seal、Legless Suzi、Amazon Eve、Ima Wiggles、Ma Petite、Meep——写场景必须点名，禁止「众畸形」。Meep 狱死、Ma Petite 标本、Salty 被砍头卖馆，每件都应有可捡物证任务。Desiree 的身体被医生重新定义时，任务是医疗知情权，不是猎奇。

**㉔ 1952 镇民与警察的正确反应**
宵禁、私刑威胁、把残疾当犯罪嫌疑，是系统默认。Jimmy 被诬杀 Tupperware 女，说明英雄叙事一夜可翻转。契约者若指望「警察主持公道」，会在本季反复挨打；更稳的是团内见证链与外部律师，而不是报警一条龙。
`;

const s5 = `
**⑲ 旅馆权限政治（写正文用）**
Cortez 的真地图是权限表：谁有万能卡、谁能停电梯、谁知 64 号密室、谁能进儿童棺房。Iris 前台是海关；March 电梯是面试；Countess 顶层是宫廷。契约者优先抢的不是枪，是一夜权限。历史地标申请通过后幽灵被要求克制杀戮——资本收编恐怖的笑话，也是七阶钩子：你是帮 March 维持门面，还是向 Billie Dean 泄密？

**⑳ 十诫杀手的拼图逻辑（防 OOC）**
John 不是被附身，是被 March 选中并塑形；Holden 绑票是催化剂；记忆压抑让他以警探身份调查自己。每一案对应戒律主题的讽喻处决。揭晓前给 John 看完整拼图，可能加速崩溃或加速收官杀 Countess，蝴蝶效应巨大须写代价。揭晓后任务从抓杀手变为是否让他完成最后一诫、是否公开真相。

**㉑ 血裔转化的伦理阶梯**
Countess 转化等于纳入宴席；Donovan 转化 Iris 是扭曲母职；Alex 转化是为伴子；Alex 救 Max 引爆校园疫。血童不是萌宠，是公共安全灾难。Ramona 复仇是血裔内战。契约者参与转化须承担多一条永困或疫链的后果。馆外死与馆内永困是关键分流阀：Donovan 求移出即示例。

**㉒ 额外可介入微观事件**
魔鬼之夜前撤离或替换「甜点」人质。助 Liz 与 Douglas 见面时防 March 干扰。在 Countess 婚礼登记处拖延过户。给 Addiction Demon 房换空垫并封锁（条件性）。保护 Queenie 类跨季访客的退房通道。一年后经营期协助 Liz 设内部伦理宪章约束幽灵杀客。复制 64 号密室罪证照藏吧台夹层。

**㉓ 跨季接口清单（仅人名锚）**
Charles Montgomery 的堕胎手术台；Billie Dean 的通灵节目；Queenie 入住风险；Murder House 地理闪回。禁止在本档展开他季完整结局。Countess 被设定为系列中早期 Supreme 相关讨论的接口时，本档只保留人名级提示。

**㉔ Art Deco 空间恐怖的写法**
天鹅绒、黄铜、尖角装饰、不通向任何处的走廊、突然出现的七楼黑暗——场景优先写「路走不通」而不是「突然跳鬼」。电梯门打开时先问楼层是否该存在。前台铃响可能是服务，也可能是处刑通知。
`;

const s6 = `
**⑲ 双层叙事的称呼铁则（写正文用）**
同一演员可能对应当事人与重演角色两层：例如真 Shelby 与重演 Audrey，真 Matt 与重演 Dominic，真 Lee 与重演 Monet。正文必须写清层，禁止混成一个人。契约者切入先问：我在纪录片时间线，还是续集拍摄时间线？前者还有逃回洛杉矶的假痊愈；后者几乎只有死。

**⑳ 血月六日操作手册**
十月固定窗口内：围屋、献祭、Polk 交货、地缚高活跃。窗口外：相对可维修、可撤离、可签蠢合同。Cunningham 录像是说明书；Cricket 是收费且短命的翻译器。最稳策略是血月前撤，而不是血月中升级硬刚 Butcher。续集「三日地狱」故意卡在窗口内，是媒体谋杀。

**㉑ 媒体工业作为终局 Boss**
Sidney 的续集是捕兽夹不是艺术。Agnes 入戏证明表演可召唤真屠夫。终集综艺群把幸存者磨成内容。七阶胜利条件往往是让某人别上镜头或撕合同，不是击杀 Thomasin 本体。Lana Winters 的访谈是跨季舆论武器，话术级交锋优先于枪战。

**㉒ 额外可介入微观事件**
Mason 死亡夜保全完整监控链，防剪辑构陷 Lee。给 Flora 准备离开北卡的监护方案。向 Ambrose 亡灵提供阻母助力（条件性内部裂隙）。续集开机前暗塞撤离车钥匙。终集在 Lot 持械前清空演播室。对 Spirit Chasers：断直播信号有时比入屋救人更优先（残酷但符合类型）。保护 Priscilla—Flora 同盟不被节目组 consumable 化。

**㉓ 殖民暴力的正确写法**
Butcher 不是酷炫女战神，是殖民权力与献祭恐怖的结合体；Scáthach 是源，不是可攻略林中仙女。Polk 是服务屠戮体系的食人中间商。禁止把 Roanoke 失落史写成奇幻开挂，应写成循环债务与土地诅咒。Matt 被魅惑的戏码是殖民他者化情欲的恐怖版，不是浪漫奇遇。

**㉔ found footage 的镜头伦理**
摄影机在场会改变人的选择：为了「好镜头」拒绝撤离、为了「真实」拒绝剪掉死亡。契约者若持摄影设备，须决定是否录下献祭、是否上传、是否成为下一季素材。砸摄影机不能破血月规则，但能减少迷文化召来的二次死亡。
`;

inject(path.join(dir, '美国恐怖故事S3.md'), s3);
inject(path.join(dir, '美国恐怖故事S4.md'), s4);
inject(path.join(dir, '美国恐怖故事S5.md'), s5);
inject(path.join(dir, '美国恐怖故事S6.md'), s6);
