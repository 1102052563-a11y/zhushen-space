const fs = require('fs');
let t = fs.readFileSync('产出/批次05/一念永恒.md', 'utf8');
const plotBody = t.split('## 剧情')[1].split('## 阶位切入点')[0];
console.log('plot body', plotBody.replace(/\s/g,'').length);
const more = `
**【资源单位换算（叙事用）】**
练气期硬通货是灵石与药渣；筑基期是法器残件与试炼积分；落陈夜是令牌与命；结丹后是悬赏与人情债；元婴期是神识与夺舍防具；灵海问鼎是城池与阵眼；大乘是劫云与飞升名额；仙域是税契与仙籍；永恒是道则与代价。AI写交易先写单位对不对，再写价钱。

**【落陈夜的三十分钟】**
第一分钟：酒盏落地。第五分钟：神识罩下，飞剑失灵。第十分钟：白小纯第一次本应死去。第二十分钟：追杀者开始怀疑功法。第三十分钟：封堵阵合拢，逃路只剩阵眼与死人堆。契约者若在第十分钟还在抢宝，第三十分钟会变成宝旁的尸。
`;
t = t.replace('## 阶位切入点', more + '\n\n## 阶位切入点');
fs.writeFileSync('产出/批次05/一念永恒.md', t, 'utf8');
const pb = t.split('## 剧情')[1].split('## 阶位切入点')[0];
console.log('after', pb.replace(/\s/g,'').length);
