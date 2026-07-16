import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = path.join(ROOT, '产出', '批次203', '地狱潜兵2.md');
let t = fs.readFileSync(p, 'utf8');

t = t.replaceAll('严禁用「被封印所以不强」解释奇点与大舰队', '严禁用「任务限制战力/无故虚弱」解释奇点与大舰队');

const marker = '**【主要人物】**';
const mIdx = t.indexOf(marker);
if (mIdx < 0) throw new Error('no characters marker');

const extra = `
⑩ **战略配置与日常战争节律（贯穿全时期）**  
每一场任务的微观结构高度同构，却因敌人与地貌不同而呈截然不同的死亡方式：潜兵从超级驱逐舰选择负载——主武器如 AR-23 Liberator、喷射器、等离子或宪法步枪，副武器与投掷物，护甲轻重权衡，再点选至多四项战略配置。进攻许可含轨道精确打击、120/380mm HE 弹幕、轨道激光、轨道轨道炮、鹰式扫射/空袭/集束/凝固汽油/**500kg**；补给许可含 MG-43、EAT-17、无后坐力炮 GR-8、自动炮 AC-8、喷火、电弧、激光炮、标枪导弹等；防御许可含机枪/加特林/自动炮/火箭哨戒与地雷、盾墙。任务目标包括摧毁虫洞与制造厂、启动 ICBM、上传数据、紧急疏散平民、关闭非法广播、摧毁失控研究站、启动 SEAF 炮兵与防空等。提取阶段 **Pelican 1** 倒计时迫使小队在「再清一个次要目标」与「保命撤离」之间赌博。友谊炮火把合作变成沟通测试：错误的信标落点、反冲火箭的背后、轨道弹幕的随机散布，都会把队友送进统计面板。舰上生活则是另一层战争：民主官训话、技师抱怨模块、广播循环国歌与 Strohmann 新闻、自由之日烟花与强制敬礼——宣传机器从不因前线溃败而停转。

⑪ **关键战役的因果链补强**  
**Operation Valiant Enclosure** 的成功使 TCS 得以激活，却把「用化学网圈养生态武器」写成国策；检疫区收割把 E-710 需求暴露为联邦战争发动机。**Swift Disassembly** 的「全歼」制造政治幻觉，直接导致对 Reclamation 主舰队准备不足。Menkent 线的速建速崩证明：没有持续人力与燃料，任何「固定防线」都是宣传海报。**Meridia 超级殖民地** 把科学部的傲慢推到顶点——Termicide 的亚致死剂量成为进化催化剂；**Enduring Peace** 用暗物质「解决」超级殖民地，却把奇点钥匙塞进光能百年复仇剧本。Gloom 不是单纯天气，而是孢子生态战争；DSS 的启用是联邦第一次尝试用「移动超级武器平台」对冲多线崩溃。光能回归后，Voteless 把「公民」变成武器，比虫酸更刺穿 Managed Democracy 的自我神话；超级地球巷战则把战争从边疆殖民星打回意识形态心脏。Creek 纪念日常提醒：胜利可以立法为节日，尸体仍堆在丛林里。

⑫ **三族战术差异与叙事用途**  
打虫是「人群控制 + 炸洞」：关闭 Bug Hole、清 Spore Spewer、防冲锋，酸液与潜行 Stalker 惩罚落单。打机器人是「硬瞄准 + 拆设施」：优先炮塔、干扰器、制造厂，枪线压制与火箭齐射要求掩体纪律。打光能是「高机动 + 优先点杀 Watcher/干扰建筑」：Voteless 人潮可绕行，Overseer 与护盾单位惩罚单发重击，城市殖民地近战逼迫换装。三线并行时，Major Order 迫使玩家社区选择「救哪条星图」——这是 HD2 独特的集体叙事：没有单一救世主，只有百万次空降的统计民主。

⑬ **文化节日与意识形态装置**  
**Liberty Day（10 月 26 日）** 是全联邦最重要节日，现实中亦对应工作室传统；游戏内可出现强制敬礼、限定战略配置（如 One True Flag）、宪法步枪击杀配额、超级地球烟花。**Malevelon Creek Memorial Day** 把惨烈战役圣化。C-01 生育许可、公民等级、异议拘禁中心、非法广播清除任务，共同构成「自由」的反面教材。契约者若只写热血不写讽刺，会丢失作品灵魂；若只写讽刺而取消潜兵的英勇与牺牲，则丢失玩家共情。正确基调是：**认真地荒诞，荒诞地认真**。

⑭ **名场面与可观察细节（供正文调用）**  
新兵第一次呼叫 Reinforce 时，教程假人的「兄弟情」在三十秒内被制度替换；Creek 解放后纪念斗篷与阵亡墙同时上线；机器人「全歼」海报墨迹未干，Valdis 扇区已整片变红；Meridia 坍缩时超级驱逐舰紧急 FTL 跃迁回超级地球，潜兵被奖励「多睡三十秒」式黑色幽默嘉奖；光能入侵超级地球时，Eagleopolis 等巨型城市的霓虹与轨道灼痕叠在同一夜空；自由之日烟花下，舰桥仍滚动下一条 Major Order。这些细节比空泛「战争很残酷」更有用：AI 写正文时应落到旗帜、信标球、冷却音效、提取倒计时与宣传字幕。

`;

t = t.slice(0, mIdx) + extra + '\n' + t.slice(mIdx);
fs.writeFileSync(p, t, 'utf8');

const plot = t.split('## 剧情')[1].split('## 阶位切入点')[0];
const entry = t.split('## 阶位切入点')[1].split('## 来源')[0];
const cc = (s) => s.replace(/\s/g, '').length;
console.log('plot', cc(plot), 'entry', cc(entry));
console.log('seal-word', /被封印|被削弱|战力限制|任务公证限制/.test(t));
