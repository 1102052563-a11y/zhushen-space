const fs = require("fs");
const p = "产出/批次311/ef - a fairy tale of the two. (First & Latter).md";
let t = fs.readFileSync(p, "utf8");
// remove combat-ish wording
t = t.replace(/不写成战力/g, "不写成对决数值");
t = t.replace(/忌：清剿、阶位、把病与遗忘写成可刷副本/g, "忌：把病与遗忘写成可用打怪方式解决");
t = t.replace(/几乎没有战斗体系/g, "几乎没有超常对决设定");

const plotAdd = `
**动画两季与游戏章节的对照（情感向）**
《a tale of memories》将 first 的宫子章、景章与 latter 的千寻章交织改编，为迁就时间轴大幅压缩第二章并融入第一章；因播出时 latter 未发售，千寻的 13 小时记忆引起强烈回响。各话标题首字母连成 euphoric field，片尾随角色切换 I'm here／刻む季節／空の夢／悠久の翼，用歌声完成「谁在讲述」。《a tale of melodies》对应瑞希章与终章，标题字母游戏拼出 future／re- 结构，OP ebullient future，ED 笑顔のチカラ／願いのカケラ／ever forever。动画对终章有删改与原创，但核心仍是：倾听、遗忘、病、复仇、羽翼与不完美的答案。契约者若以「动画时序」入世，会先在学园三角与车站记忆之间被拉扯，再进入小提琴暑假与教会终章——顺序与游戏章节略有不同，情感节拍一致。

**角色情感对照补记**
宫子的「黑白世界」与千寻的「13 小时」是两种不同的时间残缺：前者是安全感崩塌，后者是存储上限；纮用陪伴上色，莲治用共写对抗遗忘。景的失恋与瑞希的被拒都是「喜欢却无法停留在对方生活中心」；京介用镜头、修一用推开，分别给出接受与拒绝的答案。优子与夕则把所有年轻人的故事收束成「两个人」的命题：讲述本身即是爱的形式。广野凪的裸体自画像、明良将优子视为亡妹替代、堇的料理教室微笑，都在提示——音羽的大人也带着未愈的缝。

`;

const entryAdd = `
6. **角色曲与观影会线**：在映研放映会上按动画 ED 逻辑为宫子／景／千寻／瑞希／优子各办一场「只放一首歌」的安静观影；用歌单推进好感，而不是用任务清单。  
7. **日记与截稿的双轨日历**：一边帮纮盯连载截止，一边帮千寻在 13 小时边界前写完当日摘要；两件事都教会契约者「时间对谁都不公平，但可以公平地在场」。

可攻略对象补充说明：若走京介线，重点在「让景重新喜欢被拍摄的自己」；若走修一线，重点在「尊重他的拒绝并仍把暑假过完」——成功不必等于恋爱 HE，也可以是「被认真对待过」的和解 HE。南半球音羽城开局时，可用「寄错的明信片／延迟的邮件」与本尊音羽角色保持轻联系，制造似曾相识的温柔，而不是穿越作战。

`;

// insert plotAdd before 人际关系
const k1 = "**【人际关系网 / 社团势力】**";
if (!t.includes(k1)) { console.log("no k1"); process.exit(1); }
t = t.replace(k1, plotAdd + k1);

// expand entry before 氛围／雷区 in 休闲切入点
const k2 = "氛围／雷区：保持文艺";
const i = t.lastIndexOf(k2);
if (i < 0) { console.log("no k2"); process.exit(1); }
t = t.slice(0, i) + entryAdd + "\n" + t.slice(i);

fs.writeFileSync(p, t, "utf8");
console.log("patched");
