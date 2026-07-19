/**
 * 对 git 恢复的 11 个文件：安全去重
 * - 文内完全重复段落只留首次
 * - 删除已知跨文件灌水段
 * - 保持真实换行
 * - 去重后若机检不过：不再自动灌水，报告
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const files = [
  '产出/批次810/MELTY BLOOD Actress Again.md',
  '产出/批次810/ひぐらしのなく頃に 奉.md',
  '产出/批次810/ひぐらしのなく頃に 祭.md',
  '产出/批次810/ひぐらしのなく頃に 粋.md',
  '产出/批次810/ひぐらしのなく頃に 解.md',
  '产出/批次814/大図書館の羊飼い -Dreaming Sheep-.md',
  '产出/批次814/時計仕掛けのレイライン -朝霧に散る花-.md',
  '产出/批次814/時計仕掛けのレイライン -残影の夜が明ける時-.md',
  '产出/批次814/時計仕掛けのレイライン -黄昏時の境界線-.md',
  '产出/批次814/真・恋姫†夢想-革命- 劉旗の大望.md',
  '产出/批次829/時計仕掛けのレイライン -無限の夜想曲-.md',
]

const BAD = [
  '部活的一局游戏往往比长篇对白更能推进关系',
  '大人角色同样走情感线：大石的咖喱',
  '补充游玩节拍：建议以「一周学园日历」推进',
  '补充开场变体：若玩家更偏旁观',
  '【故事主线 · 情感线｜补述：部活作为爱情与信赖的语法】',
  '【可攻略角色｜互动补强】',
  '【地理补强：名场面坐标】',
  '【隐藏与后日谈的情感用法】',
  '补充节奏建议：第一周只玩部活',
  '【关系推进补述】',
  '【日常细节补强】',
  '【日常时间表补完】',
  '【补记 · 情感节奏】',
  '公开可核逻辑场景',
  '游玩细目',
]

for (const rel of files) {
  const full = path.resolve(rel)
  let t = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  const parts = t.split(/\n\n+/)
  const out = []
  const seen = new Set()
  let rem = 0
  for (const p of parts) {
    const n = p.replace(/\s+/g, ' ').trim()
    if (!n) continue
    if (BAD.some((b) => n.includes(b))) {
      rem++
      continue
    }
    if (n.length >= 100) {
      if (seen.has(n)) {
        rem++
        continue
      }
      seen.add(n)
    }
    out.push(p.trim())
  }
  const body = out.join('\n\n') + '\n'
  fs.writeFileSync(full, body, 'utf8')
  const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
  const o = (r.stdout || '') + (r.stderr || '')
  console.log(path.basename(rel), 'removed', rem, o.includes('不过关') ? 'FAIL' : 'OK', (o.match(/剧情 \d+ 字 · 切入点 \d+ 字/) || [''])[0])
}

// full tally
let ok = 0,
  warn = 0,
  hard = 0
const hardL = []
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
      hardL.push(`b${d}/${f}`)
    } else if (t.includes('有警告')) warn++
    else if (t.includes('过关')) ok++
  }
}

// shared non-http lines ge4
const lineMap = new Map()
for (let d = 801; d <= 870; d++) {
  const dir = path.join('产出', `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    for (const l of fs
      .readFileSync(path.join(dir, f), 'utf8')
      .split(/\n/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 80 && !x.includes('http'))) {
      if (!lineMap.has(l)) lineMap.set(l, new Set())
      lineMap.get(l).add(`b${d}/${f}`)
    }
  }
}
const multi = [...lineMap.entries()].filter(([, s]) => s.size >= 4).sort((a, b) => b[1].size - a[1].size)
console.log(JSON.stringify({ ok, warn, hard, hardL, sharedGe4: multi.length, top: multi.slice(0, 10).map(([l, s]) => ({ n: s.size, l: l.slice(0, 70) })) }, null, 2))
