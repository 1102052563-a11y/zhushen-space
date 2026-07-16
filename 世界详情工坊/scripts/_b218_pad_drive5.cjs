const fs = require('fs');
const path = require('path');
const p = path.join('产出', '批次218', '假面骑士Drive.md');
let t = fs.readFileSync(p, 'utf8');
const more = `

**【原作信息增密·终章余韵】**
Heart离世前托付「勿忘恶路程式」，特状课档案应留下其存在痕迹；进之介的正义从此包含对敌生命的理解。
`;
if (!t.includes('原作信息增密·终章余韵')) {
  t = t.replace('\n## 阶位切入点', more + '\n## 阶位切入点');
  fs.writeFileSync(p, t, 'utf8');
}
const m = t.match(/## 剧情\s*([\s\S]*?)## 阶位切入点/);
const e = t.match(/## 阶位切入点\s*([\s\S]*?)## 来源/);
const cc = (s) => s.replace(/\s/g, '').length;
console.log('plot', cc(m[1]), 'entry', cc(e[1]), cc(m[1]) >= 10000 && cc(e[1]) >= 1500 ? 'OK' : 'NEED');
