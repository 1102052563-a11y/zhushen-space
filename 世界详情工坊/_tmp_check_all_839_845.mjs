import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const base = path.dirname(fileURLToPath(import.meta.url))
const fails = []
const pass = []
for (let d = 839; d <= 845; d++) {
  const dir = path.join(base, '产出', `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
    const fp = path.join(dir, f)
    const txt = fs.readFileSync(fp, 'utf8')
    const isLeisure = /lib:\s*休闲|## 休闲切入点/.test(txt)
    if (isLeisure) {
      console.log('SKIP leisure', d, f)
      continue
    }
    let st
    try {
      st = execSync(`node scripts/compile-worldbook.mjs --check "${fp}"`, {
        cwd: base,
        encoding: 'utf8',
        timeout: 60000,
      })
        .trim()
        .split(/\r?\n/)
        .pop()
      pass.push({ d, f, st })
    } catch (e) {
      st = String(e.stdout || e.message)
        .trim()
        .split(/\r?\n/)
        .slice(-4)
        .join(' | ')
      fails.push({ d, f, st })
    }
    console.log(d, f, st.slice(0, 140))
  }
}
console.log('PASS', pass.length, 'FAILS', fails.length)
if (fails.length) console.log(JSON.stringify(fails, null, 2))
fs.writeFileSync(
  path.join(base, '_tmp_check_all_839_845.json'),
  JSON.stringify({ pass, fails }, null, 2),
  'utf8',
)
