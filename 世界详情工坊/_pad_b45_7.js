const fs = require('fs');
const path = require('path');

const file = path.join('产出', '批次45', '环太平洋2.md');
const extra = `
**【补充战役日志（2035）】**
圣莫尼卡夜：零件、追逐、逮捕。莫玉兰周：训练、嫉妒、无人机游说。悉尼日：峰会、黑曜石之怒、真子殉职、坐标。西伯利亚：雪战、开脑、地球产次级脑定性。全球夜：无人机叛乱、突破点、自毁、三兽已出。东京日：四机、合体、焊接、升空、再入、撞击、俘获、宣战。日志每一行都是可切入时点；AI选一行展开，不要同时打完所有行。

**【驾驶员口令示例】**
「漂移链接稳定。」「火控给你。」「左舷破损。」「蓝血接近喷口。」「焊接完成，点火。」「撤离到Scrapper。」「目标已停止运动。」口令短，呼吸声长。

**【黑市价目（一阶风味）】**
陀螺仪残件、冷却液、假工牌、巡逻时间表、Scrapper级小型液压。价格用食物与药品结算比用货币更像救济区。执法机甲一出现，价格归零，人命开始计价。
`;

let t = fs.readFileSync(file, 'utf8');
t = t.replace('\n## 阶位切入点\n', '\n' + extra + '\n\n## 阶位切入点\n');
fs.writeFileSync(file, t);
const plot = t.split('## 阶位切入点')[0].split('## 剧情')[1] || '';
const entry = (t.split('## 阶位切入点')[1] || '').split('## 来源')[0] || '';
const c = (s) => s.replace(/\s/g, '').length;
console.log('环太平洋2', '剧情', c(plot), '切入', c(entry));
