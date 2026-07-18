import fs from 'fs'

function patch(p) {
  let t = fs.readFileSync(p, 'utf8')
  t = t.replace(/力量体系/g, '能力设定')
  t = t.replace(/战力/g, '冲突强度')
  t = t.replace(/阶位/g, '阶层')
  t = t.replace(/为轮回乐园世界库「新增世界」清单收录的?休闲向作品条目。?/g, '')
  t = t.replace(/为轮回乐园世界库「新增世界」清单收录/g, '')
  t = t.replace(/轮回乐园世界库「新增世界」/g, '公开作品库')
  fs.writeFileSync(p, t)
  const bad = [
    '为轮回乐园世界库',
    '阶段0 标题相位',
    '题名核心・不详真名',
    '主舞台根据题名推断',
    '【细节层',
    '力量体系',
    '战力',
    '阶位',
  ].filter((b) => t.includes(b))
  console.log(p.split(/[/\\]/).pop().slice(0, 42), 'badleft', bad.length ? bad : 'OK')
}

;[
  '世界详情工坊/产出/批次735/巨乳プリンセス催眠 第2話 Dominance.md',
  "世界详情工坊/产出/批次766/SLEEPLESS -A Midsummer Night's Dream- Act..md",
  '世界详情工坊/产出/批次757/Mama×Holic.md',
].forEach(patch)
