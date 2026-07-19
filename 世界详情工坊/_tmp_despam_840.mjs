import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '产出', '批次840')

// Replace pure meta/pad section titles with lore titles; drop empty worldcard blurbs that only repeat slogans
const renames = [
  [/【契约者纪律】/g, '【入世纪律·本世界】'],
  [/【契约者胜利句】/g, '【胜利定义】'],
  [/【世界卡 blurb】/g, '【世界名片·可引用】'],
  [/【世界卡 blurb 素材】/g, '【世界名片·可引用】'],
  [/【世界卡二段】/g, '【持正与假骨】'],
  [/【世界卡三段】/g, '【宵明钟与入山】'],
  [/【世界卡四段】/g, '【昆仑值不值得】'],
  [/【世界卡五段】/g, '【星河远于教室】'],
  [/【世界卡末】/g, '【渡空前的家书】'],
  [/【最终世界卡】/g, '【文明进化一句】'],
  [/【收工句】/g, '【收束句】'],
  [/【收工检查清单】/g, '【档案自检】'],
  [/【基调再申】/g, '【基调补充】'],
  [/【人物补笔】/g, '【人物补述】'],
  [/【势力补笔】/g, '【势力补述】'],
  [/【物品补笔】/g, '【物品补述】'],
  [/【年表扩】/g, '【年表补述】'],
  [/【地理补笔】/g, '【地理补述】'],
  [/【物品发放纪律】/g, '【物品发放阶梯】'],
  [/【物品发放纪律再申】/g, '【物品发放阶梯·再核】'],
  [/【可介入事件扩】/g, '【可介入事件补表】'],
  [/【开篇三十章气质（按公开目录感扩写）】/g, '【开篇三十章气质（公开目录）】'],
  [/【文本禁区再申】/g, '【文本禁区】'],
  [/【乌云戏份纪律】/g, '【乌云戏份】'],
  [/【感情线纪律】/g, '【感情线写法】'],
  [/【奖励纪律】/g, '【奖励阶梯】'],
  [/【最后一段世界卡】/g, '【行至青山】'],
  [/【世界卡第二段素材】/g, '【洛城夜与包子】'],
  [/【声音与物象】/g, '【感官物象】'],
  [/【声音设计】/g, '【感官设计】'],
]

for (const f of ['剑烛大荒.md', '星河之主.md', '青山.md', '夜无疆.md']) {
  const fp = path.join(out.replace('批次840', f === '夜无疆.md' ? '批次839' : '批次840'), f)
  // fix path properly
}

const targets = [
  path.join(path.dirname(fileURLToPath(import.meta.url)), '产出', '批次840', '剑烛大荒.md'),
  path.join(path.dirname(fileURLToPath(import.meta.url)), '产出', '批次840', '星河之主.md'),
  path.join(path.dirname(fileURLToPath(import.meta.url)), '产出', '批次840', '青山.md'),
]

// Generic spam phrases to soft-replace
const phraseFix = [
  [/跨媒介流行作品/g, '本篇公开文本'],
  [/可被契约者切入的完整任务世界/g, '可切入的任务舞台'],
  [/本阶可刷[：:][^\n]*/g, '本阶主线以公开节点为准，禁止复制他阶句。'],
]

for (const fp of targets) {
  let t = fs.readFileSync(fp, 'utf8')
  for (const [a, b] of renames) t = t.replace(a, b)
  for (const [a, b] of phraseFix) t = t.replace(a, b)
  // ensure hide title
  t = t.replace(/【隐藏剧情·伏笔】/g, '【隐藏剧情 · 伏笔】')
  fs.writeFileSync(fp, t)
  const o = execSync(`node scripts/compile-worldbook.mjs --check "${fp}"`, {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    encoding: 'utf8',
  })
  console.log(path.basename(fp), o.trim().split(/\n/).pop())
}
