import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const base = path.dirname(fileURLToPath(import.meta.url))
let pass = 0
let fail = 0
const fails = []
for (let d = 839; d <= 845; d++) {
  const dir = path.join(base, '产出', `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
    const fp = path.join(dir, f)
    const t = fs.readFileSync(fp, 'utf8')
    if (/lib:\s*休闲|## 休闲切入点/.test(t)) continue
    try {
      const o = execSync(`node scripts/compile-worldbook.mjs --check "${fp}"`, {
        cwd: base,
        encoding: 'utf8',
      })
      if (o.includes('不过关') || o.includes('[错误]')) {
        fail++
        fails.push(o.trim())
      } else pass++
    } catch (e) {
      fail++
      fails.push(String(e.stdout || e.message).trim())
    }
  }
}
console.log('PASS', pass, 'FAIL', fail)
for (const x of fails.slice(0, 10)) console.log('---\n' + x.slice(0, 400))
