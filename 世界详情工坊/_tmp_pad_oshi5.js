const fs = require('fs');
const p =
  'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出/批次322/推得过火 (OshiRabu: Waifus Over Husbandos).md';
let t = fs.readFileSync(p, 'utf8');
const pad = `

**终笔**
当あくる第一次在抽卡前先回恋的「到家了吗」，世界线就稳了。请让笑声、同意与推的立牌一起留在镜头里。合租的灯可以很暗，喜欢却要说清楚。命运不必靠概率，靠每天回来的那双鞋。
`;
if (!t.includes('**终笔**')) {
  t = t.replace('## 休闲切入点', pad + '\n## 休闲切入点');
  fs.writeFileSync(p, t);
}
const plot = t.split('## 休闲切入点')[0].split('## 剧情')[1] || '';
console.log(plot.replace(/\s/g, '').length);
