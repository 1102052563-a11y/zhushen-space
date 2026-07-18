import fs from 'fs'

const BAD = ['为轮回乐园世界库', '阶段0 标题相位', '题名核心・不详真名', '主舞台根据题名推断', '【细节层']
const AGE =
  /J○|JK|J〇|中学|ロリ|つるぺた|教え子|女子○|○学生|優等生|生徒|姪|幼淫|りとる|○かおし|ロ○|思春期|おるすばん|小さな蕾|○ータ|幼なじみ|みにこない|弟♂|実娘|アルバイト娘|ヴァージン|処女|学園|放課後|学生|○電車|交配|ヒナギク|ひなぎく|上書き性服|フーゾク|サキュバスアプリ|ネトシス|春野香澄|兄ちゃん|アネハメ|実姉|少女Z|千鶴|オナホ|純情姪|パパ喝|喝ッ|茜ハ/

const raw = fs.readFileSync('世界详情工坊/清单/_rewrite_701_800.json', 'utf8').replace(/^﻿/, '')
const j = JSON.parse(raw)
let ok = 0
const need = []
let age = 0
for (const x of j) {
  if (!fs.existsSync(x.Path)) continue
  if (AGE.test(x.Title)) {
    age++
    continue
  }
  const t = fs.readFileSync(x.Path, 'utf8')
  if (/status=ABORT|reason=age-policy|## ABORT/.test(t)) {
    age++
    continue
  }
  const bad = BAD.filter((b) => t.includes(b))
  const m = t.match(/## 剧情([\s\S]*?)## 休闲切入点/)
  const plot = m ? m[1].replace(/\s/g, '').length : 0
  const m2 = t.match(/## 休闲切入点([\s\S]*?)## 来源/)
  const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
  if (bad.length === 0 && plot >= 6000 && cut >= 1500) ok++
  else need.push({ Batch: x.Batch, Title: x.Title, plot, cut, bad: bad.length, Path: x.Path })
}
console.log({ ok, need: need.length, ageAbortOrSkip: age })
need.slice(0, 15).forEach((r) => console.log(r.Batch, r.plot, r.bad, r.Title.slice(0, 55)))
fs.writeFileSync('世界详情工坊/清单/_need_701_800_live.json', JSON.stringify(need, null, 2))
