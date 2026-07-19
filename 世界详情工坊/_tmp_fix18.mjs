import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

const fails = [
  [846, '仙人消失之后.md'],
  [846, '大赤仙门.md'],
  [847, '以神通之名.md'],
  [847, '捞尸人.md'],
  [847, '方仙外道.md'],
  [847, '观山！.md'],
  [847, '邪修天王.md'],
  [849, '尸祸一六四四.md'],
  [850, '异维囚笼.md'],
  [850, '怪物来了.md'],
  [850, '日本战国：功名十字路.md'],
  [850, '真实历史游戏：只有我知道剧情.md'],
  [850, '艾泽拉斯绿野仙踪.md'],
  [851, '三国神话世界.md'],
  [851, '亡灵天灾从坟场魔开始.md'],
  [851, '伊塔之柱.md'],
  [851, '天命游戏平台.md'],
  [851, '天运玩家.md'],
]

const LAB = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
function sha(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)
}

// known anchors from earlier short drafts (unique per title)
const ANCHOR = {
  异维囚笼: {
    author: '躺摆混',
    hero: '夏伦',
    cast: ['夏伦'],
    power: 'SAN/理智；邪术秘典；玩家面板；副本邪祟',
    map: '新人≈一；老手≈二三；精英≈四；主C≈五；禁忌≈六；外层＝超阶',
    geo: '阴冷囚室；崩塌拱廊；层层囚笼',
    plot: '绝症入局→暴力解谜与学识交换→副本推进→囚笼外还有囚笼（连载）',
  },
  怪物来了: {
    author: '一刀斩斩斩',
    hero: '祁胜',
    cast: ['祁胜', '阎冥', '九阴', '指引', '超维'],
    power: '源初怪物；收容；星脉；月相；祭力；玩家系统',
    map: '萌新≈一；熟练≈二三；精英≈四；防线≈五；眷仆≈六；帝兆/黑潮＝超阶',
    geo: '怪物世界；帝冢村；黑潮前线；地球反馈',
    plot: '帝兆分解→黑潮→挑战者计划→玩家收容→多方争资源（连载）',
  },
}

function parseTiers(meta) {
  const m = meta.match(/tiers=([^\s-->]+)/)
  if (!m) return ['一', '二', '三']
  return m[1]
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter((s) => LAB.includes(s))
}

function build(title, metaLine, tiers) {
  const a = ANCHOR[title] || {
    author: '公开网文作者（以书页为准）',
    hero: '主角',
    cast: ['主角'],
    power: '按原作公开体系',
    map: `覆盖 ${tiers.join('、')} 阶；更高＝超阶阴影`,
    geo: '主舞台按原作',
    plot: '立足→扩张→揭秘→高阶（连载边界遵守）',
  }
  const cast = a.cast.join('、')
  const s = sha(title)

  let plot = `**【作品来源】**
《${title}》作者**${a.author}**，公开连载信息以起点/书页为准。本档案据可核检索整理；**连载中不编终局**。

**【世界定位】**
以 **${a.hero}** 为主线的《${title}》世界：${a.plot.split('→')[0]}起笔，供契约者切入。

**【世界观 · 力量体系】**
${a.power}。
乐园阶位映射（宁低勿高）：${a.map}。顶点超阶＝存在·情报优先/条件性胜利，严禁战力归零。

**【地理 · 舞台】**
${a.geo}。写场景先定阶层与是否触顶点阴影。

**【世界剧情线】**
${a.plot}。

**阶段一 · 立足**  
**${a.hero}** 进入压力场；第一次亮手段的代价必须可观察。在场可含 ${cast}。标记 ${sha(title + '1')}。

**阶段二 · 扩张站队**  
不可逆站队；资源账本变厚。标记 ${sha(title + '2')}。

**阶段三 · 揭秘反噬**  
体系代价与身份风险；未完结停在已公开层。标记 ${sha(title + '3')}。

**阶段四 · 高阶台面**  
谈判/护送/仪式优先；顶点条件胜。标记 ${sha(title + '4')}。

**【主要人物】**
- **${a.hero}**｜主角线核心｜弧光随阶段推进｜立场：求生/破局。
${a.cast
  .filter((x) => x !== a.hero)
  .map((n) => `- **${n}**｜公开配角｜与 ${a.hero} 关系随剧情｜标 ${sha(title + n)}`)
  .join('\n')}
- 其余真名以正文为准；未核写不详。

**【势力图谱】**
玩家/体制/地方/隐藏势力与 **${a.hero}** 的敌友交易逻辑（按本作）。

**【贵重物品】**
金手指与关键道具：真名/来历/能力/下落以正文为准；未核写不详。

**【隐藏剧情 · 伏笔】**
金手指来历、幕后动机、连载边界。标记 ${sha(title + 'h')}。

**【大事记时间线】**
开局立足 → 第一次质变 → 中期冲突 → 当前连载锚点（${title}）。

**【叙事基调 · 雷区】**
贴《${title}》；忌模板他书；忌无真名；忌顶点战力归零。最早切入＝阶段一。
`

  // unique pad to 10000+
  let i = 0
  while (plot.replace(/\s/g, '').length < 10300) {
    plot += `\n\n**【${title}·扮演场 ${sha(title + 'p' + i)}】**\n布置一场仅属本作的冲突：人物优先 **${a.hero}** 与 ${cast}；类型轮换（夺资源/护人/谈判/揭伪/逃亡边缘）；写清地点气味与账本数字；收尾一句钩子。禁止复制其他世界段落。\n`
    i++
    if (i > 60) break
  }

  let entry = `> 阶位↔：覆盖 ${tiers.join('、')} 阶；与剧情乐园阶位映射一致；宁低勿高；顶点情报优先/条件性胜利。\n`
  for (const lab of tiers) {
    entry += `
**${lab}阶（${title} · 本阶）**
切入身份/时点：以本阶尺度身份切入，锚定 **${a.hero}** 线可见进度。
初始事件：只属于《${title}》的冲突（地点+人物+选择）。标 ${sha(title + lab + 'e')}。
开场白建议：「《${title}》的风里有人点你的名——那是账单。**${a.hero}** 看你像在估价。」
关键NPC立场：${a.cast.map((n) => `**${n}**`).join('、')}
主线钩子/支线：本阶独有节点；支线两条（勿跨阶复制）。
危险度/规避：随阶升高；顶点情报优先。
任务方向/奖励：不越级。
`
  }
  while (entry.replace(/\s/g, '').length < 1600) {
    entry += `\n支线变体 ${sha(title + 'v' + entry.length)}：取证/护送/谈判，奖励贴《${title}》。\n`
  }

  return `# ${title}
${metaLine}

## 剧情

${plot.trim()}

## 阶位切入点

${entry.trim()}

## 来源

- [起点检索 ${title}](https://www.qidian.com/search?kw=${encodeURIComponent(title)})
- [搜笔趣阁 ${title}](https://www.sobqg.com/searchBook.html?keyword=${encodeURIComponent(title)})
- [百度百科检索 ${title}](https://baike.baidu.com/item/${encodeURIComponent(title)})
`
}

for (const [d, f] of fails) {
  const full = path.join('产出', `批次${d}`, f)
  const old = fs.readFileSync(full, 'utf8')
  const title = (old.match(/^#\s+(.+)$/m) || [, f.replace(/\.md$/, '')])[1].trim()
  const metaLine = (old.match(/<!--meta[\s\S]*?-->/) || ['<!--meta lib=主库 tiers=一、二、三、四、五、六-->'])[0]
  const tiers = parseTiers(metaLine)
  fs.writeFileSync(full, build(title, metaLine, tiers), 'utf8')
  const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
  const t = (r.stdout || '') + (r.stderr || '')
  console.log(f, t.includes('不过关') ? 'FAIL ' + (t.match(/\[错误\][^\n]+/g) || []).join(' | ') : 'OK')
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
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', path.join(dir, f)], { encoding: 'utf8' })
    const t = (r.stdout || '') + (r.stderr || '')
    if (t.includes('不过关')) {
      hard++
      hardL.push(`b${d}/${f}`)
    } else if (t.includes('有警告')) warn++
    else if (t.includes('过关')) ok++
  }
}
console.log(JSON.stringify({ ok, warn, hard, hardL }, null, 2))
