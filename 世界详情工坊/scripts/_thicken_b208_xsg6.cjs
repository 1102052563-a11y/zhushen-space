const fs = require('fs');
const p = '产出/批次208/新三国.md';
let t = fs.readFileSync(p, 'utf8');
const more = `
**【补充名将与谋士速查】**
夏侯惇守城刚猛；夏侯渊奔袭汉中；张辽合肥威震江东；许褚护主；徐晃善攻；张郃善变；于禁军纪严却受辱；庞德死战；黄忠老当益壮；魏延勇而见忌；马超西凉余威；马良忠厚；蒋琬费祎后期理政；诸葛瑾两边做人；张昭主降务实；程普黄盖韩当江东旧将；太史慈义烈。写群像时优先点名而非「众将」。
`;
if (!t.includes('补充名将与谋士速查')) {
  t = t.replace('**【叙事基调 · 雷区】**', more + '\n**【叙事基调 · 雷区】**');
}
fs.writeFileSync(p, t);
const plot = t.split('## 剧情')[1].split('## 阶位切入点')[0].replace(/\s/g, '');
console.log('plot', plot.length);
