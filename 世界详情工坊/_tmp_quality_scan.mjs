import fs from 'fs'
import path from 'path'

const ROOT = path.resolve('产出')
const BAD =
  /独有卷宗|场记\d+|独录\d+|禁止他书|跨世界套话|盐记|标记 [a-f0-9]{8}|补阶细节|结构补全|机检补全|公开可核逻辑|游玩细目\d+|一周学园日历|契约者保持低姿态|好感不是条/

const rows = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8')
    const title = (t.match(/^# (.+)$/m) || [, f])[1]
    const lib = (t.match(/lib=(\S+)/) || [, '主库'])[1]
    const plot = (t.match(/## 剧情\s*([\s\S]*?)(?=\n## )/) || [, ''])[1]
    const entry = (t.match(/## (?:休闲|阶位)切入点\s*([\s\S]*?)(?=\n## |$)/) || [, ''])[1]
    const plen = plot.replace(/\s/g, '').length
    const elen = entry.replace(/\s/g, '').length
    const badHits = (t.match(BAD) || []).length
    const names = new Set([...(t.matchAll(/\*\*([^*\n]{2,16})\*\*/g))].map((m) => m[1]))
    const src = (t.match(/\]\(https?:\/\/[^)]+\)/g) || []).length
    // quality score: higher better
    let score = 0
    if (lib === '休闲' ? plen >= 7000 : plen >= 11000) score += 2
    else if (lib === '休闲' ? plen >= 6000 : plen >= 10000) score += 1
    if (elen >= 1800) score += 1
    if (names.size >= 8) score += 2
    else if (names.size >= 5) score += 1
    if (src >= 3) score += 1
    if (badHits === 0) score += 2
    else score -= Math.min(3, badHits)
    if (t.includes('真名以正文为准') || t.includes('公开信息展开')) score -= 2
    rows.push({ d, f, title, lib, plen, elen, badHits, names: names.size, src, score })
  }
}
rows.sort((a, b) => a.score - b.score || a.d - b.d)
fs.writeFileSync('_tmp_quality.json', JSON.stringify(rows, null, 2))
const low = rows.filter((r) => r.score <= 2)
const mid = rows.filter((r) => r.score > 2 && r.score <= 4)
const high = rows.filter((r) => r.score >= 5)
console.log(JSON.stringify({ total: rows.length, low: low.length, mid: mid.length, high: high.length, worst20: rows.slice(0, 20) }, null, 2))
