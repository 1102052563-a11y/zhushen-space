import fs from 'fs'
import path from 'path'

function abort(filePath, title, reason, sources) {
  const src = sources.map((s) => `- ${s}`).join('\n')
  const body = `# ${title}
<!--meta lib=休闲 tiers=休闲 status=ABORT reason=age-policy-->

## ABORT

**原因：${reason}**

### 工坊铁则
核心亲密对象为未成年／学生性核心设定 → 不写剧情≥6000、不写切入≥1500、不展开 NSFW。

### 来源
${src}

---
**状态：ABORT**
**字数：0**
`
  fs.writeFileSync(filePath, body)
  console.log('ABORT', path.basename(filePath))
}

const roots = {
  eroi: '世界详情工坊/产出/批次759',
  hito: '世界详情工坊/产出/批次761',
  abandon: '世界详情工坊/产出/批次761',
  peep: '世界详情工坊/产出/批次751',
  seika: '世界详情工坊/产出/批次765',
  ruri: '世界详情工坊/产出/批次765',
}

function find(dir, re) {
  if (!fs.existsSync(dir)) return null
  return fs.readdirSync(dir).find((n) => re.test(n))
}

const jobs = [
  [
    roots.eroi,
    /エロ医師|えろいし/,
    'エロ医師',
    '核心为 JK／女子高生 对「エロ医師」的骗诊性剥削（系列公开设定），属未成年学生性核心。',
    [
      'https://www.getchu.com/',
      'https://www.bugbug.news/',
      'https://dlsoft.dmm.co.jp/',
    ],
  ],
  [
    roots.hito,
    /ビッチ|ヒトヅマ.*第4|第4話/,
    '初めてのヒトヅマ 第4話',
    '河合聡美等公开资料为 JK／高校生设定的成人向分话，核心为未成年学生性描写。',
    [
      'https://www.dlsite.com/pro/',
      'https://duga.jp/',
      'https://www.animecharactersdatabase.com/',
    ],
  ],
  [
    roots.abandon,
    /Abandon|あばんだん|100ヌキ/,
    'Abandon 第1話',
    '补习教室／女生徒设定的成人向，公开资料按高中生情境描写，属学生性核心。',
    [
      'https://www.bugbug.news/anime/82819/',
      'https://www.cmoa.jp/title/286222/',
      'https://www.dlsite.com/pro/',
    ],
  ],
  [
    roots.peep,
    /覗かされる|恥戯|追い込み/,
    '彼女 〜覗かされる恥戯・楓',
    '系列《のぞき彼女》枫线公开为 JK／セーラー服学园性核心，按年龄政策 ABORT。',
    [
      'https://zozovideo.com/',
      'https://ntr-ss.com/',
      'https://www.dmm.co.jp/',
    ],
  ],
  [
    roots.seika,
    /聖華|如月巴|竿おじさん/,
    '聖華女学院公認竿おじさん',
    '超名门女学院生徒×男娼设定，公开为女子校生性核心，ABORT。',
    [
      'https://dic.pixiv.net/a/聖華女学院公認竿おじさん',
      'https://www.lune-soft.jp/',
      'https://www.themoviedb.org/',
    ],
  ],
  [
    roots.ruri,
    /瑠璃子|高飛車/,
    '高飛車お姫様・瑠璃子',
    '《ツグナヒ》系：潜入女校对教导对象（女学生）复仇调教，核心为对学生的性暴力，ABORT。',
    [
      'https://www.dlsite.com/pro/work/=/product_id/VJ015676.html',
      'https://www.getchu.com/',
      'https://www.hacg.casa/',
    ],
  ],
]

for (const [dir, re, shortTitle, reason, sources] of jobs) {
  const name = find(dir, re)
  if (!name) {
    console.log('MISS', shortTitle, dir)
    continue
  }
  // keep original title from filename without .md
  const title = name.replace(/\.md$/, '')
  abort(path.join(dir, name), title, reason, sources)
}

// expand 闇憑村 if short
const yami = '世界详情工坊/产出/批次761/闇憑村 めるてぃーりみっと.md'
let t = fs.readFileSync(yami, 'utf8')
const m = t.match(/## 剧情([\s\S]*?)## 休闲切入点/)
const plot = m ? m[1].replace(/\s/g, '').length : 0
const m2 = t.match(/## 休闲切入点([\s\S]*?)## 来源/)
const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
console.log('yami before', { plot, cut })
if (plot < 6000 || cut < 1500) {
  const addP = `

**【三夜结构细目】**
第一夜建立「收留—夜訪—印记」因果；第二夜把神圣祓除拖进共犯结构；第三夜揭晓静的淫魔身份并迫使契约者在「猎巫」与「共栖」之间选择。写正文时每夜只推进一个关系变量：夜1＝印记可见；夜2＝神职裂缝；夜3＝真名与谈判。

**【民俗调查伦理】**
門部的笔记不是经验条，是道德账本。他写下村民的冷淡、静的善意、桜歌的夜、蓮華的铃——若最终选择公开论文导致猎巫，则走 BE。HE 要求他学会「有些真相只写给自己」。

**【淫印的情感读法】**
印记亮起＝秘密被共享；印记发烫＝欲望上升；印记在白天被衣领遮住＝社会脸优先。禁止写成升级纹章。

**【共栖立法草案（可入正文）】**
①外来者须两人以上或持村许可；②夜訪必须可退出；③精气交换须双方清醒同意；④巫女不得以祓除名义强迫；⑤违反者由静亲自出面协商而非猎杀。
`
  const addC = `

切入补充·调查包清单：
笔记本、铅笔、干粮、退烧药、民间护符材料、备用草鞋。缺「护符材料」则第三夜谈判更难。

切入补充·称呼政治：
白天称「静さん」「桜歌さん」「蓮華さん」；夜里若被允许可名字。淫魔真名是否公开是 True 条件之一。

切入补充·失败修复：
若失忆 BE，可从村口闲话「又有个学者走丢了」重开，记忆以梦残片回收。
`
  if (!t.includes('三夜结构细目')) t = t.replace('## 休闲切入点', addP + '\n## 休闲切入点')
  if (!t.includes('切入补充·调查包清单')) t = t.replace('## 来源', addC + '\n## 来源')
  fs.writeFileSync(yami, t)
  const m3 = t.match(/## 剧情([\s\S]*?)## 休闲切入点/)
  const m4 = t.match(/## 休闲切入点([\s\S]*?)## 来源/)
  console.log('yami after', {
    plot: m3 ? m3[1].replace(/\s/g, '').length : 0,
    cut: m4 ? m4[1].replace(/\s/g, '').length : 0,
  })
}
