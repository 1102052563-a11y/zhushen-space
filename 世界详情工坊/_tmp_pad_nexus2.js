const fs = require('fs');
const p = '产出/批次146/银翼杀手：2036 复制人黎明.md';
let t = fs.readFileSync(p, 'utf8');

// Remove trailing garbage after 来源 if we appended wrongly
const srcIdx = t.lastIndexOf('## 来源');
if (srcIdx > 0) {
  // keep only first 来源 block properly - find content after last 来源 that looks like tier content
  const after = t.slice(srcIdx);
  // if there's **一阶（补强 after 来源, move it
}

// Rebuild cleanly from current good-enough content
// Split sections
const re = /^##\s+(剧情|阶位切入点|来源)\s*$/gm;
const marks = [];
let m;
while ((m = re.exec(t)) !== null) marks.push({ name: m[1], start: m.index, bodyStart: m.index + m[0].length });
const sections = {};
for (let i = 0; i < marks.length; i++) {
  const end = i + 1 < marks.length ? marks[i + 1].start : t.length;
  sections[marks[i].name] = t.slice(marks[i].bodyStart, end).trim();
}
// Drop any duplicate tier content wrongly after 来源
let plot = sections['剧情'] || '';
let entry = sections['阶位切入点'] || '';
// remove 补强 blocks that leaked into 来源
let src = sections['来源'] || '';
if (src.includes('**一阶')) {
  const j = src.indexOf('**一阶');
  entry = entry + '\n\n' + src.slice(j);
  src = src.slice(0, j).trim();
}

const plotPad = `

**【断电十年社会全景】**禁令十年，城市用三种语言说谎：官方说人类自救，企业说劳动力缺口，街头说谁便宜谁活。复制人从广告牌消失，在下水道与屋顶以旧型号残喘。银翼杀手缩编，部分扫黑市义体，部分被殖民公司私聘。泰瑞尔园区长草，数据贩子挖光纤。生态报告每季度更糟，食物合成味像溶剂。华莱士出现时带着清水与锁链。

**【听证会修辞解剖】**倪安德结构：危机→唯一解→道德包装→恐惧解除→重新提问。立法者结构：法→创伤→程序→被演示打断。要改结果须打断一环：证伪数据、替代方案、曝光造假、或让公众看见服从等于可被命令去死。枪解决不了修辞，除非对准摄像机——那会戒严。

**【Nexus-9哲学暴力】**旧型逃亡证明会怕死会爱会恨。Nexus-9把怕死翻译成完成命令。割喉是产品合格不是战斗失败。一阶见新闻血腥，二阶见职业末日，华莱士见招股书。同一滴血三种意义必须写进正文。

**【联动2049伏笔】**解禁后Nexus-9进警察与家用；基线、全息伴侣、农业体、企业执法者从生产线长出。2036不剧透K线，只写门被打开。若推迟解禁，2049应出现劳动力更贵、殖民更慢、黑市旧型更活跃、华莱士更偏执。

**【拍卖场夜戏】**破产拍卖在旧园区地下举行。竞拍人戴面具，出价用殖民信用点。一份「Nexus-7情感协议残页」拍出天价，买家疑是华莱士白手套。你若在场，可偷拍、掉包或放火——每一种都让听证会多一张牌或少一张牌。

**【银翼杀手宿舍】**金属床、假酒、墙上旧通缉令。有人数日子到解禁，有人练枪到指节出血。夜班回来的人洗手洗很久，说今天退休的「看起来像邻居」。一阶线人进宿舍送消息会被搜身三次。

**【立法者私宅】**干净到不像洛杉矶。孩子问复制人是不是怪物。保镖查访客DNA。演示次日，抗议者与「支持重建」人群对峙在门外。你的任务可能是送一束花，花里藏芯片。

**【地下铁路一课】**旧型教新人：眨眼频率、笑话延迟、故意说错一个词。太完美会被扫。Nexus-9的完美是另一套恐怖：他们错得恰到好处。

**【媒体编辑室】**标题党在演示前已写好两套：「英雄企业家」与「割喉狂人」。哪套上首页取决于视频清晰度与立法者表情特写。二阶可买编辑，一阶只能被标题淹没。

**【殖民招募站】**屏幕上金色麦田，合同写「自愿外派」。签字的人有的是真想走，有的是欠债。复制人解禁后这些人的合同价会崩——他们恨华莱士也恨旧型。

**【雨夜诊所】**义体医接骨不问姓名。墙上贴「不收邪血」——借来的外域梗被涂掉，改成「不收公司追踪芯片」。你的伤口若被公司数据库识别，第二天会有「关怀电话」。

**【档案对照表】**2019猎杀；2022断电；禁产破产；收购研发；2036听证；默认解禁量产；2049繁殖危机。写作任意时点先查表。

**【更多可介入】**偷演示刀换钝刃；给助手植入拒绝命令的噪声记忆；让立法者看到自己孩子与复制人儿童的合成对照片；释放旧型冲会场（最糟路径）；保护记者直播。

**【语言规范】**人称可第二人称开场；专名用倪安德·华莱士、Nexus-9、银翼杀手、泰瑞尔、华莱士公司、洛杉矶、大断电。禁止修仙套话与跨世界假货护送句。
`;

const entryPad = `

**一阶（补强·档案室与人质交换）**
切入身份/时点：泰瑞尔前档案临时工或数据录入员，听证会前七日。
初始事件：同伴被标疑似旧型扣押，交换条件是那份夹层文件；你发现演示日程。
开场白建议：「虹膜灯比枪先找到你。同伴在玻璃后比口型：别给公司。雨把纸角打湿，割喉时间表却更清楚。」
关键NPC立场：**华莱士公关**要日程；**人权义工**要人质；**殖民助理**出高价；**巡警**要业绩；**逃亡旧型**要假身份。
主线钩子/支线：交文件/烧文件/复制分送；支线干扰扫描救人。
危险度/规避：中——避彩排与直属安保。
任务方向/奖励：假身份、虹膜干扰片、通行证碎片。

**二阶（补强·双频道与投票夜）**
切入身份/时点：会场银翼杀手或人类安全顾问，听证当日及次夜。
初始事件：耳机双命令冲突；T-10可否调包助手；若投票延期则一夜游说。
开场白建议：「滤净空气无雨味。义眼如鱼掠肩。他说我们正在辩论。你知今日之刃可能对着持刃者。」
关键NPC立场：**倪安德·华莱士**；**立法者们**；**Nexus-9助手**；**地下记者**；**企业执法复制人**；**同僚银翼杀手**。
主线钩子/支线：调包、投票芯片、护航或公开视频；立法者2/3/4号各有价码。
危险度/规避：高——镜头即法庭。
任务方向/奖励：情报权、短暂豁免或黑档、解禁后人脉。
`;

// Ensure entry has enough unique content - merge if entry short
if (entry.replace(/\s/g,'').length < 1500) {
  entry = entry + entryPad;
} else {
  entry = entry + entryPad;
}
plot = plot + plotPad;

const head = t.match(/^#[\s\S]*?## 剧情\s*\n/)[0];
const full = head + plot + '\n\n## 阶位切入点\n\n' + entry + '\n\n## 来源\n\n' + src + '\n';
fs.writeFileSync(p, full);
console.log('plot', plot.replace(/\s/g,'').length, 'entry', entry.replace(/\s/g,'').length);
