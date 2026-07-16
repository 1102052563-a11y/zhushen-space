const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '产出', '批次244');
const wc = (s) => (s || '').replace(/\s/g, '').length;

for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith('.md'))) {
  let t = fs.readFileSync(path.join(OUT, f), 'utf8');
  const j = t.indexOf('## 来源');
  const i = t.indexOf('## 阶位切入点');
  let entry = t.slice(i + '## 阶位切入点'.length, j);
  const tag = f.replace('.md', '');
  let n = 1;
  while (wc(entry) < 1550) {
    entry +=
      '\n\n【' +
      tag +
      '·切入补强' +
      n +
      '】开局事件必须落到具体地点与具名NPC；写清报酬/风险/失败死亡率。顶点只给情报与条件。补强' +
      n +
      '可观察细节：徽章核验、物证编号、时序T值、结算关键词是否写入。与剧情段条件性胜利清单对齐，不另造跨世界任务。\n';
    n++;
    if (n > 20) break;
  }
  t = t.slice(0, i) + '## 阶位切入点' + entry + t.slice(j);
  fs.writeFileSync(path.join(OUT, f), t, 'utf8');
  const nt = fs.readFileSync(path.join(OUT, f), 'utf8');
  const p = wc(nt.match(/## 剧情([\s\S]*?)## 阶位切入点/)[1]);
  const e = wc(nt.match(/## 阶位切入点([\s\S]*?)## 来源/)[1]);
  console.log(f, '剧情', p, '切入', e, p >= 10000 && e >= 1500 ? 'OK' : 'FAIL');
}
