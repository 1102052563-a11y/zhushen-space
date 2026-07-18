import fs from 'fs'
import path from 'path'

function abort(p, reason, sources) {
  const title = path.basename(p, '.md')
  const src = sources.map((s) => `- ${s}`).join('\n')
  const body =
    '# ' +
    title +
    '\n<!--meta lib=休闲 tiers=休闲 status=ABORT reason=age-policy-->\n\n## ABORT\n\n**原因：' +
    reason +
    '**\n\n### 来源\n' +
    src +
    '\n\n---\n**状态：ABORT**\n**字数：0**\n'
  fs.writeFileSync(p, body)
  console.log('ABORT', title.slice(0, 50))
}

const jobs = [
  [
    '世界详情工坊/产出/批次762',
    /淫行教師.*第二|橘弥生/,
    '教师对学生催眠性指导，学生性核心',
    ['https://www.lune-soft.jp/', 'https://www.dlsite.com/pro/', 'https://www.bugbug.news/'],
  ],
  [
    '世界详情工坊/产出/批次765',
    /聖華.*第二|加藤美桜|聖華.*第三|巴と美桜/,
    '圣华女学院生徒性核心',
    ['https://dic.pixiv.net/', 'https://www.lune-soft.jp/', 'https://www.themoviedb.org/'],
  ],
  [
    '世界详情工坊/产出/批次766',
    /聖華.*第二|加藤美桜/,
    '圣华女学院生徒性核心',
    ['https://dic.pixiv.net/', 'https://www.lune-soft.jp/', 'https://www.themoviedb.org/'],
  ],
  [
    '世界详情工坊/产出/批次767',
    /聖華.*第三|巴と美桜/,
    '圣华女学院生徒性核心',
    ['https://dic.pixiv.net/', 'https://www.lune-soft.jp/', 'https://www.themoviedb.org/'],
  ],
]

for (const [dir, re, reason, src] of jobs) {
  if (!fs.existsSync(dir)) continue
  for (const n of fs.readdirSync(dir)) {
    if (re.test(n)) abort(path.join(dir, n), reason, src)
  }
}
