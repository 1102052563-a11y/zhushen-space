import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '产出')
const files = [
  ['批次839', '夜无疆.md'],
  ['批次840', '青山.md'],
  ['批次840', '剑烛大荒.md'],
  ['批次843', '你的技能很好，现在我也有了.md'],
  ['批次844', '苟在两界修仙.md'],
]

for (const [b, f] of files) {
  const txt = fs.readFileSync(path.join(base, b, f), 'utf8')
  const plot = (txt.split(/^## 剧情\s*$/m)[1] || '').split(/^## /m)[0] || ''
  console.log('====', f, 'plot', plot.replace(/\s/g, '').length)
  const secs = [
    '作品来源',
    '世界定位',
    '世界观',
    '地理',
    '世界剧情线',
    '主要人物',
    '势力',
    '贵重',
    '隐藏',
    '大事记',
    '叙事基调',
  ]
  for (const s of secs) {
    const re = new RegExp(`【[^】]*${s}[^】]*】([\\s\\S]*?)(?=【|$)`)
    const m = plot.match(re)
    const len = m ? m[1].replace(/\s/g, '').length : 0
    console.log(' ', s, len)
  }
  const hollow = [
    '不详',
    '连载未完',
    '公开信息',
    '本档案',
    '以公开',
    '禁止编造',
    '条件性胜利',
    '情报优先',
    '阶段细目',
    '标记',
  ]
  for (const h of hollow) {
    const n = (plot.match(new RegExp(h, 'g')) || []).length
    if (n) console.log('  hollow', h, n)
  }
  // mid sample of plot
  const mid = plot.replace(/\s+/g, ' ').slice(2000, 2600)
  console.log('  mid:', mid.slice(0, 400))
  console.log('  end:', plot.replace(/\s+/g, ' ').slice(-400))
}
