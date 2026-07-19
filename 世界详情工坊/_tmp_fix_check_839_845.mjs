import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const base = path.dirname(fileURLToPath(import.meta.url))
const files = []
for (let d = 839; d <= 845; d++) {
  const dir = path.join(base, '产出', `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
    const fp = path.join(dir, f)
    let t = fs.readFileSync(fp, 'utf8')
    if (/lib:\s*休闲|## 休闲切入点/.test(t)) continue
    const before = t
    t = t.replace(/【隐藏剧情·伏笔】/g, '【隐藏剧情 · 伏笔】')
    t = t.replace(/【大事记】(?!时间线)/g, '【大事记时间线】')
    t = t.replace(/【叙事基调·雷区】/g, '【叙事基调 · 雷区】')
    t = t.replace(/【地理·舞台】/g, '【地理 · 舞台】')
    t = t.replace(/【世界观·力量体系】/g, '【世界观 · 力量体系】')
    if (t !== before) {
      fs.writeFileSync(fp, t)
      console.log('fixed', d, f)
    }
    files.push(fp)
  }
}

let fail = 0
let pass = 0
const fails = []
for (const fp of files) {
  try {
    const o = execSync(`node scripts/compile-worldbook.mjs --check "${fp}"`, {
      cwd: base,
      encoding: 'utf8',
    })
    const last = o.trim().split(/\n/).pop()
    if (last.includes('✓') || (last.includes('过关') && !last.includes('不'))) pass++
    else {
      fail++
      fails.push(last)
    }
  } catch (e) {
    fail++
    const msg = String(e.stdout || e.message)
      .trim()
      .split(/\n/)
      .slice(-5)
      .join(' | ')
    fails.push(path.basename(fp) + ' :: ' + msg)
  }
}
console.log('pass', pass, 'fail', fail)
if (fails.length) console.log(fails.join('\n'))
