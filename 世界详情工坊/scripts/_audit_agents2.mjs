import fs from 'fs'
import path from 'path'

const BAD = ['为轮回乐园世界库', '阶段0 标题相位', '题名核心・不详真名', '主舞台根据题名推断', '【细节层']
const targets = [
  '世界详情工坊/产出/批次756',
  '世界详情工坊/产出/批次763/異世界♂ヤリサー —お前のモノは俺のモノ—.md',
  '世界详情工坊/产出/批次764',
  '世界详情工坊/产出/批次757/Mama×Holic.md',
  '世界详情工坊/产出/批次763/王子の本命は悪役令嬢.md',
]

function audit(f) {
  if (!fs.existsSync(f)) return
  if (fs.statSync(f).isDirectory()) {
    for (const n of fs.readdirSync(f)) {
      if (/下品|ヤリサー|土下座|第二|Mama|王子|Dominance|SLEEPLESS/i.test(n)) audit(path.join(f, n))
    }
    return
  }
  const t = fs.readFileSync(f, 'utf8')
  const m = t.match(/## 剧情([\s\S]*?)## 休闲切入点/)
  const plot = m ? m[1].replace(/\s/g, '').length : 0
  const m2 = t.match(/## 休闲切入点([\s\S]*?)## 来源/)
  const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
  const bad = BAD.filter((b) => t.includes(b))
  console.log(
    path.basename(f).slice(0, 48),
    'plot',
    plot,
    'cut',
    cut,
    'bad',
    bad.length,
    fs.statSync(f).mtime.toISOString().slice(11, 19),
  )
}
targets.forEach(audit)
