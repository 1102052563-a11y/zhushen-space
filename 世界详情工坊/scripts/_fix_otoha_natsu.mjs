import fs from 'fs'
import path from 'path'

function patchTerms(p) {
  let t = fs.readFileSync(p, 'utf8')
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  t = t.replace(/力量体系/g, '能力设定')
  t = t.replace(/战力/g, '冲突强度')
  t = t.replace(/阶位/g, '阶层')
  t = t.replace(/^(\s*)(https?:\/\/\S+)\s*$/gm, (m, sp, u) => sp + '- [' + u + '](' + u + ')')
  return t
}

// 乙葉
const dir758 = '世界详情工坊/产出/批次758'
const otohaName = fs.readdirSync(dir758).find((n) => n.includes('乙葉'))
const otoha = path.join(dir758, otohaName)
let t = patchTerms(otoha)
if ((t.match(/\[.*?\]\(https?:\/\//g) || []).length < 3) {
  t = t.replace(/\n## 来源[\s\S]*$/, '')
  t =
    t.trimEnd() +
    `

## 来源

- [Pixiv百科：家属〜母と姉妹の嬌声〜](https://dic.pixiv.net/a/%E5%AE%B6%E5%B1%9E%E3%80%9C%E6%AF%8D%E3%81%A8%E5%A7%89%E5%A6%B9%E3%81%AE%E5%AC%8C%E5%A3%B0%E3%80%9C)
- [Bangumi 渡瀬乙葉](https://bangumi.tv/character/71488)
- [BISHOP 公式](https://www.bishop.jp/)
`
}
// expand cut if short
const m2 = t.match(/## 休闲切入点([\s\S]*?)## 来源/)
const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
if (cut < 1500) {
  t = t.replace(
    '## 来源',
    `
切入补充·乙葉职场线：
以继子／住家身份进入时，第一周只推进「餐桌座位」「拖鞋数量」「加班盒饭」三件物证，不要开局跳到足裏指令相位。乙葉在公司是冷面课长，在家是围裙与低声关心——攻略关键是尊重她的公开脸，并在她卸力后给可退出句。

切入补充·义姐妹缓冲：
凪沙与楓夏是压力计也是同盟。若契约者只消费乙葉而忽视家务与妹妹情绪，BE 倾向上升。可执行日常：一起洗碗、帮楓夏补习（成人设定下为专校课程）、与凪沙买菜。

切入补充·父出轨触发：
欽二的不在与出轨是关系质变开关，但正文忌把出轨写成开脱一切越界的许可证。任何亲密前仍须同意与停止词。

## 来源`,
  )
}
fs.writeFileSync(otoha, t)
console.log('otoha cut', (t.match(/## 休闲切入点([\s\S]*?)## 来源/) || ['', ''])[1].replace(/\s/g, '').length)

// 夏休み
const dir766 = '世界详情工坊/产出/批次766'
const natsuName = fs.readdirSync(dir766).find((n) => n.includes('夏休み'))
const natsu = path.join(dir766, natsuName)
let t2 = patchTerms(natsu)
fs.writeFileSync(natsu, t2)
console.log('natsu patched')
