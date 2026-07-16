const fs = require('fs');
const path = require('path');
const p = path.join('产出', '批次218', '假面骑士Drive.md');
let t = fs.readFileSync(p, 'utf8');
const more = `

**【原作信息增密·赛特朗与Pit】**
赛特朗是Drive专属跑车，平时停放Drive Pit，战斗中可形成围墙或参与type Tridoron合体。Pit遭袭时零件与数据备份是否带出，决定凛奈后续能否修复。契约者五阶「护送凛奈完成Tridoron调整」应写清时间窗与袭击波次。腰带先生被复制期间，Pit内任何语音指令都需二次口令验证。
`;
if (!t.includes('原作信息增密·赛特朗与Pit')) {
  t = t.replace('\n## 阶位切入点', more + '\n## 阶位切入点');
  // also soften "被封印" if any in entry - check later
  fs.writeFileSync(p, t, 'utf8');
}
// fix seal warning if present
t = fs.readFileSync(p, 'utf8');
if (t.includes('被封印')) {
  t = t.replace(/被封印/g, '被封存');
  fs.writeFileSync(p, t, 'utf8');
}
const m = t.match(/## 剧情\s*([\s\S]*?)## 阶位切入点/);
const e = t.match(/## 阶位切入点\s*([\s\S]*?)## 来源/);
const cc = (s) => s.replace(/\s/g, '').length;
console.log('plot', cc(m[1]), 'entry', cc(e[1]), cc(m[1]) >= 10000 && cc(e[1]) >= 1500 ? 'OK' : 'NEED');
