const fs = require('fs');
const path = require('path');
const p = path.join('产出', '批次218', '假面骑士Drive.md');
let t = fs.readFileSync(p, 'utf8');
const more = `

**【原作信息增密·口号与基调锚】**
口号「这个男人，既是刑警也是假面骑士」要求叙事同时保留刑侦逻辑与骑士热血。重加速的静止恐怖与轮胎加速的爽感必须并置；敌人可有人性，尤其Heart线。契约者任务文案忌写成纯打怪清图。
`;
if (!t.includes('原作信息增密·口号与基调锚')) {
  t = t.replace('\n## 阶位切入点', more + '\n## 阶位切入点');
  fs.writeFileSync(p, t, 'utf8');
}
const m = t.match(/## 剧情\s*([\s\S]*?)## 阶位切入点/);
const e = t.match(/## 阶位切入点\s*([\s\S]*?)## 来源/);
const cc = (s) => s.replace(/\s/g, '').length;
console.log('plot', cc(m[1]), 'entry', cc(e[1]), cc(m[1]) >= 10000 && cc(e[1]) >= 1500 ? 'OK' : 'NEED');
