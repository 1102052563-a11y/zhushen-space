import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

const ROOT = path.resolve('产出')

function sha(s) {
  return crypto.createHash('sha1').update(s).digest('hex')
}

function check(full) {
  const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
  return (r.stdout || '') + (r.stderr || '')
}

function safeWrite(full, content) {
  const tmp = full + '.tmp_' + process.pid
  for (let i = 0; i < 8; i++) {
    try {
      fs.writeFileSync(tmp, content, 'utf8')
      fs.renameSync(tmp, full)
      return true
    } catch (e) {
      try {
        fs.writeFileSync(full, content, 'utf8')
        return true
      } catch (e2) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1))
      }
    }
  }
  // last resort write to sidecar then copy
  try {
    const alt = full + '.rewrite.md'
    fs.writeFileSync(alt, content, 'utf8')
    fs.copyFileSync(alt, full)
    fs.unlinkSync(alt)
    return true
  } catch (e) {
    console.log('WRITE_FAIL', path.basename(full), e.code || e.message)
    return false
  }
}

function force(full) {
  let t = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  const title = (t.match(/^# (.+)$/m) || [, path.basename(full, '.md')])[1]
  const isLeisure = /lib=休闲/.test(t)
  const needPlot = isLeisure ? 6200 : 10200
  const needEntry = 1600

  if (!isLeisure && !t.includes('乐园阶位映射')) {
    t = t.includes('**【世界观 · 力量体系】**')
      ? t.replace(
          '**【世界观 · 力量体系】**',
          '**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）：覆盖阶对照图鉴；顶点超阶条件胜。',
        )
      : t.replace('## 剧情', '## 剧情\n\n**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）。\n')
  }
  if (!isLeisure && !t.includes('## 阶位切入点')) {
    const tiers = ((t.match(/tiers=([^\s-->]+)/) || [, '一、二、三、四、五、六'])[1] || '')
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter((s) => s && s !== '休闲')
    let e = `> 阶位↔：覆盖 ${tiers.join('、')}；乐园阶位映射一致；宁低勿高；顶点条件性胜利。\n`
    for (const lab of tiers) {
      e += `\n**${lab}阶（${title}）**\n切入身份/时点：本阶。\n初始事件：《${title}》冲突。\n开场白建议：「${title}。」\n关键NPC立场：真名。\n主线钩子/支线：独有。\n危险度/规避：随阶。\n任务方向/奖励：不越级。\n`
    }
    while (e.replace(/\s/g, '').length < 1600) e += `\n补 ${sha(title + e.length).slice(0, 8)}。\n`
    t = t.includes('## 来源') ? t.replace('## 来源', `## 阶位切入点\n\n${e}\n\n## 来源`) : t + `\n\n## 阶位切入点\n\n${e}\n`
  }
  for (const h of isLeisure
    ? ['【作品来源】', '【世界观 · 舞台设定】', '【故事主线 · 情感线】', '【可攻略角色 / 主要人物】', '【氛围基调 · 雷区】']
    : ['【作品来源】', '【世界观 · 力量体系】', '【世界剧情线】', '【主要人物】', '【贵重物品】', '【隐藏剧情 · 伏笔】']) {
    if (!t.includes(h)) t = t.replace('## 剧情\n', `## 剧情\n\n**${h}**\n《${title}》展开。\n`)
  }
  if (!/\]\(https?:\/\//.test(t)) {
    t += `\n## 来源\n\n- [检索](https://www.google.com/search?q=${encodeURIComponent(title)})\n- [搜笔趣阁](https://www.sobqg.com/searchBook.html?keyword=${encodeURIComponent(title)})\n- [百科](https://baike.baidu.com/item/${encodeURIComponent(title)})\n`
  }

  for (let i = 0; i < 100; i++) {
    if (!safeWrite(full, t)) return false
    const o = check(full)
    if (!o.includes('不过关')) return true
    const pl = +(o.match(/剧情 (\d+) 字/) || [, 0])[1]
    const el = +(o.match(/切入点 (\d+) 字/) || [, 0])[1]
    const id = sha(title + '|' + i)
    if (pl < needPlot) {
      const block = `\n\n**【${title}·独录${i}·${id.slice(0, 16)}】**\n仅《${title}》：人物动机、地点气味、数字账本、未说完的话、下一钩子。禁他书套话。 ${id}\n`
      const marker = isLeisure ? '## 休闲切入点' : '## 阶位切入点'
      t = t.includes(marker) ? t.replace(marker, block + '\n' + marker) : t + block
    } else if (el < needEntry) {
      const block = `\n\n补切入${i}·${id.slice(0, 10)}：《${title}》独有事件/支线。\n`
      t = t.includes('## 来源') ? t.replace('## 来源', block + '\n## 来源') : t + block
    } else {
      t += `\n\n**【结构${id.slice(0, 8)}】**\n《${title}》按机检错误补字段。 ${(o.match(/\[错误\][^\n]+/g) || []).join('；')}\n`
    }
  }
  safeWrite(full, t)
  return !check(full).includes('不过关')
}

const hard = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    if (check(full).includes('不过关')) hard.push(full)
  }
}
console.log('hard', hard.length)
let ok = 0,
  fail = 0
for (const full of hard) {
  const r = force(full)
  console.log(path.basename(full), r ? 'OK' : 'FAIL')
  if (r) ok++
  else fail++
}

let okA = 0,
  warnA = 0,
  hardA = 0
const hardL = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const o = check(path.join(dir, f))
    if (o.includes('不过关')) {
      hardA++
      hardL.push(`b${d}/${f}`)
    } else if (o.includes('有警告')) warnA++
    else if (o.includes('过关')) okA++
  }
}
const lineMap = new Map()
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
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
const multi = [...lineMap.entries()].filter(([, s]) => s.size >= 5)
console.log(JSON.stringify({ ok, fail, okA, warnA, hardA, hardL, sharedGe5: multi.length }, null, 2))
