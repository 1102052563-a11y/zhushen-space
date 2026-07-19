import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const hard = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join('产出', `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
    const t = (r.stdout || '') + (r.stderr || '')
    if (t.includes('不过关')) {
      const body = fs.readFileSync(full, 'utf8')
      hard.push({
        d,
        f,
        err: t.match(/\[错误\][^\n]+/g) || [],
        meta: (body.match(/lib=(\S+)/) || [])[1],
        tiers: (body.match(/tiers=([^\s-->]+)/) || [])[1],
      })
      console.log('b' + d + '/' + f)
      console.log((t.match(/\[错误\][^\n]+/g) || []).join('\n'))
    }
  }
}
fs.writeFileSync('_tmp_hard23.json', JSON.stringify(hard, null, 2))
console.log('count', hard.length)
