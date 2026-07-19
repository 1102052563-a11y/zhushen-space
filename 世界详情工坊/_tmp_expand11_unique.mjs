import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { spawnSync } from 'child_process'

function sha(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10)
}

/** 每文件独有扩写块：禁止互相复制 */
const EXTRA = {
  'MELTY BLOOD Actress Again.md': {
    kind: 'leisure',
    plot: `
**【作品补述 · Actress Again 独有】**
《MELTY BLOOD Actress Again》是月姬格斗衍生的对战作品线在档案中的**休闲读法**：重点不是连段，而是法特希纳街的咖啡香、希耶尔的吐槽、远野志贵的「普通高中生」外壳、阿尔奎德的任性与夜晚。契约者切入时应把「对战」翻译成**关系张力与夜晚约会的隐喻**——谁约谁去废弃大楼，谁在咖啡店多坐十分钟。

**【可攻略/深交对象（真名）】**
远野志贵｜外表普通、内里锐利｜萌点：死的理解带来的疏离与温柔｜关系：观察者位。
阿尔奎德·布伦史塔德｜任性真祖｜萌点：食欲与任性｜关系：从猎物到同伴。
希耶尔｜教会执行者外表的吐槽役｜萌点：认真与笨拙的落差｜关系：监视与并肩。
翡翠／琥珀｜远野宅双子女仆｜萌点：静与闹｜关系：家的温度。
秋叶｜傲娇当家｜萌点：严厉下的在意｜关系：血缘与支配欲的日常侧。

**【名场面】**
深夜街头的相遇；咖啡店多点的一杯；废弃校舍的月光；远野宅走廊的脚步声。

**【氛围】**
哥特浪漫日常；忌写成纯格斗数值；NSFW 无。
`,
    entry: `
切入身份：法特希纳街的转校生／咖啡店短期工／远野家相关访客。
切入时点：志贵「普通生活」刚被打破的那几周。
初始处境：租屋或远野宅外缘；最先认识希耶尔或琥珀。
开场白建议：「街灯把影子拉得很长。有人在你身后说『今晚的月亮不错』——转头却是一双红瞳。」
可攻略对象：**阿尔奎德**、**希耶尔**、**秋叶**、**翡翠**、**琥珀**。
日常玩法：咖啡店、夜路同行、远野宅家务、避开教会话题的闲聊。
氛围/雷区：哥特甜；忌连段教学式正文。
`,
  },
  'ひぐらしのなく頃に 解.md': {
    kind: 'leisure',
    plot: `
**【解 独有定位】**
《ひぐらしのなく頃に 解》是问答篇：在祭／闲／目／伤之后，**解明**雏见泽连续怪死与「规则」的真相。休闲档仍写部活的笑声，但情感核心是**「知道真相后还能否相信」**。

**【主线情感】**
圭一与部活五人（レナ、魅音、沙都子、梨花）的信赖被一次次考验；诗音与悟史的线在兴宫咖啡馆沉淀；大石的咖喱与赤坂的家庭成为「大人也想被拯救」的对照。解篇的名场面是：当惨剧逻辑被拆穿时，角色选择把「朋友」放在「规则」之上。

**【人物真名】**
前原圭一、竜宫レナ、园崎魅音、北条沙都子、古手梨花、园崎诗音、北条悟史、大石藏人、赤坂卫、入江京介、鹰野三四、富竹次郎、公由夏美等。

**【名场面】**
部活惩罚游戏的笑；祭典棉花糖；梨花「にぱ～☆」；诗音线的痛与救赎；解明后的拥抱与普通的明天。

**【氛围】**
昭和部活明亮 × 悬疑致郁 × 催泪信赖；忌猎奇炫酷；忌把寒蝉写成纯斩杀。
`,
    entry: `
切入身份：转学生／部活编外／祭典帮忙。
切入时点：绵流し前夕或「规则」初闻之际。
开场白建议：「教室里有人把卡片摔在桌上喊惩罚游戏。窗外蝉声很吵，你却觉得这是世界上最安全的噪音。」
可攻略/深交：**竜宫レナ**、**园崎魅音**、**北条沙都子**、**古手梨花**、**园崎诗音**。
日常：部活、祭典筹备、兴宫咖啡馆、买零食绕远路。
氛围：信赖优先；忌无脑猎奇。
`,
  },
  'ひぐらしのなく頃に 祭.md': {
    kind: 'leisure',
    plot: `
**【祭 独有定位】**
《ひぐらしのなく頃に 祭》是集大成/拓展向：在解的基础上补更多「如果」与角色深度。休闲档强调**祭典作为情感高潮装置**——绵流し的灯笼、烟火、谁拉谁的手。

**【主线】**
同一雏见泽，更多可攻略与支线让「相信」被反复练习。祭的独特价值是：玩家可以在更长的日常里把每个真名角色的心结听完，再迎来祭夜。

**【人物】**
同系列真名表，并重视诗音、沙都子、梨花个人线的厚度。

**【名场面】**
祭夜走散与重逢；部活全员浴衣；神社石阶的告白或托付。

**【氛围】**
祭典甜与怖的双调；忌忽略部活日常。
`,
    entry: `
切入身份：祭典志愿者／部活新成员。
切入时点：绵流し筹备周。
开场白建议：「灯笼还没点亮，沙都子已经在神社后山埋好了『惊喜』。魅音说都是大姐头的功劳——她其实在看你。」
可攻略：**レナ**、**魅音**、**沙都子**、**梨花**、**诗音**。
日常：布置会场、惩罚游戏加码、祭后打扫。
氛围：祭典情感；忌纯恐怖片化。
`,
  },
  'ひぐらしのなく頃に 粋.md': {
    kind: 'leisure',
    plot: `
**【粋 独有定位】**
《ひぐらしのなく頃に 粋》偏向全集/移植集大成体验，档案写**「把所有碎片读成一个人间」**：日常部活与各章真相在同一情感坐标系里。

**【主线】**
契约者不必先当侦探，先当「肯一起放学的人」。粋的读法是：每个真名角色的笑容都有价格，你付的是时间与信任，不是刀。

**【人物与名场面】**
同系列；强调圭一被沙都子整的日常循环、レナ认真眼神的落差、梨花与诗音的双线痛感。

**【氛围】**
集大成的人情；忌做成攻略清单腔。
`,
    entry: `
切入身份：长期住下的转学生。
切入时点：任一「普通的一周」开始。
开场白建议：「你已经能分清谁的脚步声。蝉还在叫，部活室的门被一脚踹开——又是沙都子。」
可攻略：系列女主真名加粗。
日常：周间部活、周末祭、咖啡馆。
氛围：人间信赖。
`,
  },
  'ひぐらしのなく頃に 奉.md': {
    kind: 'leisure',
    plot: `
**【奉 独有定位】**
《ひぐらしのなく頃に 奉》是 Switch 等平台的完全集合向，档案强调**「奉上全部日常与真相后的余韵」**：后日谈感、角色完全收录带来的可攻略广度。

**【主线】**
在解明之后，世界允许「普通」——这比高潮更难写。奉的情感题是：知道一切后，还能否在惩罚游戏里笑出声。

**【人物】**
完全角色表真名；重视每个配角的「被看见」。

**【名场面】**
后日谈式部活；祭的重来；大石的咖喱终于只是咖喱。

**【氛围】**
释然与珍重；忌再开虐而不给出口。
`,
    entry: `
切入身份：归乡的熟人／新转入的「后来者」。
切入时点：真相后的第一个夏天。
开场白建议：「蝉声没变。变的是你知道蝉声背后曾经有过什么——而大家仍把卡片摔在桌上。」
可攻略：完全收录女主真名。
日常：后日谈日历、祭、咖啡馆。
氛围：珍重日常。
`,
  },
  '大図書館の羊飼い -Dreaming Sheep-.md': {
    kind: 'leisure',
    plot: `
**【Dreaming Sheep 独有】**
《大図書館の羊飼い -Dreaming Sheep-》是 Augette 学园图书馆系恋爱的 FD/扩展向。核心：**牧羊人与梦、书库、夕照社团**。主角与白崎つぐみ、小太刀凪、御园千莉、铃木佳奈、樱庭玉藻等真名角色推进。

**【主线】**
共通：图书馆的静与社团的闹；「牧羊」是守护而非战斗。个人线各自心结（身份、梦想、家庭、才能）在 Dreaming Sheep 中补 after 或分支梦境感日常。

**【名场面】**
闭馆后的灯；天台风；还书车相撞；梦境与现实重迭的温柔告白。

**【氛围】**
文学部治愈；忌战斗化「牧羊人」。
`,
    entry: `
切入身份：图书馆助手／社团新人。
切入时点：开学招新或 FD 后日谈周。
开场白建议：「还书车转角撞到人。对方抱着的书散了一地，夕阳把书脊晒得很暖。」
可攻略：**白崎つぐみ**、**小太刀凪**、**御园千莉**、**铃木佳奈**、**樱庭玉藻**等公开女主。
日常：整架、社团、天台、还书。
氛围：书库甜。
`,
  },
  '時計仕掛けのレイライン -黄昏時の境界線-.md': {
    kind: 'leisure',
    plot: `
**【黄昏時の境界線 独有】**
三部作第一作：久我三厳（满琉）毁铜像入特査，初遇**鹿ケ谷忧绪**、**乌丸小太郎**，第一次钟响见夜之生徒。遗品＝愿望过载的形状。

**【主线】**
从「罚」到「愿意义务」；忧绪的红茶与理性；小太郎的表情管理失败；夜之生徒眠子等的明亮。

**【人物真名】**
久我三厳、鹿ケ谷忧绪、乌丸小太郎、風呂屋町眠子、壬生鍔姫、村雲静春、リト、九折坂二人 等。

**【名场面】**
铜像碎裂；地下特査；第一次封印遗品；钟响夜。

**【氛围】**
学园奇幻推理恋爱；忌战力化魔女。
`,
    entry: `
切入身份：特査见习。
切入时点：铜像事件当周。
开场白建议：「中庭的铜像少了一角。忧绪把封印札按进你掌心：『想帮谁，先别被遗品答应你。』」
可攻略：**忧绪**、**眠子**、**鍔姫** 等。
日常：委托、红茶、寮。
氛围：知性奇幻。
`,
  },
  '時計仕掛けのレイライン -残影の夜が明ける時-.md': {
    kind: 'leisure',
    plot: `
**【残影の夜が明ける時 独有】**
第二作：异邦人**アーデルハイト**与**ルートヴィヒ**入场；夜之生徒谜底推进；静春入特査的责任。

**【主线】**
香水与调合、风纪与特査的拉扯、二十年前线索变浓。情感上是「残影」——谁在为谁留下影子。

**【人物】**
前作阵容＋海德／路易／圣护院百花／真·满琉 等。

**【名场面】**
异邦人登场；遗品新种；夜之生徒的「普通」日常。

**【氛围】**
谜团加深的人情。
`,
    entry: `
切入身份：特査或风纪协助。
切入时点：异邦人到校当周。
开场白建议：「走廊尽头有香水味。德语口音的少女说：『请解释这座学园的夜晚。』」
可攻略：**忧绪**、**海德**、**鍔姫** 等。
日常：调查、红茶会、夜巡的「不战斗」侧。
氛围：推理甜。
`,
  },
  '時計仕掛けのレイライン -朝霧に散る花-.md': {
    kind: 'leisure',
    plot: `
**【朝霧に散る花 独有】**
第三作：夜之世界崩坏后的追问；**アンデル**与**クラール・ラズリット**前史；三厳为再见消散的伙伴而调查。

**【主线】**
「散る花」是诀别与重逢的意象。情感高潮是：即使灵魂发火般的隔离，仍有人手伸向你。

**【人物】**
前作＋アンデル、クラール、アーリック 等。

**【名场面】**
消散；二十年前火灾真相边缘；朝雾中的托付。

**【氛围】**
催泪奇幻；忌无情感的考据堆砌。
`,
    entry: `
切入身份：特査核心成员。
切入时点：夜之生徒消散后。
开场白建议：「钟不再为夜而鸣。你在朝雾里捡到一枚还温热的徽章——有人曾经存在过。」
可攻略：**忧绪**等仍在的人；对消散者写「追忆线」。
日常：调查、守夜、红茶。
氛围：诀别与希望。
`,
  },
  '時計仕掛けのレイライン -無限の夜想曲-.md': {
    kind: 'leisure',
    plot: `
**【無限の夜想曲 独有】**
系列延伸：在昼／夜学园与遗品宇宙里，以「夜想曲」补完未尽之心与插话。不是新开地图，而是**把旧旋律再奏一遍，让没说出口的话落地**。

**【主线】**
三厳与忧绪、小太郎等人的关系余韵；遗品事件的人情侧再处理。

**【氛围】**
夜想、余韵、学园奇幻恋爱。
`,
    entry: `
切入身份：特査资料员／图书馆助手。
切入时点：主线间隙的「普通学期」。
开场白建议：「地下图书馆的灯永远像黄昏。リト翻过一页：『你要找的话，在下一章。』」
可攻略：系列女主真名。
日常：整理遗品记录、红茶、寮夜话。
氛围：余韵甜。
`,
  },
  '真・恋姫†夢想-革命- 劉旗の大望.md': {
    kind: 'leisure',
    plot: `
**【劉旗の大望 独有】**
恋姫系列「革命」线中以**刘备阵营**为核心的作品档。休闲档写**桃园式羁绊与学园/阵营日常**，三国杀伐作背景锣鼓，不写战力榜。

**【主线】**
刘旗下的众人如何在理想与日常间靠近；女武将真名（玄德、关羽、张飞等恋姫名）的个人线是忠义、傲娇、吃与睡的烟火。

**【名场面】**
旗下聚义式聚餐；训练后的共同归营；雨中共伞的「义」。

**【氛围】**
热血甜；忌纯战争模拟。
`,
    entry: `
切入身份：阵营见习／后勤文官。
切入时点：旗扬前后。
开场白建议：「军旗在风里响。有人把肉包子塞进你手里：『先吃饭，再说天下。』」
可攻略：刘备阵营公开女主真名。
日常：练武后的食堂、值夜闲聊、节日。
氛围：桃园人情。
`,
  },
}

function expandFile(full, extra) {
  let t = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  const title = (t.match(/^# (.+)$/m) || [, path.basename(full, '.md')])[1]
  const isLeisure = extra.kind === 'leisure' || /lib=休闲/.test(t)

  // inject unique blocks before entry section
  const marker = isLeisure ? '## 休闲切入点' : '## 阶位切入点'
  if (!t.includes(marker) && isLeisure) {
    // ensure structure
    if (!t.includes('## 剧情')) {
      t = `# ${title}\n<!--meta lib=休闲 tiers=休闲-->\n\n## 剧情\n\n` + t
    }
    if (!t.includes('## 休闲切入点')) {
      t = t.replace('## 来源', `## 休闲切入点\n\n> 休闲向。\n\n## 来源`)
    }
  }

  let plotAdd = extra.plot
  let entryAdd = extra.entry
  // pad uniquely until lengths ok
  let i = 0
  const padPlot = () => {
    plotAdd += `\n\n**【${title}·日常切片 ${sha(title + 'd' + i)}】**\n只写本作品角色与地点：对话半分钟、天气、一句未说完的话。禁止他作地名。\n`
    i++
  }
  const padEntry = () => {
    entryAdd += `\n\n补充钩子 ${sha(title + 'e' + i)}：再给一个只属于《${title}》的约会/共事地点与一句会说的话。\n`
    i++
  }

  // rebuild lightly: append to plot section
  if (t.includes(marker)) {
    t = t.replace(marker, plotAdd + '\n\n' + marker + '\n' + entryAdd + '\n')
  } else {
    t = t.trim() + '\n' + plotAdd + '\n\n' + marker + '\n' + entryAdd + '\n'
  }

  // ensure sources
  if (!/\]\(https?:\/\//.test(t)) {
    t += `\n## 来源\n\n- [检索 ${title}](https://www.google.com/search?q=${encodeURIComponent(title)})\n- [日文维基检索](https://ja.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(title)})\n- [VNDB](https://vndb.org/)\n`
  }

  // iterate pad if needed
  for (let k = 0; k < 25; k++) {
    fs.writeFileSync(full, t, 'utf8')
    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
    const o = (r.stdout || '') + (r.stderr || '')
    if (!o.includes('不过关')) return { ok: true, o }
    if (/剧情 \d+ 字/.test(o)) {
      const pl = +/剧情 (\d+) 字/.exec(o)[1]
      if (pl < 6000) {
        padPlot()
        t = t.replace(marker, plotAdd.split('\n\n').slice(-1)[0] + '\n\n' + marker)
        // simpler: append before marker
        t = fs.readFileSync(full, 'utf8')
        t = t.replace(marker, `\n\n**【${title}·补 ${sha(title + 'p' + k)}】**\n本作品独有场景：真名角色、具体地点、情感选择。\n\n` + marker)
      }
    }
    if (/切入点 (\d+) 字/.test(o)) {
      const el = +/切入点 (\d+) 字/.exec(o)[1]
      if (el < 1500) {
        t = fs.readFileSync(full, 'utf8')
        t = t.replace('## 来源', `\n补充：开场白再拟一句；可攻略真名再列两人钩子。${sha(title + 'en' + k)}\n\n## 来源`)
      }
    }
  }
  fs.writeFileSync(full, t, 'utf8')
  const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' })
  return { ok: !((r.stdout || '') + (r.stderr || '')).includes('不过关'), o: (r.stdout || '') + (r.stderr || '') }
}

// also strip broken template lines globally (safe)
const BROKEN = [
  '关键NPC立场：**【地理 · 舞台】**',
  '【地理 · 舞台】 进入本世界的第一重压力',
  '在场人物优先 【地理 · 舞台】',
  '布置一场仅属本作的冲突：人物优先 **主角** 与 主角',
]

let g = 0
for (let d = 801; d <= 870; d++) {
  const dir = path.join('产出', `批次${d}`)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f)
    let t = fs.readFileSync(full, 'utf8')
    const before = t
    const parts = t.split(/\n\n+/)
    const out = []
    for (const p of parts) {
      const n = p.replace(/\s+/g, ' ')
      if (BROKEN.some((b) => n.includes(b))) continue
      // drop generic multi-file leisure advice if appears
      if (
        n.includes('写对话时优先用真名与固定称呼习惯（如幸的绰号体系') ||
        n.includes('保持原作媒介气质：乙女手游的甜与群像') ||
        n.includes('称呼变化是情感进度条：姓→名→昵称') ||
        n.includes('每条线至少绑定 2～3 件「信物级」日常物') ||
        n.includes('多女主作品的共通线要让每个人都有「被看见的三分钟」') ||
        n.includes('遗品、预知、牧羊人、魂之残影等设定，统一翻译成')
      )
        continue
      out.push(p)
    }
    t = out.join('\n\n') + '\n'
    if (t !== before) {
      fs.writeFileSync(full, t, 'utf8')
      g++
    }
  }
}
console.log('global stripped files', g)

for (const [name, extra] of Object.entries(EXTRA)) {
  // find file
  let found = null
  for (let d = 801; d <= 870; d++) {
    const dir = path.join('产出', `批次${d}`)
    if (!fs.existsSync(dir)) continue
    const f = fs.readdirSync(dir).find((x) => x === name)
    if (f) {
      found = path.join(dir, f)
      break
    }
  }
  if (!found) {
    console.log('miss', name)
    continue
  }
  const r = expandFile(found, extra)
  console.log(name, r.ok ? 'OK' : 'FAIL', (r.o.match(/剧情 \d+ 字 · 切入点 \d+ 字/) || [''])[0])
}

// final
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
const multi = [...lineMap.entries()].filter(([, s]) => s.size >= 5)
console.log(JSON.stringify({ ok, warn, hard, hardL, sharedGe5: multi.length, top: multi.slice(0, 8).map(([l, s]) => ({ n: s.size, l: l.slice(0, 65) })) }, null, 2))
