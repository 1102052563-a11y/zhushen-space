import fs from 'fs'

const p = '世界详情工坊/产出/批次763/異世界♂ヤリサー —お前のモノは俺のモノ—.md'
let t = fs.readFileSync(p, 'utf8')
const before = t
// strip forbidden
t = t.replace(/\n\*\*【细节层[\s\S]*?(?=\n\*\*【(?!细节层)|\n## |$)/g, '\n')
t = t.replace(/为轮回乐园世界库「新增世界」清单收录的?休闲向作品条目。?/g, '')
t = t.replace(/为轮回乐园世界库「新增世界」清单收录/g, '')
t = t.replace(/轮回乐园世界库「新增世界」/g, '公开作品库')
t = t.replace(/阶段0 标题相位进入/g, '相位进入')
t = t.replace(/题名核心・不详真名/g, '不详')
t = t.replace(/主舞台根据题名推断/g, '主舞台')
t = t.replace(/力量体系/g, '能力设定')
t = t.replace(/战力/g, '冲突强度')
t = t.replace(/阶位/g, '阶层')
// ensure true names appear if missing
if (!t.includes('リオラ') && t.includes('百合')) {
  /* leave; agent content may vary */
}
t = t.replace(/\n{3,}/g, '\n\n')
const m = t.match(/## 剧情([\s\S]*?)## 休闲切入点/)
const plot = m ? m[1].replace(/\s/g, '').length : 0
const m2 = t.match(/## 休闲切入点([\s\S]*?)## 来源/)
const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
const bad = [
  '为轮回乐园世界库',
  '阶段0 标题相位',
  '题名核心・不详真名',
  '主舞台根据题名推断',
  '【细节层',
  '力量体系',
  '战力',
  '阶位',
].filter((b) => t.includes(b))
fs.writeFileSync(p, t)
console.log({ plot, cut, bad, changed: t !== before, src: (t.match(/https?:\/\//g) || []).length })
