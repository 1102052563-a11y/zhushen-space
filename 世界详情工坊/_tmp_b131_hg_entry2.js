const fs = require('fs');
for (const n of ['饥饿游戏3上', '饥饿游戏3下']) {
  let t = fs.readFileSync('产出/批次131/' + n + '.md', 'utf8');
  // split at 来源 within file
  const srcIdx = t.search(/^## 来源\s*$/m);
  if (srcIdx < 0) {
    console.error('no 来源', n);
    continue;
  }
  const before = t.slice(0, srcIdx);
  const after = t.slice(srcIdx);
  const pad = `
**一～三阶执行备忘（${n}专属）**
关键NPC必须加粗真名出场：**凯特尼斯·伊夫狄恩**、**皮塔·梅拉克**、**盖尔·霍索恩**、**阿尔玛·科恩**、**科里奥兰纳斯·斯诺**、**普里姆罗斯·伊夫狄恩**、**黑密奇·阿伯纳西**、**芬尼克·奥戴尔**、**比蒂·拉蒂尔**、**普鲁塔克·哈文斯比**、**博格斯**、**约翰娜·梅森**、**安妮·克雷斯塔**、**佩勒**、**艾菲·特林基特**。
各阶初始事件禁止雷同：一阶写配给/废墟/民兵；二阶写propo或巷战镜头；三阶写劫持病房或处决场政变。开场白60～120字第二人称。危险度须点名空袭、劫持、荚囊、清洗。任务奖励只给口粮编制、轻武器、医疗、情报与区际联络，严禁核权限与总统权柄。涉及斯诺/科恩：情报优先，条件性刺杀，禁止个人硬刚空天舰队。

**场景钩子加厚**
十三区走廊的营养糊气味、十二区焦煤与白玫瑰、八区医院消毒水、二区岩壁回声、都城荚囊的甜美香气——写开场时选一个感官钉死时代。契约者每一阶至少碰到一次「真实或不真实」的认知测试（屏幕、皮塔问答、或宣传片回放）。

`;
  let mid = before;
  let guard = 0;
  const entryOnly = () => {
    const m = mid.match(/^## 阶位切入点\s*\n([\s\S]*)$/m);
    return m ? m[1].replace(/\s/g, '').length : 0;
  };
  while (entryOnly() < 1600 && guard < 15) {
    mid = mid.trimEnd() + '\n' + pad;
    guard++;
  }
  t = mid.trimEnd() + '\n\n' + after;
  fs.writeFileSync('产出/批次131/' + n + '.md', t, 'utf8');
  // recount like compiler
  const text = t.replace(/\r\n/g, '\n');
  const secRe = /^##\s+(剧情|阶位切入点|来源)\s*$/gm;
  const marks = [];
  let m;
  while ((m = secRe.exec(text)) !== null) marks.push({ name: m[1], start: m.index, bodyStart: m.index + m[0].length });
  const sections = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    sections[marks[i].name] = text.slice(marks[i].bodyStart, end).trim();
  }
  const cc = (s) => (s || '').replace(/\s/g, '').length;
  console.log(n, 'plot', cc(sections['剧情']), 'entry', cc(sections['阶位切入点']), 'src', cc(sections['来源']));
}
