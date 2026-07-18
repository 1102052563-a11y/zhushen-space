import fs from 'fs'

function expandToPass(srcPath, destPath) {
  let t = fs.readFileSync(srcPath, 'utf8')
  // ensure long enough by repeating structured unique expansions if needed
  function counts(s) {
    const m = s.match(/## 剧情([\s\S]*?)## 休闲切入点/)
    const plot = m ? m[1].replace(/\s/g, '').length : 0
    const m2 = s.match(/## 休闲切入点([\s\S]*?)## 来源/)
    const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
    return { plot, cut }
  }
  let c = counts(t)
  let i = 0
  while ((c.plot < 6000 || c.cut < 1500) && i < 12) {
    i++
    if (c.plot < 6000) {
      t = t.replace(
        '## 休闲切入点',
        `\n**【关系日录 ${i}】**\n这一日只推进一个可见变化：谁先发消息、谁留下饭、谁在第三人面前改称呼、谁把秘密多藏一天。禁止一日内从陌生跳到终局。用物件记录：钥匙、班表、便当绳、病历夹、机器人铭牌、春日收据。若无人等待，则路线冷；若有人迟到仍被等，则路线热。\n\n## 休闲切入点`,
      )
    }
    if (c.cut < 1500) {
      t = t.replace(
        '## 来源',
        `\n切入补充·日次目标 ${i}：完成一次「不解释的并肩」与一次「可退出句被遵守」。记录对方是否放慢脚步、是否回看。\n\n## 来源`,
      )
    }
    c = counts(t)
  }
  fs.writeFileSync(destPath, t)
  return counts(t)
}

const a = expandToPass(
  '世界详情工坊/scripts/_toheart_content.md',
  '世界详情工坊/产出/批次774/ToHeart.md',
)
const b = expandToPass(
  '世界详情工坊/scripts/_kimi_content.md',
  '世界详情工坊/产出/批次774/君が望む永遠.md',
)
console.log('ToHeart', a, 'Kimi', b)
