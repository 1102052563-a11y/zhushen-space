/**
 * 批次801-870 去重清灌水
 * 1) 文内完全重复段落只留首次
 * 2) 删除跨世界套话/编号细目/公开可核逻辑场景等灌水
 * 3) 输出仍低于机检门槛的文件清单
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

const ROOT = path.resolve('产出')
const PAD_LINE =
  /公开可核逻辑场景|游玩细目\d+|人物对白练习·|生活切片·|【补记 ·|【关系推进补述】|【日常细节补强】|【日常时间表补完】|【补记 · 情感节奏】|【】公开可核|正文优先谈判背刺护送|不编终局严禁顶点|好感不是条，而是对方是否愿意|春：转学、樱花、新社团|契约者保持低姿态：先成为|① 开局立足与金手指|开局立足与金手指\/身份确立|补充钩子：|补充切入执行细则|补充节奏建议：第一周只玩|节奏建议（四周模板）|（切入补强 · 条目化周常）|周常\d+：与可攻略对象完成一次|游玩细目/

const PAD_BLOCK_HEADERS =
  /^\*\*【(关系推进补述|日常细节补强|日常时间表补完|补记 ·|故事主线 · 情感线｜补述|可攻略角色｜互动补强|地理补强|隐藏与后日谈的情感用法|补记 · 情感节奏)/

function hash(s) {
  return crypto.createHash('md5').update(s).digest('hex')
}

function cleanText(t) {
  // normalize newlines
  t = t.replace(/\r\n/g, '\n')
  const parts = t.split(/\n{2,}/)
  const out = []
  const seen = new Set()
  let removedExact = 0
  let removedPad = 0

  for (let p of parts) {
    const raw = p
    const norm = p.replace(/\s+/g, ' ').trim()
    if (!norm) continue

    // drop pure pad lines/blocks
    if (PAD_LINE.test(norm) || PAD_BLOCK_HEADERS.test(p.trim())) {
      // keep if it's a short legitimate section? no - these are pad
      // exception: 休闲切入点 fixed line about 日常身份 is template-required - KEEP if starts with >
      if (norm.startsWith('> 本世界为休闲') || norm.startsWith('> 本世界为休闲/恋爱向')) {
        // keep one occurrence only
      } else if (/^> 阶位↔/.test(norm) || /^> 阶位↔境界/.test(norm)) {
        // keep
      } else {
        removedPad++
        continue
      }
    }

    // numbered 游玩细目 / 周常 / 细目 pure pad paragraphs
    if (/^(游玩细目\d+|周常\d+|细目\d+|【】公开)/.test(norm)) {
      removedPad++
      continue
    }

    // exact dup within file (len>=80)
    if (norm.length >= 80) {
      const h = hash(norm)
      if (seen.has(h)) {
        removedExact++
        continue
      }
      seen.add(h)
    }

    out.push(raw.trim())
  }

  let body = out.join('\n\n') + '\n'
  // collapse 3+ blank lines
  body = body.replace(/\n{3,}/g, '\n\n')
  return { body, removedExact, removedPad }
}

const report = { filesTouched: 0, exact: 0, pad: 0, short: [], stillPadMark: [] }
const shortList = []

for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    const before = fs.readFileSync(full, 'utf8')
    const { body, removedExact, removedPad } = cleanText(before)
    if (body !== before.replace(/\r\n/g, '\n') && (removedExact > 0 || removedPad > 0 || body.length < before.length - 50)) {
      fs.writeFileSync(full, body, 'utf8')
      report.filesTouched++
      report.exact += removedExact
      report.pad += removedPad
    }
    // length estimate
    const m = body.match(/lib=(\S+)/)
    const isLeisure = m && m[1] === '休闲'
    const plotM = body.match(/## 剧情\s*([\s\S]*?)(?=\n## )/)
    const entryM = body.match(/## (?:休闲|阶位)切入点\s*([\s\S]*?)(?=\n## |$)/)
    const plotLen = plotM ? plotM[1].replace(/\s/g, '').length : 0
    const entryLen = entryM ? entryM[1].replace(/\s/g, '').length : 0
    const needPlot = isLeisure ? 6000 : 10000
    const needEntry = 1500
    if (plotLen < needPlot || entryLen < needEntry) {
      shortList.push({ d, f, plotLen, entryLen, needPlot, isLeisure })
    }
    if (/【加厚|【扩写|【补密|【剧情补述/.test(body)) {
      report.stillPadMark.push(`b${d}/${f}`)
    }
  }
}

// official check hard fails
let hard = 0
const hardFiles = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
    const t = (r.stdout || '') + (r.stderr || '')
    if (t.includes('不过关')) {
      hard++
      const err = t
        .split(/\n/)
        .filter((l) => /错误|剧情|切入/.test(l))
        .slice(0, 4)
        .join(' | ')
      hardFiles.push(`b${d}/${f} :: ${err}`)
    }
  }
}

const outPath = path.resolve('_tmp_dedupe_report.json')
fs.writeFileSync(
  outPath,
  JSON.stringify({ report, shortList: shortList.slice(0, 200), shortTotal: shortList.length, hard, hardFiles }, null, 2),
  'utf8',
)
console.log(
  JSON.stringify(
    {
      filesTouched: report.filesTouched,
      removedExact: report.exact,
      removedPad: report.pad,
      shortTotal: shortList.length,
      hard,
      hardSample: hardFiles.slice(0, 40),
      stillPad: report.stillPadMark.slice(0, 20),
    },
    null,
    2,
  ),
)
