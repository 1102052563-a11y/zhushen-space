const fs = require('fs');
const p =
  'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次322/推得过火 (OshiRabu: Waifus Over Husbandos).md';
let t = fs.readFileSync(p, 'utf8');
const pad = `

**名场面因果链**
ガチャ黑脸→恋代抽成功→欠人情式同居理由→同床→习惯体温→会社目击→无法再假称陌生人→吃醋→承认→用语更换。续作：清单目击→妒嫉答应→新娘模式→步速冲突→对话→誓词。每一步都有前因，禁止无铺垫的告白暴击。语音剧与婚戒DLC是糖罐，可在HE后按周取用，不提前剧透婚后全部日常。

**世界温度总结**
这里的危险是心跳与社死，不是刀剑。胜利条件是两人还能并排坐在沙发上刷同一游戏，一边吵一边笑。把这个画面写稳，档案就完成了它的职责：让契约者知道，推得过火，是因为爱意真的装不下屏幕。
`;
if (!t.includes('名场面因果链')) {
  t = t.replace('## 休闲切入点', pad + '\n## 休闲切入点');
  fs.writeFileSync(p, t);
}
const plot = t.split('## 休闲切入点')[0].split('## 剧情')[1] || '';
console.log(plot.replace(/\s/g, '').length);
