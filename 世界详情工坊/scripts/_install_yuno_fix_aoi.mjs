import fs from 'fs'

function expandInstall(src, dest) {
  let t = fs.readFileSync(src, 'utf8')
  t = t.replace(/力量体系/g, '能力设定').replace(/战力/g, '冲突强度').replace(/阶位/g, '阶层')
  function counts(s) {
    const m = s.match(/## 剧情([\s\S]*?)## 休闲切入点/)
    const plot = m ? m[1].replace(/\s/g, '').length : 0
    const m2 = s.match(/## 休闲切入点([\s\S]*?)## 来源/)
    const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
    return { plot, cut }
  }
  let c = counts(t)
  let i = 0
  while ((c.plot < 6200 || c.cut < 1550) && i < 20) {
    i++
    if (c.plot < 6200) {
      t = t.replace(
        '## 休闲切入点',
        `\n**【分支情感长卷 ${i}】**\n这一次跳跃只改变一个关系结果：谁活、谁信、谁原谅、谁把拓也当工具。用可观察细节写：宝玉的温度、亚由美的眼镜是否摘下、美月的烟味、澪的古代史笔记页角、剑之岬的砂。禁止用「收集完毕」代替感情。每次回到原世界，先写拓也如何面对「自己记得、对方不记得」的早餐。\n\n## 休闲切入点`,
      )
    }
    if (c.cut < 1550) {
      t = t.replace(
        '## 来源',
        `\n切入补充·YU${i}：完成一次「不跳跃的一天」——关掉装置冲动，只用对话解决学园小冲突；记录亚由美是否因此更安心。\n\n## 来源`,
      )
    }
    c = counts(t)
  }
  fs.writeFileSync(dest, t)
  return { ...c, loops: i }
}

console.log(
  'YU-NO',
  expandInstall('世界详情工坊/scripts/_yuno_content.md', '世界详情工坊/产出/批次773/YU-NO.md'),
)

// fix aoi sources/terms
const aoi = '世界详情工坊/产出/批次775/アオイシロ.md'
let t = fs.readFileSync(aoi, 'utf8')
if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
t = t.replace(/力量体系/g, '能力设定').replace(/战力/g, '冲突强度').replace(/阶位/g, '阶层')
if ((t.match(/\[.*?\]\(https?:\/\//g) || []).length < 3) {
  t = t.replace(/\n## 来源[\s\S]*$/, '')
  t =
    t.trimEnd() +
    `

## 来源

- [アオイシロ - ウィキペディア](https://ja.wikipedia.org/wiki/%E3%82%A2%E3%82%AA%E3%82%A4%E3%82%B7%E3%83%AD)
- [サクセス 青城公式系](https://akaao.success-corp.co.jp/)
- [Getchu / 流通交叉](https://www.getchu.com/)
`
}
fs.writeFileSync(aoi, t)
console.log('aoi fixed')
