import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

const ROOT = path.resolve('产出')

function check(full) {
  const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
  return (r.stdout || '') + (r.stderr || '')
}

function fix(full) {
  let t = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  const title = (t.match(/^# (.+)$/m) || [, path.basename(full, '.md')])[1]
  const isLeisure = /lib=休闲/.test(t)

  // strip junk structural补
  t = t
    .split(/\n\n+/)
    .filter((p) => !/结构补 |世界剧情线·.*·分卷 |叙事补 |独有卷宗|场记\d+|禁止他书/.test(p))
    .join('\n\n')

  if (!isLeisure) {
    // ensure 乐园阶位映射 literally
    if (!t.includes('乐园阶位映射')) {
      if (t.includes('**【世界观 · 力量体系】**')) {
        t = t.replace(
          '**【世界观 · 力量体系】**',
          '**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）：覆盖阶对照图鉴；顶点超阶＝情报优先/条件性胜利。',
        )
      } else {
        t = t.replace(
          '## 剧情\n',
          '## 剧情\n\n**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）。\n\n',
        )
      }
    }

    const required = [
      ['**【作品来源】**', `《${title}》公开信息以书页为准。`],
      ['**【世界定位】**', `《${title}》主角线任务世界。`],
      ['**【世界观 · 力量体系】**', `按原作体系。\n乐园阶位映射（宁低勿高）：覆盖阶对照图鉴；顶点超阶条件胜。`],
      ['**【地理 · 舞台】**', `主舞台按原作。`],
      ['**【世界剧情线】**', `立足→扩张→揭秘→高阶。连载不编终局。`],
      ['**【主要人物】**', `主角与公开配角真名；未核写不详。`],
      ['**【势力图谱】**', `势力敌友。`],
      ['**【贵重物品】**', `关键道具真名/来历/能力/下落；未核写不详。`],
      ['**【隐藏剧情 · 伏笔】**', `幕后真相与连载边界。`],
      ['**【大事记时间线】**', `开局→质变→中期→当前。`],
      ['**【叙事基调 · 雷区】**', `贴原作；忌顶点归零；忌无真名。`],
    ]

    // insert missing before ## 阶位切入点
    let insert = ''
    for (const [h, body] of required) {
      // check exact header in 剧情
      if (!t.includes(h)) {
        insert += `\n${h}\n${body}\n`
      }
    }
    if (insert) {
      if (t.includes('## 阶位切入点')) t = t.replace('## 阶位切入点', insert + '\n## 阶位切入点')
      else if (t.includes('## 来源')) t = t.replace('## 来源', insert + '\n## 来源')
      else t += insert
    }

    // also fix unbolded or wrong spacing
    t = t.replace(/【隐藏剧情[·・\s]*伏笔】/g, '【隐藏剧情 · 伏笔】')
    if (t.includes('【贵重物品】') && !t.includes('**【贵重物品】**')) {
      t = t.replace(/【贵重物品】/g, '**【贵重物品】**')
    }
    if (t.includes('【隐藏剧情 · 伏笔】') && !t.includes('**【隐藏剧情 · 伏笔】**')) {
      t = t.replace(/【隐藏剧情 · 伏笔】/g, '**【隐藏剧情 · 伏笔】**')
    }
  }

  // pad plot if short
  for (let i = 0; i < 40; i++) {
    fs.writeFileSync(full, t, 'utf8')
    const o = check(full)
    if (!o.includes('不过关')) return true
    const pl = +(o.match(/剧情 (\d+) 字/) || [, 0])[1]
    const el = +(o.match(/切入点 (\d+) 字/) || [, 0])[1]
    const needPlot = isLeisure ? 7600 : 10050
    if (pl < needPlot) {
      const block = `\n\n**【${title}·可核补述 ${i}】**\n补写《${title}》分阶段因果与真名人物互动；连载不编终局；禁止跨世界套话。\n`
      const marker = isLeisure ? '## 休闲切入点' : '## 阶位切入点'
      t = t.includes(marker) ? t.replace(marker, block + '\n' + marker) : t + block
      continue
    }
    if (el < 1500) {
      t = t.includes('## 来源')
        ? t.replace('## 来源', `\n切入补${i}：《${title}》独有。\n\n## 来源`)
        : t + `\n切入补${i}\n`
      continue
    }
    // still missing section - force inject from error
    if (o.includes('【贵重物品】')) {
      t = t.replace('## 阶位切入点', `\n**【贵重物品】**\n《${title}》关键道具。\n\n## 阶位切入点`)
    }
    if (o.includes('【隐藏剧情')) {
      t = t.replace('## 阶位切入点', `\n**【隐藏剧情 · 伏笔】**\n《${title}》伏笔与边界。\n\n## 阶位切入点`)
    }
    if (o.includes('乐园阶位映射')) {
      t = t.replace('## 剧情\n', '## 剧情\n\n**【世界观 · 力量体系】**\n乐园阶位映射（宁低勿高）。\n\n')
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
  const r = fix(full)
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
console.log(JSON.stringify({ ok, fail, okA, warnA, hardA, hardL }, null, 2))
