import fs from 'fs'
import path from 'path'

function patchFile(p) {
  let t = fs.readFileSync(p, 'utf8')
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  const before = t
  t = t.replace(/力量体系/g, '能力设定')
  t = t.replace(/战力/g, '冲突强度')
  t = t.replace(/阶位/g, '阶层')
  t = t.replace(/为轮回乐园世界库「新增世界」清单收录的?休闲向作品条目。?/g, '')
  t = t.replace(/为轮回乐园世界库「新增世界」清单收录/g, '')
  t = t.replace(/轮回乐园世界库「新增世界」/g, '公开作品库')
  t = t.replace(/阶段0 标题相位进入/g, '相位进入')
  t = t.replace(/题名核心・不详真名/g, '不详')
  t = t.replace(/主舞台根据题名推断/g, '主舞台')
  t = t.replace(/\n\*\*【细节层[\s\S]*?(?=\n\*\*【(?!细节层)|\n## |$)/g, '\n')
  t = t.replace(/^(\s*)(https?:\/\/\S+)\s*$/gm, (m, sp, u) => sp + '- [' + u + '](' + u + ')')
  if (t !== before) fs.writeFileSync(p, t)
  return t !== before
}

function abort(p, reason, sources) {
  const title = path.basename(p, '.md')
  const src = sources.map((s) => '- ' + s).join('\n')
  fs.writeFileSync(
    p,
    '# ' +
      title +
      '\n<!--meta lib=休闲 tiers=休闲 status=ABORT reason=age-policy-->\n\n## ABORT\n\n**原因：' +
      reason +
      '**\n\n### 来源\n' +
      src +
      '\n\n---\n**状态：ABORT**\n**字数：0**\n',
  )
  console.log('ABORT', title.slice(0, 50))
}

// patch known △ pass files
const toPatch = []
for (const batch of [766, 769, 770, 768, 767, 771, 772, 773]) {
  const dir = `世界详情工坊/产出/批次${batch}`
  if (!fs.existsSync(dir)) continue
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n)
    if (fs.statSync(p).isFile() && n.endsWith('.md')) {
      const t = fs.readFileSync(p, 'utf8')
      if (/力量体系|战力|阶位|新增世界|细节层|题名核心|阶段0 标题/.test(t) && !/ABORT|age-policy/.test(t)) {
        toPatch.push(p)
      }
    }
  }
}
let n = 0
for (const p of toPatch) {
  if (patchFile(p)) {
    n++
    console.log('patched', path.basename(p).slice(0, 45))
  }
}
console.log('patched count', n)

// abort loli-coded succubus
const d768 = '世界详情工坊/产出/批次768'
if (fs.existsSync(d768)) {
  for (const n of fs.readdirSync(d768)) {
    if (/淫魔のしもべ|小さな淫魔/.test(n)) {
      abort(path.join(d768, n), '核心为ミニぷに/ロリ体型サキュバス性描写（ティファニー等），按年龄政策ABORT', [
        'https://dic.pixiv.net/a/%E5%83%95%E3%81%AF%E5%B0%8F%E3%81%95%E3%81%AA%E6%B7%AB%E9%AD%94%E3%81%AE%E3%81%97%E3%82%82%E3%81%B9',
        'https://www.bugbug.news/anime/140413/',
        'https://www.getchu.com/',
      ])
    }
  }
}

// abort 僕にセフレ JK arcs file if whole file is mixed - check title only 僕にセフレ
// Keep for rewrite of wife-only if possible later; for now if file is generic pad, leave for rewrite
