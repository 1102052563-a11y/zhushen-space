import fs from 'fs'

const dir = '世界详情工坊/产出/批次755'
const name = fs
  .readdirSync(dir)
  .find((n) => n.includes('第四') || n.includes('口裂け'))
const p = `${dir}/${name}`
let t = fs.readFileSync(p, 'utf8')
if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
t = t.replace(/力量体系/g, '能力设定').replace(/战力/g, '冲突强度').replace(/阶位/g, '阶层')
if (!t.includes('## 来源')) {
  t =
    t.trimEnd() +
    `

## 来源

- [MyAnimeList: Toilet no Hanako-san vs Kukkyou Taimashi](https://myanimelist.net/anime/48450/Toilet_no_Hanako-san_vs_Kukkyou_Taimashi)
- [HACG 第四怪介绍](https://www.hacg.me/wp/86390.html)
- [DLsite 成人动画流通检索](https://www.dlsite.com/pro/)
`
}
fs.writeFileSync(p, t)
console.log('fixed', name)
