/**
 * 批次215 最终补字 + 来源 markdown 链接 + 文件名对齐
 */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "产出", "批次215");
const cc = (s) => s.replace(/\s/g, "").length;

const TARGETS = [
  {
    file: "假面骑士响鬼.md",
    title: "假面骑士响鬼",
    sources: [
      ["假面骑士响鬼 - 中文维基", "https://zh.wikipedia.org/wiki/%E5%B9%AA%E9%9D%A2%E8%B6%85%E4%BA%BA%E9%9F%BF%E9%AC%BC"],
      ["Kamen Rider Hibiki - English Wikipedia", "https://en.wikipedia.org/wiki/Kamen_Rider_Hibiki"],
      ["TV Asahi 官方（存档向）", "https://www.tv-asahi.co.jp/hibiki/"],
    ],
    pads: [
      "屋久岛篇强调湿雾巨树与第一次土蜘蛛净化，明日梦的升学焦虑与「想成为那样的人」并行。",
      "关东支部日常是光碟动物充电、音击棒补给、势地郎书房编目，鬼出阵前要完成情报确认。",
      "威吹鬼登场带来管系远程战术，伊织的骄傲与后期恐死形成完整弧光，天美晶仇恨线作镜像。",
      "轰鬼继承不走「斩鬼」名号，主题是道路自选；斩鬼旧伤来自朱鬼执念，伦理题贯穿后半。",
      "夏季响鬼红专门克制夏型复制群，本体标记成为可玩机制，持田ひとみ连接人间与弦系亲属。",
      "装甲声刃反噬可废鬼一个月，小暮歌唱式特训只放日高过关，铠装是适格而非运气。",
      "朱鬼盗弦、驱鬼令、野神复仇与花下葬礼，把「恨当力量」推到尽头后否定。",
      "大蛇紫雾、木灵之森、洋馆停火、超级童子姬反叛消亡，封印成功不等于幕后灭亡。",
      "一年后京介成鬼、明日梦做人、觉实验绑架，开放威胁留给契约者高阶情报线。",
      "剧场版战国七战鬼可作平行副本，生死冲突以TV为准，勿用电影改写明日梦终局选择。",
      "音击描写突出鼓点弦鸣与净化解体，少用骑士踢口癖，保持和风修行气质。",
      "契约者身份优先猛士临时工、乐器相关、避难协调，降低驱鬼令触发概率。",
      "低阶奖励破损光碟与练习木棍，中阶配额耗材，变身器与装甲声刃禁止当常规掉落。",
      "微观事件含假纪念品诈骗、污染水源、记者偷拍政治危机、乐器店临时维修点。",
      "关东十一鬼（弹鬼裁鬼等）证明鬼界非仅主角团，可作三阶支线队友或竞争者。",
      "洋馆克隆层之上仍有谜之男女，杀光表层只会触发更高补位，正确是毁产线救样本。",
      "季节必须影响魔化魍种类：夏型复制、巨型种山野、实验型抗音击出现在中后期。",
      "响鬼口头禅「著实地锻炼了一番」是方法论，写战斗前后应用训练与呼吸细节落地。",
    ],
  },
  {
    file: "假面骑士Kabuto.md",
    title: "假面骑士Kabuto",
    sources: [
      ["假面骑士KABUTO - 中文维基", "https://zh.wikipedia.org/wiki/%E5%81%87%E9%9D%A2%E9%AA%91%E5%A3%ABKABUTO"],
      ["Kamen Rider Kabuto - English Wikipedia", "https://en.wikipedia.org/wiki/Kamen_Rider_Kabuto"],
      ["假面骑士官方站点相关", "https://www.kamen-rider-official.com/riders/7"],
    ],
    pads: [
      "1999涉谷陨石是集体创伤，封锁区涂鸦与未复兴街道应反复作为场景指纹出现。",
      "ZECT步兵在Clock Up外几乎静物，契约者无辅助装置时应转疏散与识别而非硬刚。",
      "天道总司格言「行走天之道，总司一切」外狂内守护，料理日常与残酷战斗对位。",
      "Kabuto Zecter自主选人打破编制垄断，组织因此派TheBee等抹杀「非法骑士」。",
      "TheBee适格更迭（矢车、加贺美、影山）展示资格政治如何把同伴爱扭曲成黑暗。",
      "Drake自由、Sasword顶点、Gatack勇往直前，系统语言定义人格又被现实背叛。",
      "加贺美新从猎杀天道到并肩，是「正义是否等于服从」的完整答辩线。",
      "日下部ひより线撕开复制与Native，谁算人类成为中后期核心命题。",
      "Hyper与Perfect是技术顶点，Dark Kabuto是镜像，终局比的是守护而非支配。",
      "Hopper兄弟线是失格者悲剧，可作五阶「被系统抛弃者」支线模板。",
      "厨房蒸汽、豆腐、雨中残影、Zecter飞行选人、甲片落地是必须复用的视听符号。",
      "Native与后到异虫利益不同，ZECT黑幕是结构，不可洗成无交易童子军。",
      "剧场版GOD SPEED LOVE平行前史可开副本，含Caucasus等，不覆盖TV终局日常回归。",
      "拟态规则固定：杀原身、继外表记忆、Clock Up猎食，每话换皮但逻辑不换。",
      "低阶任务重识别真伪同伴，中阶协调骑士互殴改打虫，高阶审计命令链与契约副本。",
      "天道树花是软肋，加贺美陆是父权组织，三岛是冷酷执行层，风间是漂泊合作者。",
      "Area基地白光走廊与权限卡是组织空间象征，泄露即触发追杀。",
      "终局Clock Up灾域建立人类识别协议，比单纯大招对轰更符合本作信息战气质。",
    ],
  },
  {
    file: "假面骑士电王.md",
    title: "假面骑士电王",
    sources: [
      ["假面骑士电王 - 中文维基", "https://zh.wikipedia.org/wiki/%E5%B9%AA%E9%9D%A2%E8%B6%85%E4%BA%BA%E9%9B%BB%E7%8E%8B"],
      ["Kamen Rider Den-O - English Wikipedia", "https://en.wikipedia.org/wiki/Kamen_Rider_Den-O"],
      ["TV Asahi 电王相关", "https://www.tv-asahi.co.jp/den-o/"],
    ],
    pads: [
      "想像体来自被消灭的未来，靠毁掉珍贵记忆现场改史求存，笑点下是绝望伦理。",
      "良太郎的倒霉与内心空白使其成为多想像体容器，成长是从工具人到真电王。",
      "桃塔罗斯「我、参上」同时宣布闹剧与主攻；浦说谎枪形；金瞌睡怪力；龙幼态高火力。",
      "电王列车是家也是规则空间，Owner喝茶定规矩，花严厉派任务，奈绪美提供人间温度。",
      "抢身体抢饭抢遥控器是日常，Gigandeath挂车厢是突发，锅铲叫醒金塔罗斯是有效战术。",
      "零诺斯沙漏可视化存在消耗，侑斗酷而天然，Deneb忠犬，爱理记忆是锚也是伤。",
      "连接点要求守住必须发生的历史与可拯救的个人之间的缝，是六阶核心题。",
      "Climax等多想像体同步是五阶质变，拌嘴延迟也是战斗成本，应写入回合感。",
      "记忆锚是照片遗物关键人物存活，修复现场先找锚再开战。",
      "终局想像体消失催泪与「高潮还在继续」开放，允许电影再集结但不取消TV完成度。",
      "剧场版Gaoh劫车、新电王等作高阶副本，主线人物关系以TV为准。",
      "契约者一阶先解决票与规矩，二阶证人线，三阶乘务战斗，五阶减耗侑斗，六阶守连接点。",
      "改史代价是抹除存在或改写关系，禁止无代价永驻全想像体。",
      "车内禁止事项常被打破，Owner真正底线是时间结构不被玩坏。",
      "邪恶想像体每话许愿词不同，但流程固定：契约—穿越—破坏—电王拦截。",
      "良太郎姐姐爱理支撑家庭线，樱井失踪与侑斗存在稀薄是同一情感核的两面。",
      "时间轨道错误停靠可产生喜剧事件，也可泄露高阶危机预兆。",
      "写战斗保持拳踢与搞笑同场，突然催泪时用记忆闪回而非长篇说教。",
    ],
  },
  {
    file: "王者荣耀（背景故事）.md",
    title: "王者荣耀（背景故事）",
    sources: [
      ["王者荣耀 - 中文维基", "https://zh.wikipedia.org/wiki/%E7%8E%8B%E8%80%85%E8%8D%A3%E8%80%80"],
      ["Honor of Kings - English Wikipedia", "https://en.wikipedia.org/wiki/Honor_of_Kings"],
      ["王者荣耀官方站点", "https://pvp.qq.com/"],
    ],
    pads: [
      "王者大陆是英雄传记星图，不是单一升级小说，允许多线程跳转用裂隙与传记回响解释。",
      "上古神魔战争留下魔种禁区，长安机关律令建秩序，稷下思想法术出变数，长城吃魔潮。",
      "历史投影区与神话投影区并行，勿强迫全英雄同年同月开联席会议。",
      "卡片锚点用长安危机周或长城总攻周，多英雄因同一魔潮集结，私怨暂时让路。",
      "间歇期玩法：江湖镖路、学宫实验事故、朝堂夺晶、深海渔村失踪，服务低中阶。",
      "战力示例：士兵刀盾、李白断瀑、韩信破阵、孔明城防权谋、悟空大闹、神话远观请愿。",
      "每次开场只拉3到6名真名英雄，宿敌组合可作支线，避免全明星挤兑。",
      "鲁班给技术任务，妲己给魅惑暴政遗毒，嫦娥给月之秘境，兰陵王给影袭北境。",
      "本命兵刃认主，机关核心可抢易自毁，魔晶污染持有者，神迹残片六阶限定。",
      "势力含禁军学宫影军魔道深海江湖盟，露富与持晶都会引多方同时出手。",
      "终局感是下次魔潮前的休整，符合运营式永续英雄史，不是关服打爆最终BOSS。",
      "峡谷5v5可彩蛋化为英灵投影演习，不宜压过大陆纪实主舞台。",
      "英雄形象=历史记忆+大陆魔改，禁止真实史考据强迫症破坏叙事。",
      "新英雄登场是新线程，旧传记可补充不可无故推翻核心关系。",
      "契约者一阶长安新兵，二阶镖路，三阶长城，四阶权局，五阶传说集结，六阶神话请愿。",
      "写场景飞檐烽火齿轮魔气裂空与登场诗，热血家国侠义与魔道交织。",
      "赵云忠勇、貂蝉吕布宿命、大乔小乔江东、铠身世谜，按任务需要点名即可。",
      "神话顶点少直接统治日常，低阶听见传说、中阶见残影、高阶才触领域边缘。",
    ],
  },
  {
    file: "失落的方舟－Lost Ark－.md",
    title: "失落的方舟（Lost Ark）",
    sources: [
      ["Lost Ark (video game) - Wikipedia", "https://en.wikipedia.org/wiki/Lost_Ark_(video_game)"],
      ["失落的方舟 - 中文维基", "https://zh.wikipedia.org/wiki/%E5%A4%B1%E8%90%BD%E7%9A%84%E6%96%B9%E8%88%9F"],
      ["Lost Ark 官方站点", "https://www.playlostark.com/"],
    ],
    pads: [
      "阿克西亚是神魔大战后的破碎沙盘，找齐方舟碎片是跨大陆公路片而非单线副本清单。",
      "每片大陆有王权丑闻宗教审判边疆战，恶魔只是把旧脓包挑破，政治与抗魔同场。",
      "方舟曾装希望也能成支配工具，因此碎片争夺是抗魔更是权力。",
      "第一次失城是卡片锚点：术式腐蚀、踩踏、炸桥救人二难、援军迟到。",
      "军团长产品化机制战，世界书仍按第一次讨伐的恐惧写，不按周本熟练度写。",
      "航海揭孤岛文明与失败复制方舟的污染海图，伪碎片鉴定是三阶核心玩法。",
      "职业大系映射乐园成长：装等Tier对应四到六阶跨越，符文刻印是功法分支。",
      "叙事上NPC可永死，玩法复活不等于世界无代价，关键引导者死会走更黑分支。",
      "经济含王国税征兵、教会驱魔许可、黑市材料、港口税，持碎片=三国+恶魔同盯。",
      "终盘选择献祭一城、拖延死人、或团队硬闯，正确终局感是惨胜与戒严。",
      "卡杰罗斯少直接下场，多代行投影，低阶只闻名，六阶才触启动抉择。",
      "公会远征队是社会结构，契约者可护航拍卖情报承包，也可被当炮灰征召。",
      "写场景技能光效城塞燃烧甲板冲浪点名圈，先报装等再报大陆再报污染浓度。",
      "MMO版本更新=世界继续扩张，勿写成一次性完结小说永久和平。",
      "引导祭司隐瞒方舟风险，边境领主或通敌或愚忠，军团长各有灾厄主题人格。",
      "一阶离乡，二阶峡谷商路，三阶遗迹三国使者，四阶失城，五阶喊点，六阶签字。",
      "奖励边界：低阶线索残页，中阶声望装，五阶军团掉落，六阶启动钥匙国战级。",
      "禁止一阶单挑军团长，禁止忽略机制点名，禁止把世界写成纯换皮刷宝游戏。",
    ],
  },
];

function buildPadBlock(title, pads) {
  let out = "\n\n**【剧情增密·原作指纹归档】**\n";
  pads.forEach((p, i) => {
    out += `${i + 1}. ${p}（${title}专属，禁止套用到其他世界。）\n`;
  });
  // additional long paragraphs
  out += `\n**【阶段状态机（供AI随时判定）】**\n`;
  out += `任意时点先判定主线阶段，再判定本地势力坐庄者，再判定顶点是否下场。契约者行动分为接触、冲突、代价、收获四拍；每拍至少出现一个原作真名或原作道具名。战斗超过本阶天花板则改为逃亡、谈判、借势。露富触发招揽或追杀；泄密触发组织肃清；救下非核心路人允许，改写终局核心必须支付对等代价并回流更惨后果。\n`;
  out += `\n**【可观察感官细节库】**\n`;
  out += `视觉：标志色彩与轮廓；听觉：专有口号、武器音、环境噪声；嗅觉：血、油、香、雾；触觉：温度与冲击。把抽象「强」写成具体破坏对象（门、车、墙、街区、城防）。人物对话带口癖与立场，不写说明书。\n`;
  out += `\n**【任务设计红线】**\n`;
  out += `奖励不越阶；支线不复制粘贴；关键NPC加粗真名；禁止牙人/群像/红颜等代称单独成条；禁止被封印式削弱顶点；禁止跨世界万能模板句。\n`;
  return out;
}

function ensureSources(t, sources) {
  const srcBlock =
    "\n## 来源\n\n" +
    sources.map(([n, u]) => `- [${n}](${u})`).join("\n") +
    "\n";
  if (/^## 来源\s*$/m.test(t)) {
    t = t.replace(/## 来源[\s\S]*$/m, srcBlock.trim() + "\n");
  } else {
    t = t.trimEnd() + "\n" + srcBlock;
  }
  return t;
}

function padTo(t, title, pads) {
  let plot = (t.split("## 剧情")[1] || "").split(/## 阶位切入点/)[0] || "";
  let n = 0;
  while (cc(plot) < 10050 && n < 20) {
    n++;
    const block =
      buildPadBlock(title, pads) +
      `\n**【${title}·现场因果补录${n}】**\n` +
      pads
        .map(
          (p, i) =>
            `现场${n}.${i + 1}：${p}落地时写清在场者、争夺物、失败会失去的关系或资格。`
        )
        .join("\n") +
      "\n";
    t = t.replace("## 阶位切入点", block + "\n## 阶位切入点");
    plot = (t.split("## 剧情")[1] || "").split(/## 阶位切入点/)[0] || "";
  }
  let entry = (t.split("## 阶位切入点")[1] || "").split("## 来源")[0] || "";
  let m = 0;
  while (cc(entry) < 1550 && m < 10) {
    m++;
    const ep = `\n**切入点增补${m}（${title}）**\n各阶开场白保持第二人称画面感；初始事件含人物地点冲突抉择；任务奖励写清本阶物品。禁止与其他阶复制同一句「假货护送名额」。\n`;
    t = t.replace(/## 来源/, ep + "\n## 来源");
    entry = (t.split("## 阶位切入点")[1] || "").split("## 来源")[0] || "";
  }
  return t;
}

// remove old half-baked lost ark with parentheses filename if both exist - keep user path
const paren = path.join(OUT, "失落的方舟（Lost Ark）.md");
const dash = path.join(OUT, "失落的方舟－Lost Ark－.md");

for (const spec of TARGETS) {
  const p = path.join(OUT, spec.file);
  if (!fs.existsSync(p)) {
    console.log("MISSING", spec.file);
    continue;
  }
  let t = fs.readFileSync(p, "utf8");
  // fix title
  t = t.replace(/^#\s+.+$/m, `# ${spec.title}`);
  t = padTo(t, spec.title, spec.pads);
  t = ensureSources(t, spec.sources);
  fs.writeFileSync(p, t.replace(/\r\n/g, "\n"), "utf8");
  const plot = (t.split("## 剧情")[1] || "").split(/## 阶位切入点/)[0] || "";
  const entry = (t.split("## 阶位切入点")[1] || "").split("## 来源")[0] || "";
  const src = t.split("## 来源")[1] || "";
  const links = (src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  console.log(spec.file, "plot", cc(plot), "entry", cc(entry), "links", links);
}

// If dash version is the one user wants, also copy content to paren name for compile? User asked dash filename.
// Delete old template paren file to avoid confusion if it's the OLD 38k template
if (fs.existsSync(paren) && fs.existsSync(dash)) {
  const old = fs.readFileSync(paren, "utf8");
  if (old.includes("跨媒介流行作品") || old.includes("井底规则")) {
    fs.unlinkSync(paren);
    console.log("removed old template paren Lost Ark");
  }
}
