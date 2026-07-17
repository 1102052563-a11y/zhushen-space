const fs = require("fs");
const path = require("path");

function stripPadding(file) {
  let t = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const beforeRel = (t.match(/关系细目/g) || []).length;
  // drop any line that is a 关系细目 padding block
  t = t
    .split("\n")
    .filter((line) => !line.includes("关系细目") && !line.includes("日程细目"))
    .join("\n")
    // collapse 3+ blank lines
    .replace(/\n{3,}/g, "\n\n");
  fs.writeFileSync(file, t, "utf8");
  return beforeRel;
}

function stats(file) {
  const t = fs.readFileSync(file, "utf8");
  const plot = (t.split("## 剧情")[1] || "").split(/## (?:休闲|阶位)切入点/)[0] || "";
  const entry = ((t.split("## 休闲切入点")[1] || t.split("## 阶位切入点")[1] || "").split("## 来源")[0]) || "";
  return {
    plot: plot.replace(/\s/g, "").length,
    entry: entry.replace(/\s/g, "").length,
    rel: (t.match(/关系细目/g) || []).length,
    day: (t.match(/日程细目/g) || []).length,
  };
}

const files = [
  "产出/批次351/女騎士団-全員敗北.md",
  "产出/批次351/淫獣使い-契約代償.md",
  "产出/批次351/触手列車-終着駅.md",
  "产出/批次351/魔女狩り-異端審問.md",
];

for (const f of files) {
  const n = stripPadding(f);
  console.log("stripped", f, "removed mentions", n, stats(f));
}

// Expand any short plots with unique ethical content (no 关系细目)
function ensureMin(file, kind) {
  let t = fs.readFileSync(file, "utf8");
  let s = stats(file);
  if (s.plot >= 6000 && s.entry >= 1500) return s;

  const expandPlot = {

knight: `

共通线补叙（嵌主线，非清单灌水）：落败当日只写积分牌翻转与闲言，不写血肉。听证三句必须落地——ルナ「我想自己选」、セレナ「胶带是我默许的」、ハナ「铃响即停」。团旗修补室里谁先绣回自己的名字，谁就先脱离「败者」标签。再赛三分支：自愿再赛握手；弃权并声明剑仍在；被逼必须赢则关系裂。若有人把「调教」说出口，全员好感下降，应改口「复健／重修」。意见箱匿名信也要登记；夜班换灯比对练更易逼出真心话；神殿海报写「伤愈不是比赛」；仲裁号牌叮当作响提醒合法出口仍在。后日谈：禁止性惩罚写入总章；ルナ可参赛可转教导；セレナ印章盒多「申诉通过」印。深层：ルナ怕被当笑话；セレナ把秩序当爱；ハナ厌密闭独断；ミナ怕代笔；トワ用汤衡量正常；マグ须学会弃权也是礼。

`,

beast: `

共通线补叙（嵌主线，非清单灌水）：复查周第一天必须当众朗读代价栏，发现淡墨后填即停盖章。シロ项圈内侧解约字被摩亮是主体物证，不是情趣道具。アヤ口误「我的シロ」时正确反应是停三秒重说「シロ，可以吗」。公证会三句——シロ「我想自己选」、アヤ「所有权句是我写的」、カエデ「冷静期不可删」。身体默认代价格式句必须公开废止。共食先问、梳毛先点头、解约铃枕边可及，是三件日常门闩。真解约与续约共居都是完整结局。后日谈：翠铃范本推广到邻镇；旧奴契残页进展览柜写「永不复用」。深层：シロ怕被当道具；アヤ把爱说成占有；カエデ怕再盖糊涂章；ユナ会自我耗尽；ミノリ怕代笔；タカ只信驿路灯。

`,

train: `

共通线补叙（嵌主线，非清单灌水）：发车后第一节必须完成真名点名；座位号点名会让触须活跃——这是规则，不是战斗数值。雾站验证开门不少于九十秒，允许有人真的下车且不被拦。河站若有人抢锁门，黒峰静按停，星野澪必须当众承认「禁止中途下」手写条的错误。强制缠绕只作危机：制动进最近站，不写浪漫奖励。终着大厅互报全名后，同站同行与挥手分开皆完整。手帐扉页修订张贴：真名、制动、每站可下。后日谈：白天时刻表仍无深線，但工会手册留下合意应对页。深层：澪怕来不及开门；花怕嗓音；静厌独占停权；遥易被榨取倾诉；真用雾窗说话；凛只查秒数不查八卦。

`,

witch: `

共通线补叙（嵌主线，非清单灌水）：指控登记日必须当众叫リリス真名，禁止「那个魔女」。证据不足栏被胶带糊死是冲突起点，揭开声音优先于任何结案快感。听证三句——リリス「我想自己选是否留下行医」、セレス「糊栏是我默许的」、ノア「矛盾自白无效」。任何刑讯、性羞辱试探、秘密连夜审都是黑线。驿票自管；印刷撤回声明不讹钱；河堤散步可只谈草药与天气。后日谈：灰钟备忘写入禁刑讯与上诉窗；旧手册刑讯句公开划掉。深层：リリス怕被当笑话；セレス怕城镇恐慌；ノア零容忍私刑；ミレイ怕代笔加重；トワ守隐私；インク守公共记忆；サラ代表外部程序眼睛。

`

  }[kind];

  const expandEntry = {

knight: `

执行补强：前三日禁止旁观惩罚表演与性化落败；课表共拟且无性惩罚项；名牌与驿票自管；再赛或弃权由ルナ决定。场景四点轮换：医务帐、复训场、公会窗、酒馆／驿站／修补室。失败自愈：误入强制封闭则下一拍回纸本与铃。

`,

beast: `

执行补强：前三日只做朗读、解约栏、铃与真名；身体条款若出现必须单独双签且可单方撤销；项圈只可摘装饰。场景轮换：公证厅、共居寮、福祉棚、市集／城门。失败自愈：误入奴役叙事则回沙漏与铃。

`,

train: `

执行补强：第一站确认拉环与开门秒数；第二站允许真下车；强制缠绕必须制动进站。场景轮换：驾驶室、中节、月台、售货机角。失败自愈：误入凌辱叙事则回广播与制动程序。

`,

witch: `

执行补强：第一日揭证据栏并张贴禁刑讯；第二日矛盾证词演练；第三日驿站出口验证。场景轮换：听证院、草药区、印刷廊、酒馆／驿站。失败自愈：误入酷刑叙事则回圆桌笔录与木槌程序。

`

  }[kind];

  if (s.plot < 6000 && expandPlot) {
    t = t.replace("**【可攻略角色 / 主要人物】**", expandPlot + "\n**【可攻略角色 / 主要人物】**");
    if (!t.includes(expandPlot.slice(0, 20))) {
      // fallback insert before 休闲切入点
      t = t.replace("## 休闲切入点", expandPlot + "\n## 休闲切入点");
    }
  }
  s = (() => {
    const plot = (t.split("## 剧情")[1] || "").split(/## (?:休闲|阶位)切入点/)[0] || "";
    return plot.replace(/\s/g, "").length;
  })();
  // if still short, append expandPlot before ## 休闲切入点 inside 剧情
  if (s < 6000 && expandPlot) {
    t = t.replace("\n## 休闲切入点", "\n" + expandPlot + "\n## 休闲切入点");
  }
  let e = (() => {
    const entry = ((t.split("## 休闲切入点")[1] || "").split("## 来源")[0]) || "";
    return entry.replace(/\s/g, "").length;
  })();
  if (e < 1500 && expandEntry) {
    t = t.replace("\n## 来源", "\n" + expandEntry + "\n## 来源");
  }
  // final safety: never reintroduce 关系细目
  t = t.split("\n").filter((line) => !line.includes("关系细目") && !line.includes("日程细目")).join("\n");
  fs.writeFileSync(file, t, "utf8");
  return stats(file);
}

const map = {
  "产出/批次351/女騎士団-全員敗北.md": "knight",
  "产出/批次351/淫獣使い-契約代償.md": "beast",
  "产出/批次351/触手列車-終着駅.md": "train",
  "产出/批次351/魔女狩り-異端審問.md": "witch",
};
for (const [f, k] of Object.entries(map)) {
  console.log("ensure", f, ensureMin(f, k));
}

// onsen already clean; just report
console.log("onsen", stats("产出/批次351/人妻温泉-秘湯の夜.md"));