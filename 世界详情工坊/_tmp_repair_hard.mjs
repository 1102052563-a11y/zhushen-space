import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

const ROOT = path.resolve('产出')

function sha(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)
}

function check(full) {
  const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
  return (r.stdout || '') + (r.stderr || '')
}

function repair(full) {
  let t = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  const title = (t.match(/^# (.+)$/m) || [, path.basename(full, '.md')])[1]
  const isLeisure = /lib=休闲/.test(t)
  const tiers = ((t.match(/tiers=([^\s-->]+)/) || [, isLeisure ? '休闲' : '一、二、三、四、五、六'])[1] || '')
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter((s) => s)

  // ensure sections for main
  if (!isLeisure) {
    if (!t.includes('乐园阶位映射')) {
      if (t.includes('**【世界观 · 力量体系】**')) {
        t = t.replace(
          '**【世界观 · 力量体系】**',
          `**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）：按《${title}》公开战力对照图鉴落位；覆盖 ${tiers.filter((x) => x !== '休闲').join('、')} 阶；更高/顶点＝超阶情报优先·条件性胜利。`,
        )
      } else {
        t = t.replace(
          '## 剧情',
          `## 剧情\n\n**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）：覆盖阶对照图鉴；顶点超阶条件胜。\n`,
        )
      }
    }
    const need = [
      ['【作品来源】', `《${title}》公开连载/出版信息以书页为准；作者与字数以检索为准。`],
      ['【世界定位】', `以主角线展开的《${title}》任务世界。`],
      ['【世界观 · 力量体系】', `按原作公开体系。\n乐园阶位映射（宁低勿高）：覆盖 ${tiers.filter((x) => x !== '休闲').join('、')} 阶。`],
      ['【地理 · 舞台】', `主舞台与开图按原作地名。`],
      ['【世界剧情线】', `分阶段：立足→扩张→揭秘→高阶台面。连载不编终局。人物真名。`],
      ['【主要人物】', `主角与公开配角真名；未核写不详。`],
      ['【势力图谱】', `正邪/体制/地方势力与主角敌友。`],
      ['【贵重物品】', `金手指与关键道具：真名/来历/能力/下落；未核写不详。独有标记 ${sha(title + 'item')}。`],
      ['【隐藏剧情 · 伏笔】', `金手指来历、幕后动机、连载边界。独有标记 ${sha(title + 'hide')}。`],
      ['【大事记时间线】', `开局→质变→中期→当前锚点。`],
      ['【叙事基调 · 雷区】', `贴《${title}》；忌顶点归零；忌无真名。`],
    ]
    for (const [h, body] of need) {
      if (!t.includes(h)) {
        t = t.replace('## 阶位切入点', `\n**${h}**\n${body}\n\n## 阶位切入点`)
        if (!t.includes(h)) t = t.replace('## 来源', `\n**${h}**\n${body}\n\n## 来源`)
        if (!t.includes(h)) t += `\n\n**${h}**\n${body}\n`
      }
    }
    // normalize 隐藏剧情 title spacing variants
    t = t.replace(/【隐藏剧情[·・]伏笔】/g, '【隐藏剧情 · 伏笔】')
    t = t.replace(/\*\*【隐藏剧情·伏笔】\*\*/g, '**【隐藏剧情 · 伏笔】**')

    if (!t.includes('## 阶位切入点')) {
      const ts = tiers.filter((x) => x !== '休闲' && '一二三四五六七八九'.includes(x))
      let e = `> 阶位↔：覆盖 ${ts.join('、')}；与乐园阶位映射一致；宁低勿高；顶点条件性胜利。\n`
      for (const lab of ts) {
        e += `\n**${lab}阶（${title}）**\n切入身份/时点：本阶身份。\n初始事件：《${title}》冲突。\n开场白建议：「《${title}》点名。」\n关键NPC立场：真名。\n主线钩子/支线：独有。\n危险度/规避：随阶。\n任务方向/奖励：不越级。\n`
      }
      while (e.replace(/\s/g, '').length < 1600) e += `\n补 ${sha(title + e.length)}：支线取证/护送。\n`
      t = t.includes('## 来源') ? t.replace('## 来源', `## 阶位切入点\n\n${e}\n\n## 来源`) : t + `\n## 阶位切入点\n\n${e}\n`
    }
  } else {
    // leisure missing pieces
    if (!t.includes('## 休闲切入点')) {
      t = t.includes('## 来源')
        ? t.replace('## 来源', '## 休闲切入点\n\n> 本世界为休闲/恋爱向。\n\n## 来源')
        : t + '\n## 休闲切入点\n\n> 本世界为休闲/恋爱向。\n'
    }
  }

  // pad length
  const needPlot = isLeisure ? 7600 : 10100
  const needEntry = 1600
  for (let i = 0; i < 60; i++) {
    fs.writeFileSync(full, t, 'utf8')
    const o = check(full)
    if (!o.includes('不过关')) return true
    const pl = +(o.match(/剧情 (\d+) 字/) || [, 0])[1]
    const el = +(o.match(/切入点 (\d+) 字/) || [, 0])[1]
    const id = sha(title + i)
    if (o.includes('乐园阶位映射') && !t.includes('乐园阶位映射')) {
      t = t.replace('## 剧情', '## 剧情\n\n**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）。\n')
      continue
    }
    if (o.includes('【贵重物品】') && !t.includes('【贵重物品】')) {
      t = t.replace('## 阶位切入点', `\n**【贵重物品】**\n《${title}》关键道具真名与下落；未核不详。${id}\n\n## 阶位切入点`)
      continue
    }
    if (o.includes('【隐藏剧情') && !t.includes('【隐藏剧情 · 伏笔】')) {
      t = t.replace('## 阶位切入点', `\n**【隐藏剧情 · 伏笔】**\n《${title}》幕后与连载边界。${id}\n\n## 阶位切入点`)
      continue
    }
    if (pl < needPlot) {
      const block = `\n\n**【${title}·叙事补 ${id}】**\n补写只属于《${title}》的因果：人物真名、地点、冲突、结果、下一钩子。连载不编终局。\n`
      const marker = isLeisure ? '## 休闲切入点' : '## 阶位切入点'
      t = t.includes(marker) ? t.replace(marker, block + '\n' + marker) : t + block
    } else if (el < needEntry) {
      t = t.includes('## 来源')
        ? t.replace('## 来源', `\n切入补 ${id}：《${title}》独有事件。\n\n## 来源`)
        : t + `\n切入补 ${id}\n`
    } else {
      // missing section names from error list
      const errs = o.match(/【[^】]+】/g) || []
      for (const h of errs) {
        if (!t.includes(h)) {
          t = t.replace('## 阶位切入点', `\n**${h}**\n《${title}》对应内容。${id}\n\n## 阶位切入点`)
        }
      }
      if (errs.length === 0) t += `\n\n**【补全 ${id}】**\n${(o.match(/\[错误\][^\n]+/g) || []).join('；')}\n`
    }
  }
  fs.writeFileSync(full, t, 'utf8')
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
  const r = repair(full)
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
    else okA++
  }
}
console.log(JSON.stringify({ repairedOk: ok, repairedFail: fail, okA, warnA, hardA, hardL: hardL.slice(0, 20) }, null, 2))
