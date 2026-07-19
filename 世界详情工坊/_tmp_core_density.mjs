import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const base = path.join(path.dirname(fileURLToPath(import.meta.url)), '产出')
const need = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '_tmp_need_deep.json'), 'utf8'),
)
const arr = Array.isArray(need) ? need : []
const targets = arr.filter(x => {
  const d = x.d || x.batch
  return d >= 839 && d <= 845
})

const coreKeys = [
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

function coreLen(plot) {
  // only first occurrence of each core heading until next 【
  let total = 0
  const detail = {}
  for (const k of coreKeys) {
    const re = new RegExp(`\\*\\*【[^】]*${k}[^】]*】\\*\\*([\\s\\S]*?)(?=\\n\\*\\*【|$)`)
    const m = plot.match(re)
    const len = m ? m[1].replace(/\s/g, '').length : 0
    detail[k] = len
    total += len
  }
  return { total, detail }
}

const out = []
for (const t of targets) {
  const fp = path.join(base, `批次${t.d}`, t.f)
  if (!fs.existsSync(fp)) continue
  const txt = fs.readFileSync(fp, 'utf8')
  const plot = (txt.split(/^## 剧情\s*$/m)[1] || '').split(/^## /m)[0] || ''
  const plen = plot.replace(/\s/g, '').length
  const { total, detail } = coreLen(plot)
  const headers = [...plot.matchAll(/【([^】]{1,30})】/g)].map(m => m[1])
  const padish = headers.filter(h =>
    /补笔|补页|补足|再写|再申|附录|世界卡|收工|声音|纪律|细目|会计|第三段|扩|加厚/.test(h),
  )
  out.push({
    d: t.d,
    f: t.f,
    plen,
    core: total,
    ratio: +(total / Math.max(plen, 1)).toFixed(2),
    people: detail['主要人物'],
    plotline: detail['世界剧情线'],
    padishN: padish.length,
    padish: padish.slice(0, 12),
    thin: !!t.thin,
  })
}
out.sort((a, b) => a.core - b.core)
console.log(JSON.stringify(out, null, 2))
fs.writeFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '_tmp_core_density.json'),
  JSON.stringify(out, null, 2),
)
