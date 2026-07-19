const fs = require('fs');
const p = '产出/批次99/美国恐怖故事S2.md';
let t = fs.readFileSync(p, 'utf8');
const more = `

**⑮ 空间动线（AI 写追逐/潜入用）**  
主入口→接待→更衣剥权→男女分廊病房→公用水槽与食堂→礼拜堂（假安全区）→Jude 办公室（权力核）→约束室与独囚（Leigh）→楼梯下 Arden 实验层→Death Chute 出口接树林→围墙外公路（现代蜜月客停车点）。逃亡最优解非常人想象的「翻墙」，而是「合法文件+外部证人+教区眼线」三件套；纯体力翻墙在暴风雪与 Raspers 夜=送死。Thredson 宅位于「正常郊区」，其恐怖在于回家路上的心理卸防：Lana 以为自由，实则进入真血脸的巢。现代废院动线与1964镜像：同一走廊，跨代的血脸脚步声。

**⑯ 主题句（防 OOC）**  
本季恐惧核心不是「有鬼」，而是「诊断权」。谁能把你写成疯子，谁就能合法剥夺你的性、生育、行动与姓名。恶魔与外星是加压层，不是替罪羊——没有它们，Jude 的戒尺与 Thredson 的白大褂依然杀人。契约者若以「超凡碾压院方」开局，会破坏类型真实；正确打开方式是：先活在编号下，再偷权杖。

**⑰ 与系列宇宙的接口**  
Pepper 后续出现在 Freak Show；Sister Mary Eunice 在 Freak Show 闪回接管 Pepper 叙事；Lana Winters 在 Roanoke 以名记身份再登场采访。本世界档案写 S2 时保持这些接口为「已发生/将发生」的单向阀，不在此季提前剧透其他季终局细节，只保留人名锚点供跨季任务识别。

**⑱ 对话与道具密度示例（供正文模仿）**  
「把她的打字机收了。」比「禁止言论」更院内。  
「结核区今天消毒。」= Arden 要清场。  
「Monsignor 今晚来行终傅。」= 有人将被灭口。  
「磁带在钢琴凳下。」= Lana 线命门。  
道具：锈轮椅、彩色药片、乳胶手套、拉丁弥撒书、人皮缝线、外星光下的妊娠纹、废院涂鸦「Bloody Face was here」。
`;
t = t.replace('**【叙事基调 · 雷区】**', more + '\n**【叙事基调 · 雷区】**');
fs.writeFileSync(p, t);
const strip = s => s.replace(/\s/g, '').length;
const plot = t.match(/## 剧情([\s\S]*?)## 阶位切入点/)[1];
const ent = t.match(/## 阶位切入点([\s\S]*?)## 来源/)[1];
console.log('plot', strip(plot), 'entry', strip(ent));
