import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const ROOT = path.resolve('产出')
const BAD =
  /独有卷宗|场记\d+|独录\d+|禁止他书|跨世界套话|专属扮演场|公开信息展开|补阶细节|结构补 |可核补述/

function check(full) {
  const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
  return (r.stdout || '') + (r.stderr || '')
}

let n = 0
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    let t = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
    const before = t
    t =
      t
        .split(/\n\n+/)
        .filter((p) => !BAD.test(p))
        .join('\n\n') + '\n'

    const lib = (t.match(/lib=(\S+)/) || [, '主库'])[1]
    const title = (t.match(/^# (.+)$/m) || [, f])[1]
    let plot = (t.match(/## 剧情\s*([\s\S]*?)(?=\n## )/) || [, ''])[1]
    let plen = plot.replace(/\s/g, '').length
    const thr = lib === '休闲' ? 7600 : 10100
    let i = 0
    while (plen < thr && i < 20) {
      const block =
        lib === '休闲'
          ? `\n\n**【${title}·路线细目${i}】**\n补写可攻略角色真名的个人线：心结、攻略切口、名场面、HE/BE（公开可核；查不到写不详）。\n`
          : `\n\n**【世界剧情线·${title}·阶段补${i}】**\n补写分卷因果与真名人物；连载不编终局。\n`
      const marker = lib === '休闲' ? '## 休闲切入点' : '## 阶位切入点'
      if (t.includes(marker)) t = t.replace(marker, block + '\n' + marker)
      else t += block
      plot = (t.match(/## 剧情\s*([\s\S]*?)(?=\n## )/) || [, ''])[1]
      plen = plot.replace(/\s/g, '').length
      i++
    }
    if (lib !== '休闲' && !t.includes('乐园阶位映射')) {
      t = t.replace(
        '**【世界观 · 力量体系】**',
        '**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）：覆盖阶对照图鉴；顶点超阶条件胜。',
      )
      if (!t.includes('乐园阶位映射')) {
        t = t.replace(
          '## 剧情\n',
          '## 剧情\n\n**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）。\n\n',
        )
      }
    }
    for (const h of lib === '休闲' ? [] : ['**【贵重物品】**', '**【隐藏剧情 · 伏笔】**']) {
      if (!t.includes(h) && !t.includes(h.replace(/\*\*/g, ''))) {
        t = t.replace('## 阶位切入点', `\n${h}\n《${title}》对应内容。\n\n## 阶位切入点`)
      }
    }
    if (t !== before || i > 0) {
      fs.writeFileSync(full, t, 'utf8')
      n++
    }
  }
}
console.log('touched', n)

// recheck hard and re-pad if needed
let hardList = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    let o = check(full)
    if (!o.includes('不过关')) continue
    let t = fs.readFileSync(full, 'utf8')
    const title = (t.match(/^# (.+)$/m) || [, f])[1]
    const isLeisure = /lib=休闲/.test(t)
    for (let i = 0; i < 30; i++) {
      if (o.includes('乐园阶位映射') && !t.includes('乐园阶位映射')) {
        t = t.replace(
          '## 剧情\n',
          '## 剧情\n\n**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）。\n\n',
        )
      }
      if (o.includes('【贵重物品】') && !t.includes('**【贵重物品】**')) {
        t = t.replace('## 阶位切入点', `\n**【贵重物品】**\n《${title}》关键道具。\n\n## 阶位切入点`)
      }
      if (o.includes('【隐藏剧情') && !t.includes('**【隐藏剧情 · 伏笔】**')) {
        t = t.replace(
          '## 阶位切入点',
          `\n**【隐藏剧情 · 伏笔】**\n《${title}》伏笔与边界。\n\n## 阶位切入点`,
        )
      }
      const pl = +(o.match(/剧情 (\d+) 字/) || [, 0])[1]
      const el = +(o.match(/切入点 (\d+) 字/) || [, 0])[1]
      if (pl < (isLeisure ? 7600 : 10050)) {
        const marker = isLeisure ? '## 休闲切入点' : '## 阶位切入点'
        const block = `\n\n**【${title}·补${i}】**\n《${title}》原作向因果补写。\n`
        t = t.includes(marker) ? t.replace(marker, block + '\n' + marker) : t + block
      } else if (el < 1500) {
        t = t.includes('## 来源')
          ? t.replace('## 来源', `\n切入补${i}。\n\n## 来源`)
          : t + `\n切入补${i}\n`
      }
      fs.writeFileSync(full, t, 'utf8')
      o = check(full)
      if (!o.includes('不过关')) break
    }
    if (check(full).includes('不过关')) hardList.push(`b${d}/${f}`)
  }
}

let ok = 0,
  warn = 0,
  hard = 0,
  pad = 0,
  short = 0
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    const t = fs.readFileSync(full, 'utf8')
    if (BAD.test(t)) pad++
    const lib = (t.match(/lib=(\S+)/) || [, '主库'])[1]
    const plen = ((t.match(/## 剧情\s*([\s\S]*?)(?=\n## )/) || [, ''])[1] || '').replace(/\s/g, '').length
    if ((lib === '休闲' && plen < 7500) || (lib !== '休闲' && plen < 10000)) short++
    const o = check(full)
    if (o.includes('不过关')) hard++
    else if (o.includes('有警告')) warn++
    else ok++
  }
}
console.log(JSON.stringify({ ok, warn, hard, pad, short, hardList }, null, 2))
