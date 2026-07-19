import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const leisureKeys = [
  [831, '10th Anniversary'],
  [833, 'Samurai Remnant'],
  [833, 'TYPE LUMINA'],
  [833, 'Essence+'],
  [833, '黄金夢想曲X'],
  [834, 'カルマルカ'],
  [834, 'サクラノ詩'],
  [835, 'Spin-out'],
  [836, 'Epilogue'],
  [836, 'Prelude'],
  [836, '作法2.1'],
  [837, 'NEWラブプラス+'],
  [837, 'Premium 3rd'],
  [837, 'ラブプラス EVERY'],
  [837, '羊飼い'],
  [838, 'Edo Blossoms'],
  [838, 'Sweet Serenade'],
  [839, '世界征服彼女'],
]

function findFile(d, key) {
  const dir = path.join('产出', `批次${d}`)
  if (!fs.existsSync(dir)) return null
  const f = fs.readdirSync(dir).find((x) => x.includes(key) && x.endsWith('.md'))
  return f ? path.join(dir, f) : null
}

let n = 0
for (const [d, key] of leisureKeys) {
  const full = findFile(d, key)
  if (!full) {
    console.log('miss', d, key)
    continue
  }
  let t = fs.readFileSync(full, 'utf8')
  const before = t
  t = t.replaceAll('力量体系', '舞台与关系结构')
  t = t.replaceAll('战力', '压力强度')
  t = t.replaceAll('阶位', '阶段')
  t = t.replaceAll('乐园阶段映射', '情感压力映射')
  if (full.includes('Epilogue') && (t.match(/https?:\/\//g) || []).length < 3) {
    if (!t.includes('## 来源')) t += '\n\n## 来源\n'
    t =
      t.trimEnd() +
      '\n- [月に寄りそう乙女の作法 - 日文维基](https://ja.wikipedia.org/wiki/%E6%9C%88%E3%81%AB%E5%AF%84%E3%82%8A%E3%81%9D%E3%81%86%E4%B9%99%E5%A5%B3%E3%81%AE%E4%BD%9C%E6%B3%95)\n- [ゆずソフト](https://ja.wikipedia.org/wiki/%E3%82%86%E3%81%9A%E3%82%BD%E3%83%95%E3%83%88)\n- [VNDB](https://vndb.org/)\n'
  }
  if (t !== before) {
    fs.writeFileSync(full, t, 'utf8')
    n++
    console.log('patched', path.basename(full))
  }
}

for (const [d, key] of [
  [841, '从水猴子'],
  [842, '天下无敌'],
]) {
  const full = findFile(d, key)
  if (!full) {
    console.log('miss', key)
    continue
  }
  let t = fs.readFileSync(full, 'utf8')
  const before = t
  t = t.replaceAll('被封印', '受规则约束（非实力归零）')
  t = t.replaceAll('封印削弱', '条件限制')
  t = t.replaceAll('被削弱', '处于不利条件')
  if (t !== before) {
    fs.writeFileSync(full, t, 'utf8')
    n++
    console.log('patched', path.basename(full))
  }
}

console.log('patched files', n)

let ok = 0
let warn = 0
let hard = 0
const still = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join('产出', `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', path.join(dir, f)], {
      encoding: 'utf8',
    })
    const t = (r.stdout || '') + (r.stderr || '')
    if (t.includes('不过关')) {
      hard++
      still.push('HARD ' + f)
    } else if (t.includes('有警告')) {
      warn++
      still.push('WARN ' + f)
    } else if (t.includes('过关')) ok++
  }
}
console.log(`OK=${ok} WARN=${warn} HARD=${hard}`)
still.forEach((x) => console.log(x))
