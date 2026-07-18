import fs from 'fs'
import path from 'path'

const files = [
  '世界详情工坊/产出/批次735/巨乳プリンセス催眠 第2話 Dominance.md',
  '世界详情工坊/产出/批次763/王子の本命は悪役令嬢.md',
  "世界详情工坊/产出/批次766/SLEEPLESS -A Midsummer Night's Dream- Act..md",
  '世界详情工坊/产出/批次764/きょにゅうおんなせんしどげざさいみんちくしょうっあたしはおまえのおもいどおりになんかならないからな1巨乳女戦士・土下座催眠 「ちくしょうっ……アタシはお前の思い通りになんか、ならないからな……!」 第一話.md',
  '世界详情工坊/产出/批次751/NTR KANOJO Case.2 ネトシス —春野香澄—.md',
  '世界详情工坊/产出/批次737/村又さんの秘密.md',
  '世界详情工坊/产出/批次719/Hなぼうけんきせいえきをあつめるえろまおう1女魔王メリッサのHな冒険記.md',
  '世界详情工坊/产出/批次703/都市伝説シリーズ 其の伍 ｴ呪いのVR.md',
  '世界详情工坊/产出/批次725/堕ちモノRPG 聖騎士ルヴィリアス 第三章 女の闘い.md',
  '世界详情工坊/产出/批次728/BRANDED AZEL ニプルへイムの狩人 第1話 淫紋は妖しく輝く.md',
  '世界详情工坊/产出/批次738/初めてのヒトヅマ 第2話 続・俺が見たことのない彼女.md',
  '世界详情工坊/产出/批次744/向日葵ハ夜ニ咲ク.md',
  '世界详情工坊/产出/批次760/Garden 高嶺家の二輪花.md',
]
const BAD = ['为轮回乐园世界库', '阶段0 标题相位', '题名核心・不详真名', '主舞台根据题名推断', '【细节层']
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.log('MISS', f)
    continue
  }
  const t = fs.readFileSync(f, 'utf8')
  const m = t.match(/## 剧情([\s\S]*?)## 休闲切入点/)
  const plot = m ? m[1].replace(/\s/g, '').length : 0
  const m2 = t.match(/## 休闲切入点([\s\S]*?)## 来源/)
  const cut = m2 ? m2[1].replace(/\s/g, '').length : 0
  const bad = BAD.filter((b) => t.includes(b))
  const mtime = fs.statSync(f).mtime.toISOString()
  console.log(
    path.basename(f).slice(0, 48),
    'plot',
    plot,
    'cut',
    cut,
    'bad',
    bad.length,
    'src',
    (t.match(/https?:\/\//g) || []).length,
    mtime,
  )
}
