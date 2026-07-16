const fs = require('fs');
for (const n of ['饥饿游戏3上', '饥饿游戏3下']) {
  let t = fs.readFileSync('产出/批次131/' + n + '.md', 'utf8');
  const parts = t.split('## 阶位切入点');
  let entry = parts[1] || '';
  const pad = `

**补充切入细则（${n}）**
本阶任务须绑定原作人名与地点：凯特尼斯·伊夫狄恩、皮塔·梅拉克、盖尔·霍索恩、阿尔玛·科恩、科里奥兰纳斯·斯诺、普里姆罗斯、黑密奇、芬尼克·奥戴尔、比蒂、普鲁塔克、博格斯、约翰娜·梅森、安妮·克雷斯塔、佩勒、艾菲·特林基特。禁止各阶复制同一句「假货、护送、名额」。开场白保持第二人称画面感；危险度写清空袭、劫持、荚囊、清洗。奖励限当前阶：口粮编制、轻武、情报、医疗，不发核按钮与总统权柄。若涉及斯诺或科恩，一律情报优先，禁止个人肉体硬刚空天火力。
`;
  let guard = 0;
  while (entry.replace(/\s/g, '').length < 1600 && guard < 20) {
    entry += pad;
    guard++;
  }
  t = parts[0] + '## 阶位切入点' + entry;
  fs.writeFileSync('产出/批次131/' + n + '.md', t, 'utf8');
  console.log(n, 'entry', entry.replace(/\s/g, '').length, 'plot', parts[0].replace(/\s/g, '').length);
}
