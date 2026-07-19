import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const base = path.dirname(fileURLToPath(import.meta.url))
const need = JSON.parse(fs.readFileSync(path.join(base, '_tmp_need_deep.json'), 'utf8'))
const arr = Array.isArray(need) ? need : (need.items || need.list || [])
const targets = arr.filter(x => {
  const d = x.d || x.batch
  return d >= 839 && d <= 845 && (x.lib === '主库' || !x.lib)
})

const padRe = /【扩写|【补密|【阶段档案|【剧情补述|【可介入事件·清单|【细目|【加厚|【细则|【补段|【扩段|【再补|【终卷补强|【叙事执行细则|跨媒介流行作品|可被契约者切入的完整任务世界|本阶可刷/g
const genericRe = /作为一名契约者|在这个世界中|值得注意的是|综上所述|总而言之|与此同时，契约者|本世界独有的魅力|丰富的剧情内容/g

const results = []
for (const t of targets) {
  const fp = path.join(base, '产出', `批次${t.d}`, t.f)
  let st = 'MISS'
  try {
    const out = execSync(`node scripts/compile-worldbook.mjs --check "${fp}"`, {
      cwd: base,
      encoding: 'utf8',
      timeout: 60000,
    })
    st = out.trim().split(/\r?\n/).slice(-3).join(' | ')
  } catch (e) {
    st = String(e.stdout || e.stderr || e.message || '')
      .trim()
      .split(/\r?\n/)
      .slice(-6)
      .join(' | ')
  }
  const txt = fs.readFileSync(fp, 'utf8')
  const plot = (txt.split(/^## 剧情\s*$/m)[1] || '').split(/^## /m)[0] || ''
  const plen = plot.replace(/\s/g, '').length
  const pads = [...txt.matchAll(padRe)].map(m => m[0])
  const gens = [...txt.matchAll(genericRe)].map(m => m[0])
  const body = plot.replace(/\s/g, '')
  let maxDup = 0
  let dupSample = ''
  const seen = new Map()
  for (let i = 0; i + 48 <= Math.min(body.length, 12000); i += 24) {
    const s = body.slice(i, i + 48)
    if (seen.has(s)) {
      maxDup++
      if (!dupSample) dupSample = s
    } else seen.set(s, 1)
  }
  // head of plot for quality sniff
  const head = plot.replace(/\s+/g, ' ').slice(0, 180)
  results.push({
    d: t.d,
    f: t.f,
    plen,
    thin: !!t.thin,
    padN: pads.length,
    pads: pads.slice(0, 6),
    genN: gens.length,
    maxDup,
    dupSample,
    head,
    st: st.slice(0, 240),
  })
}
fs.writeFileSync(path.join(base, '_tmp_scan_839_845.json'), JSON.stringify(results, null, 2), 'utf8')
console.log(JSON.stringify(results, null, 2))
