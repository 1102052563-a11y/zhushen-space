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
  const i = t.indexOf('## 阶位切入点');
  t = t.slice(0, i) + block + '\n\n' + t.slice(i);
  fs.writeFileSync(file, t, 'utf8');
  console.log(path.basename(file), measure(t));
}

const s5 = `
**㉝ 伯爵夫人宫廷礼仪与杀戮礼仪**
Countess 的晚宴有固定节奏：邀约、共饮、共寝、放血、弃尸或转化。拒绝共寝可能比拒绝杀戮更冒犯。Donovan 被弃后的嫉妒是宫廷政治。Tristan 的电梯遇 March 是另一套宫廷的入会。契约者混入名流局须准备假身份、可抛弃的同伴、对血酒说不的话术、撤退电梯权限。Ramona 的影星身份曾是入场券，也可是仇敌标签。

**㉞ 警探双面生活的场景标记**
John 在馆内越来越像住客而非查案者；对 Scarlett 的父职时断时续；与 Sally 的性与毒是解离出口；对 March 的理解是堕落刻度。正文写他时应让不对劲早于揭晓：对现场过度熟悉、对戒律主题敏感、对纠正不公的亢奋。契约者若在揭晓前击毙 John，可能留下未完成的戒律与 March 的新门徒招聘。

**㉟ 成瘾线的可玩与不可玩**
Addiction Demon 具象化毒瘾与性暴力，不是可收服宠物。Sally 的针是社交货币。Gabriel 的遭遇是开胃菜警告。契约者以毒控毒极易变新宿主。更稳的是断供、换房、把目标移出馆——仍可能失败，但符合类型。

**㊱ 产权、婚书与子弹的优先级**
在 Cortez，婚书过户有时比獠牙更快结束一条人命；子弹在十诫逻辑里是笔不是正义。契约者若只有武力解，会反复撞上规则杀。优先顺序建议：权限表、罪证备份、外部撤离、再谈交火。Countess 中弹永困证明「杀死身体」不等于「结束结构」。
`;

const s6 = `
**㉝ 重演演员群像的具名用法**
Audrey Tindall（重演 Shelby）虚荣与恐惧并存；Dominic Banks（重演 Matt）被婚外叙事拖入；Monet Tumusiime（重演 Lee）酒精与职业尊严撕扯；Dylan（重演 Ambrose）后期救援反成 Polk 刀下鬼；Rory（重演 Mott）首死示范。写续集夜必须点名，禁止「演员们」。他们的死是对扮演创伤工业的控诉。

**㉞ 警察与法庭在超自然前的失效**
报警后低效、监控被解读为构陷、血月后现场像综艺布景、Audrey 持枪被击毙——程序正义反复丢脸。契约者带入联邦特工万能会 OOC；可做的是保全证据链、减少误射、在访谈前给律师。Lee 无罪释放不代表安全，只代表下一季素材准备完成。

**㉟ 土地与图腾的符号学**
图腾是宣战与标记；火把是殖民军仪式；巨松是儿童与灵的信箱；地窖是前业主留言板；山丘是 Butcher 的检阅台。破坏单个图腾不能停血月，但可延迟某次围屋或换来撤离分钟。契约者研究符号应服务生存，而不是考古癖送死。

**㊱ 条件性胜利清单（给七阶）**
带出 Flora；撕毁至少一份续集或直播合同；让 Lana 访谈不成为单方面处刑；阻止 Spirit Chasers 入屋；保全一段未被剪的监控证明 Lee 非唯一暴力源；对 Scáthach 只换延期不换魂。以上任一完成可算条件性胜利；宣称屠灭 Butcher 本体则判定失败并回流更狠围屋。
`;

inject(path.join(dir, '美国恐怖故事S5.md'), s5);
inject(path.join(dir, '美国恐怖故事S6.md'), s6);
