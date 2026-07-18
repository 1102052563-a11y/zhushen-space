import fs from 'fs'

const p = '世界详情工坊/产出/批次772/魔法使いの夜.md'
let t = fs.readFileSync(p, 'utf8')
const pad = fs.readFileSync('世界详情工坊/scripts/_mahoyo_pad2.md', 'utf8')
if (!t.includes('三咲町冬季长卷')) {
  t = t.replace('## 休闲切入点', pad + '\n## 休闲切入点')
}
const cutPad = `

切入补充·祭周：
活动周只做后勤与圆谎，不展示魔术。与青子并肩收摊、与有珠在人群外对视一秒，比任何告白有效。

切入补充·钥匙政治：
钥匙分「正门／后门／学生会室」。有珠给后门＝高信任；青子给学生会＝公开脸同盟。收回钥匙＝危机。

切入补充·做饭任务链：
连续三晚晚饭：乡土菜、便利店拼盘、有珠指定菜单。第三次若有珠说「还能吃」，好感实质上升。

切入补充·目击后的第一句话库：
「我什么都没看懂。」「我不会跟别人说。」「你们先吃饭。」三句里至少用一句，避免理论分析开场。
`
if (!t.includes('切入补充·祭周')) {
  t = t.replace('## 来源', cutPad + '\n## 来源')
}
fs.writeFileSync(p, t)
const m = t.match(/## 剧情([\s\S]*?)## 休闲切入点/)
const plot = m ? m[1].replace(/\s/g, '').length : 0
const m2 = t.match(/## 休闲切入点([\s\S]*?)## 来源/)
const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
console.log({ plot, cut })
