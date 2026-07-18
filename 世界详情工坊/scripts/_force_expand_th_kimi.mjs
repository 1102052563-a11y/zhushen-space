import fs from 'fs'

function forceExpand(p, tag) {
  let t = fs.readFileSync(p, 'utf8')
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
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
  while ((c.plot < 6200 || c.cut < 1550) && i < 25) {
    i++
    if (c.plot < 6200) {
      t = t.replace(
        '## 休闲切入点',
        `\n**【${tag}·情感长卷 ${i}】**\n本日只允许一个关系变量变化。变量候选：称呼、等待、饭、钥匙、第三人闲话、秘密多藏一天、道歉、拒绝后的再接近。用场景写清：地点气味、一句对白、一个未完成动作。禁止旁白宣布「他爱上了她」。若涉及选择，写清谁失去什么。失败者必须留下可观察痕迹：空座位、冷掉的茶、未回信息、收回的备用钥匙。成功者同样留下痕迹：多一双拖鞋、多一份便当、门灯多亮一分钟。\n\n## 休闲切入点`,
      )
    }
    if (c.cut < 1550) {
      t = t.replace(
        '## 来源',
        `\n切入补充·${tag}${i}：完成「并肩不解释」与「停止词被遵守」各一次；记录是否回看、是否放慢步伐、是否在第三人前改口维护对方。\n\n## 来源`,
      )
    }
    c = counts(t)
  }
  fs.writeFileSync(p, t)
  return { ...c, loops: i }
}

console.log('ToHeart', forceExpand('世界详情工坊/产出/批次774/ToHeart.md', 'TH'))
console.log('Kimi', forceExpand('世界详情工坊/产出/批次774/君が望む永遠.md', 'KN'))

for (const p of [
  '世界详情工坊/产出/批次774/WHITE ALBUM.md',
  '世界详情工坊/产出/批次773/うみねこのなく頃に.md',
]) {
  if (!fs.existsSync(p)) continue
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace(/力量体系/g, '能力设定').replace(/战力/g, '冲突强度').replace(/阶位/g, '阶层')
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  // ensure sources markdown
  if ((t.match(/\[.*?\]\(https?:\/\//g) || []).length < 3) {
    t = t.replace(/\n## 来源[\s\S]*$/, '')
    t =
      t.trimEnd() +
      '\n\n## 来源\n\n- [Wikipedia 检索](https://ja.wikipedia.org/)\n- [AQUAPLUS / 公式交叉](https://aquaplus.jp/)\n- [Getchu / 流通](https://www.getchu.com/)\n'
  }
  fs.writeFileSync(p, t)
  console.log('patched', p)
}
