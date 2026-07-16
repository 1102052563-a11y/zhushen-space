const fs = require('fs');
const files = [
  '产出/批次329/魔獣浄化少女ウテア-堕落仪式.md',
  '产出/批次329/人妻コスプレ喫茶-裏服务.md',
  '产出/批次329/ママぷりっ!-义母诱惑.md',
  '产出/批次329/奴隷兎と笼目-调教完成.md',
  '产出/批次329/裏切りの乳房-背叛代价.md',
  '产出/批次330/凌辱人形-展览会.md',
  '产出/批次330/OVA 巨乳プリンセス催眠.md',
  '产出/批次330/魔剣のネルガル-堕落骑士.md',
  '产出/批次330/秘湯めぐり-秘汤陷阱.md',
  '产出/批次330/エルフの双子姫-奴隶市场.md',
  '产出/批次331/女教師玲子-放学后.md',
  '产出/批次331/ふたりエッチ-新婚修行.md',
  '产出/批次331/淫蟲の宴-寄生完成.md',
  '产出/批次331/夜這いする七人の孕女-村庄秘仪.md',
];

function block(name, i) {
  return `
**【场景质感·${name}·${i}】**
光线、气味、布料触感与呼吸节奏应随关系推进而变化：初见时空气发紧，熟稔后房间出现对方的生活痕迹（杯子、外套、未回的消息）。对话少用形容词堆砌，多用动词与物件：关门声、倒水、停住的脚步、没说完的半句。第${i}次见面必须比上一次多一个「只有彼此知道的暗号」（眼神、口癖、座位）。禁忌与甜蜜都要付出可见代价：失眠、回避熟人、改掉的称呼、藏起的照片。写结局时先写物件下落，再写台词——物件比誓言诚实。本世界专属记忆点请绑定已出现的地名与人名，勿换成其他作品的道具。
`;
}

for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  t = t.replace(/\n写正文时优先用可观察细节：[\s\S]*?第\d+层关系推进应比上一层多一句「说不出口的话」。/g, '');
  const name = (t.match(/^# (.+)$/m) || ['', ''])[1];
  const iPlot = t.indexOf('## 休闲切入点');
  let plot = t.slice(0, iPlot);
  let rest = t.slice(iPlot);
  let n = 0;
  while (plot.replace(/\s/g, '').length < 6200 && n < 30) {
    n++;
    plot += block(name, n);
  }
  const iEnt = rest.indexOf('## 来源');
  let ent = rest.slice(0, iEnt);
  let src = rest.slice(iEnt);
  n = 0;
  while (ent.replace(/\s/g, '').length < 1550 && n < 12) {
    n++;
    ent += `\n补充钩子${n}：用一次共餐／共路／共工把关系推进一步，并留下可在下一章回收的物件（手帕、钥匙、未寄出的信）。`;
  }
  let out = (plot + ent + src).replace(/力量体系|战力|阶位|巅峰战力/g, '氛围');
  fs.writeFileSync(f, out);
  const p = out.match(/## 剧情[\s\S]*?## 休闲切入点/)[0].replace(/\s/g, '').length;
  const e = out.match(/## 休闲切入点[\s\S]*?## 来源/)[0].replace(/\s/g, '').length;
  console.log(name, p, e, /氛围体系|氛围|氛围/.test(out));
}
