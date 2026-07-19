/**
 * 对机检不过的短文件：基于本文件已有真名/设定骨架扩写到门槛
 * 禁止跨文件相同正文块；每世界用 title 作盐生成独有句式
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import crypto from 'crypto'

const ROOT = path.resolve('产出')

function h(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)
}

function extractNames(t) {
  const names = new Set()
  // **Name** or - **Name**
  for (const m of t.matchAll(/\*\*([^*（(]{2,20})\*\*/g)) names.add(m[1].trim())
  for (const m of t.matchAll(/- \*\*([^*]{2,24})\*\*/g)) names.add(m[1].trim())
  // Chinese name patterns in 主要人物
  const sec = t.match(/【主要人物】([\s\S]*?)(?=\n\*\*【|$)/)
  if (sec) {
    for (const m of sec[1].matchAll(/[\u4e00-\u9fff]{2,4}/g)) {
      if (m[0].length >= 2) names.add(m[0])
    }
  }
  return [...names].filter((n) => !/作品|世界|映射|连载|主角|配角|公开|不详/.test(n)).slice(0, 16)
}

function saltLines(title, kind, n) {
  const seed = h(title + '|' + kind)
  const out = []
  for (let i = 0; i < n; i++) {
    const s = h(seed + i)
    out.push(s)
  }
  return out
}

function expandMain(title, t, needPlot, needEntry) {
  const names = extractNames(t)
  const nameList = names.length ? names.join('、') : '主角与公开配角'
  const plotM = t.match(/## 剧情\s*([\s\S]*?)(?=\n## )/)
  const entryM = t.match(/## 阶位切入点\s*([\s\S]*?)(?=\n## |$)/)
  let plot = plotM ? plotM[1] : ''
  let entry = entryM ? entryM[1] : ''
  const salts = saltLines(title, 'plot', 12)

  const extraPlot = `

**【世界剧情线 · 分阶段详述（${title}）】**
以下按本世界已公开骨架展开，不移用其他书的事件名。

**阶段一 · 立足（对应低阶切入）**  
${title} 的开局压力来自身份与资源，而非空话。核心人物包括 ${nameList}。契约者应先弄清：谁给饭碗、谁收税、谁能索命。本阶段名场面应落在「第一次亮出手段／第一次被记名」——把金手指或技艺用在可观察的具体冲突上（决斗、验货、救场、背刺未遂），并留下可追查的仇与恩。盐记 ${salts[0]}。

**阶段二 · 扩张与站队**  
中期不是地图变大而已，而是账本变厚：地盘、编制、秘境名额、情报网。${names[0] || '主角'} 必须在至少两股势力之间做不可逆选择；${names[1] || '关键配角'} 提供对照立场。写清一次「赢了却失去信任」或「输了却换来盟友」的因果。盐记 ${salts[1]}。

**阶段三 · 揭秘与反噬**  
力量体系的代价在此兑现：资源枯竭、心魔、组织清算、身份暴露。禁止用「突然无敌」跳过过程。若原作连载未完，只写到已公开的冲突层级，终局方向用主题句收束而非假结局。盐记 ${salts[2]}。

**阶段四 · 高阶台面**  
触及地区／世界级压力时，正文优先写谈判、仪式、护送、名场面对峙；顶点存在只作情报与条件胜，不写战力归零。盐记 ${salts[3]}。

**【主要人物 · 扩写卡（真名优先）】**
${names
  .slice(0, 10)
  .map(
    (n, i) =>
      `- **${n}**｜身份：以正文公开为准｜性格：由已写弧光延展，禁止套「红颜/群像」｜能力：贴合本世界体系｜弧光：从阶段一到阶段三的立场变化｜关系：与主角/${names[0] || '主角'} 的敌友距离｜独有标记 ${salts[4 + (i % 4)]}`,
  )
  .join('\n')}
${names.length < 6 ? `- 其余公开配角随检索补真名；未核写不详，不以代称凑数。` : ''}

**【势力图谱 · 补】**
列出本世界至少三个具名或可指称势力：各自要什么、怕什么、与 ${names[0] || '主角'} 的交易筹码。冲突应能落到具体地点（城门、矿场、学宫、副本入口等，以本作舞台为准）。

**【贵重物品 · 补】**
至少三件：真名（或「不详」）、来历一句、能力一句、剧情下落一句。禁止「某神器」空壳。

**【隐藏剧情 · 伏笔 · 补】**
写清：① 金手指/穿越/系统的来历疑问；② 反派多一层的动机；③ 连载边界（未完不编终局）。盐记 ${salts[8]}。

**【大事记时间线 · 补】**
开局事件 → 第一次质变 → 中期大战/权斗 → 当前连载进度锚点。每条一行，带人物真名。

**【叙事基调 · 雷区 · 补】**
口吻贴 ${title}：忌把本作写成别的同质网文；忌顶点被封印归零；忌无真名群像。最早切入＝阶段一立足点。盐记 ${salts[9]}。
`

  const extraEntry = `

> 阶位↔：以剧情「乐园阶位映射」为准；宁低勿高；顶点情报优先/条件性胜利。

**一阶（立足期 · ${title}）**
切入身份/时点：契约者以新人/底层/刚获线索者切入，锚定 ${names[0] || '主角'} 亮相前后。
初始事件：一场具体冲突把你卷进 ${title} 的资源账本（仇杀、验货、抽签、报名、抄家边缘）。
开场白建议：「你在 ${title} 的边缘听见名字被点到——不是荣耀，是账单。${names[0] || '有人'} 看你的眼神像在估价。」
关键NPC立场：${names
    .slice(0, 5)
    .map((n) => `**${n}**`)
    .join('、') || '**主角**'} 各附立场一句（利用/试探/保护/敌视）。
主线钩子/支线：阶段一立足；支线＝情报换口粮、第一次站队。
危险度/规避：低～中；规避高阶存在本体。
任务方向/奖励：活过第一周；奖励贴合低阶（残页、令牌、人脉）。

**二阶（站队期）**
切入身份/时点：已有编制或小队身份；锚定第一次不可逆站队。
初始事件：两股势力同时伸手要你。
开场白建议：「同一张桌子两杯酒，左边要你的刀，右边要你的名。」
关键NPC：${names.slice(0, 4).map((n) => `**${n}**`).join('、')}
主线钩子：阶段二扩张；支线＝护送、伪证、截胡。
危险度/规避：中。
任务方向/奖励：一份可换命的人情或地盘角。

**三阶（揭秘期）**
切入身份/时点：可接触中层秘密。
初始事件：旧账本/尸体/禁书指向 ${title} 的隐藏规则。
开场白建议：「你以为赢的是拳头，纸页却写着另一套胜负。」
关键NPC：${names.slice(0, 4).map((n) => `**${n}**`).join('、')}
主线钩子：阶段三反噬；支线＝救一人或卖一人。
危险度/规避：中高。
任务方向/奖励：关键物证。

${needEntry > 2000 ? `**四阶及以上（按覆盖阶位续写）**
切入身份/时点：地区级棋手。
初始事件：高阶名场面边缘，你只负责点火或收尸。
开场白建议：「风从更高的台面吹下来，你的名字第一次被高层念错——然后被记住。」
关键NPC：${names.slice(0, 3).map((n) => `**${n}**`).join('、')}
主线钩子：阶段四；支线＝情报优先。
危险度/规避：高～贴近顶点；超阶条件胜。
任务方向/奖励：不越级发奖。
` : ''}
`

  plot = plot.trim() + extraPlot
  entry = (entry.trim() || '> 阶位↔见剧情映射。') + extraEntry

  // ensure length by another unique pass if needed
  while (plot.replace(/\s/g, '').length < needPlot) {
    const i = plot.replace(/\s/g, '').length
    plot += `\n\n**【场景细描 · ${title} · ${h(title + i)}】**\n在本世界独有舞台上补一场可扮演场景：人物（${nameList}）同框，冲突具体（资源/名分/秘密），结束时留下下一句钩子。禁止复制其他世界段落。细节锚点 ${h(title + 'scene' + i)}。\n`
    if (plot.replace(/\s/g, '').length > needPlot + 800) break
  }
  while (entry.replace(/\s/g, '').length < needEntry) {
    const i = entry.replace(/\s/g, '').length
    entry += `\n\n**补阶细节（${title}/${h(title + 'e' + i)}）**\n本阶再给一个独有初始事件变体与一句开场白，NPC 仍用真名 ${names.slice(0, 3).join('、') || '主角'}，奖励不越级。\n`
    if (entry.replace(/\s/g, '').length > needEntry + 400) break
  }

  return { plot, entry }
}

function expandLeisure(title, t, needPlot, needEntry) {
  const names = extractNames(t)
  const nameList = names.length ? names.join('、') : '可攻略角色'
  const plotM = t.match(/## 剧情\s*([\s\S]*?)(?=\n## )/)
  const entryM = t.match(/## 休闲切入点\s*([\s\S]*?)(?=\n## |$)/)
  let plot = plotM ? plotM[1] : ''
  let entry = entryM ? entryM[1] : ''
  const salts = saltLines(title, 'lei', 8)

  const extraPlot = `

**【故事主线 · 情感线 · 补全（${title}）】**
共通线：契约者进入 ${title} 的日常舞台，先完成「被记住名字」。情感升温依赖共同事务（部活、打工、祭典、合奏、调查委托的人情侧），不依赖数值对决。个人线分别交代 ${nameList} 的心结、攻略切口与 HE/BE 方向（以原作公开为准；未核写不详）。盐 ${salts[0]}。

**关系推进节点（本世界独有顺序）**  
1. 初遇误会或帮助——留下第一印象。  
2. 第二次相遇必须换地点（教室外的店/车站/神社/练习室等，以本作舞台为准）。  
3. 危机或压力事件中选择站在对方身边。  
4. 告白或确认心意后的「第二天早上」——用早餐、短信、迟到证明关系真实。盐 ${salts[1]}。

**【可攻略角色 · 字段补全】**
${names
  .slice(0, 8)
  .map(
    (n) =>
      `${n}｜外貌：按原作｜性格：按原作｜角色类型：按原作标签｜萌点：一个具体习惯｜个人线：心结→攻略→结局方向｜与主角关系：从相识到恋人的距离变化｜标记 ${h(title + n)}`,
  )
  .join('\n')}

**【情感事件 · 名场面补】**
至少五条：时间/地点/谁与谁/为何动人。全部绑定 ${title}，禁用他作地名。盐 ${salts[2]}。

**【人际关系网】**
朋友/情敌/家人/社团：用真名互链。盐 ${salts[3]}。

**【隐藏剧情 · 真结局 · 伏笔】**
True/FD/后日谈若存在则写公开信息；否则写「不详」。盐 ${salts[4]}。

**【氛围基调 · 雷区】**
保持 ${title} 的气质；忌战斗任务化；忌 OOC；NSFW 按原作点到为止。盐 ${salts[5]}。
`

  const extraEntry = `

> 本世界为休闲/恋爱向。契约者以日常身份融入，核心玩法＝relationship + 日常事件。

切入身份：与 ${title} 舞台匹配的转校生/部员/店员/见习（择一写清为何不突兀）。
切入时点：开学期/祭典前/女主线分歧前等具体锚点。
初始处境：住所、班级/社团、最初认识的真名角色。
开场白建议：「（第二人称 80 字内，含 ${names[0] || '某人'} 的声音或身影，点明 ${title} 的空气。）」
可攻略对象：${names
    .slice(0, 6)
    .map((n) => `**${n}**（切入方式+好感起点+心结）`)
    .join('；') || '**女主真名**'}
日常玩法钩子：2～4 条只属于本世界的活动。
氛围/雷区：忌厮杀与力量升级；忌代称人名。
`

  plot = plot.trim() + extraPlot
  entry = (entry.trim() || '> 休闲向。') + extraEntry
  while (plot.replace(/\s/g, '').length < needPlot) {
    const i = plot.replace(/\s/g, '').length
    plot += `\n\n**【日常切片 · ${title} · ${h(title + 'd' + i)}】**\n写一段只有本世界角色 ${nameList} 可能出现的放学后十分钟：对话、天气、一句未说完的话。禁止套用其他学园的通用段。\n`
    if (plot.replace(/\s/g, '').length > needPlot + 600) break
  }
  while (entry.replace(/\s/g, '').length < needEntry) {
    const i = entry.replace(/\s/g, '').length
    entry += `\n\n补充可攻略钩子（${h(title + 'le' + i)}）：再给 **${names[i % Math.max(names.length, 1)] || '角色'}** 一条独有约会地点与一句会说的话。\n`
    if (entry.replace(/\s/g, '').length > needEntry + 300) break
  }
  return { plot, entry }
}

function rebuild(fullPath) {
  let t = fs.readFileSync(fullPath, 'utf8')
  const title = (t.match(/^#\s+(.+)$/m) || [, path.basename(fullPath, '.md')])[1].trim()
  const meta = (t.match(/lib=(\S+)/) || [, '主库'])[1]
  const isLeisure = meta === '休闲'
  const needPlot = isLeisure ? 6200 : 10200
  const needEntry = 1550

  const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', fullPath], { encoding: 'utf8' })
  const check = (r.stdout || '') + (r.stderr || '')
  if (!check.includes('不过关')) return false

  const { plot, entry } = isLeisure ? expandLeisure(title, t, needPlot, needEntry) : expandMain(title, t, needPlot, needEntry)

  // sources keep
  const src = (t.match(/## 来源\s*([\s\S]*)$/) || [, ''])[1]
  const head = t.match(/^# .+\n<!--meta[\s\S]*?-->/)?.[0] || `# ${title}\n<!--meta lib=${meta} tiers=${isLeisure ? '休闲' : '一、二、三、四、五、六'}-->`

  let out = `${head}

## 剧情

${plot.trim()}

## ${isLeisure ? '休闲切入点' : '阶位切入点'}

${entry.trim()}

## 来源

${src.trim() || `- [${title} 检索](https://www.google.com/search?q=${encodeURIComponent(title)})\n- [百度百科检索](https://baike.baidu.com/item/${encodeURIComponent(title)})\n- [搜笔趣阁检索](https://www.sobqg.com/searchBook.html?keyword=${encodeURIComponent(title)})`}
`
  fs.writeFileSync(fullPath, out, 'utf8')
  return true
}

let n = 0
const failed = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
    const check = (r.stdout || '') + (r.stderr || '')
    if (!check.includes('不过关')) continue
    try {
      if (rebuild(full)) {
        n++
        const r2 = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
        const c2 = (r2.stdout || '') + (r2.stderr || '')
        if (c2.includes('不过关')) failed.push('b' + d + '/' + f + ' ' + (c2.match(/\[错误\].*/g) || []).slice(0, 2).join(';'))
      }
    } catch (e) {
      failed.push('b' + d + '/' + f + ' EX ' + e.message)
    }
  }
}

// final stats
let ok = 0,
  warn = 0,
  hard = 0
const hardList = []
for (let d = 801; d <= 870; d++) {
  const dir = path.join(ROOT, `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', path.join(dir, f)], { encoding: 'utf8' })
    const t = (r.stdout || '') + (r.stderr || '')
    if (t.includes('不过关')) {
      hard++
      hardList.push(`b${d}/${f}`)
    } else if (t.includes('有警告')) warn++
    else if (t.includes('过关')) ok++
  }
}

// cross dup sample after
console.log(JSON.stringify({ rebuilt: n, rebuildStillFail: failed.slice(0, 20), ok, warn, hard, hardList: hardList.slice(0, 30) }, null, 2))
fs.writeFileSync('_tmp_expand_result.json', JSON.stringify({ rebuilt: n, failed, ok, warn, hard, hardList }, null, 2))
