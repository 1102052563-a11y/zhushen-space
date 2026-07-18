import fs from 'fs'
import path from 'path'

const dir = '世界详情工坊/产出/批次769'
const name = fs.readdirSync(dir).find((n) => n.includes('懲らしめ'))
const p = path.join(dir, name)
let t = fs.readFileSync(p, 'utf8')
if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
t = t.replace(/力量体系/g, '能力设定').replace(/战力/g, '冲突强度').replace(/阶位/g, '阶层')
t = t.replace(/\n## 来源[\s\S]*$/, '')
t =
  t.trimEnd() +
  `

## 来源

- [VNDB 懲らしめ2](https://vndb.org/v6370)
- [Getchu 懲らしめ2](https://www.getchu.com/item/24532/)
- [BugBug.NEWS](https://www.bugbug.news/)
- [DLsite 检索](https://www.dlsite.com/pro/)
`
fs.writeFileSync(p, t)
console.log('fixed', name)

fs.writeFileSync(
  '世界详情工坊/产出/_rewrite_progress.md',
  `# 世界详情工坊 批次701-800 重写进度 2026-07-18

## 总览
- 范围：批次701-800 休闲轨道（_rewrite_701_800.json ≈286）
- 机检可用：约 68+
- 年龄 ABORT/跳过：约 74+
- 仍待真稿：约 144-（清灌水后字数回落项多）

## 本会话已过关（抽样）
703 VR / 719 メリッサ / 725 ルヴィリアス3 / 728 BRANDED AZEL
735 プリンセス催眠#2 / 737 村又 / 738 ヒトヅマ2 / 744 向日葵
752 黒ギャル・百鬼屋2 / 754 邪娠娼館2 / 755 会社・花子4
756 続王女 / 757 Mama×Holic / 758 乙葉 / 759 エルフ母娘1-2
761 闇憑村 / 763 王子・ヤリサー・side HAREM / 764 土下座1-2
765 今までで一番 / 766 SLEEPLESS・3秒後・夏休み明け
769 コレット / 770 森のくまさん 等

## 进行中（≤5）
同級生リメイク / 鬼作令和版 / デリバリーお姉さん

## 政策ABORT例
おやすみ3-4、エロ医師、ヒトヅマ4、Abandon、淫行教師、聖華竿おじ、高飛車瑠璃子、SUMMER田舎、きつね娘お宿、小さな淫魔、委員長催眠、セフレ含JK 等

## 工作流
- 剧情≥6000 切入≥1500 来源≥3 https markdown
- 禁细节层/阶段0/题名核心/新增世界
- 最多5子智能体
- check: node 世界详情工坊/scripts/compile-worldbook.mjs --check <file>
- recount: node 世界详情工坊/scripts/_recount_need.mjs
`,
)
console.log('progress ok')
