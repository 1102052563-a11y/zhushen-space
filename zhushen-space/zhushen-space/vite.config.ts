import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

// 轮回WIKI：每次 vite build（含 Cloudflare）自动用 mkdocs 重建静态站到 public/wiki/。
// 好处：你只改 lunhui-wiki/docs/*.md，build 时自动重建 → 无需手动 mkdocs、无需提交几百个构建产物（public/wiki 已 gitignore）。
// Cloudflare 需在构建命令前装好依赖（见仓库根 部署到网页-指导.md：pip install -r ../../lunhui-wiki/requirements.txt）。
// 失败不阻断游戏构建（保留已有 public/wiki）；本地需已装 mkdocs-material+jieba。
function buildWiki(): Plugin {
  const CFG = '../../lunhui-wiki/mkdocs.yml'
  const OUT = 'public/wiki/index.html'
  const IDX = 'public/wiki/search/search_index.json'
  // mkdocs 生成的搜索索引默认 ASCII 转义（每个中文→\uXXXX，6 字节/字，是原字 UTF-8 3 字节的两倍）。
  // 词条累积到 7000+ 后体积虚高到 27.2 MiB，触发 Cloudflare Pages「单文件 ≤25 MiB」上限 → 部署失败。
  // 就地把索引重写为紧凑 UTF-8（中文按原字存 3 字节）：纯序列化层变换，客户端 JSON.parse 得到的对象逐字节等价、
  // 搜索质量零损失 → 27.2 → ~14.3 MiB。兜底：万一日后内容膨胀到重写后仍 >24MiB，逐步截断超长条目正文直至达标（仅极端情况触发）。
  const shrinkSearchIndex = () => {
    try {
      if (!existsSync(IDX)) return
      const before = statSync(IDX).size
      const data = JSON.parse(readFileSync(IDX, 'utf8'))
      let out = JSON.stringify(data)                        // Node 默认输出不转义非 ASCII 的紧凑 UTF-8 → 主要瘦身来源
      const CAP = 24 * 1024 * 1024                          // 25 MiB 硬上限留 1 MiB 余量
      let finalLimit = 0
      if (Buffer.byteLength(out) > CAP && Array.isArray(data.docs)) {
        for (let limit = 8000; limit >= 400 && Buffer.byteLength(out) > CAP; limit -= 800) {
          for (const d of data.docs) if (typeof d?.text === 'string' && d.text.length > limit) d.text = d.text.slice(0, limit)
          out = JSON.stringify(data); finalLimit = limit
        }
      }
      writeFileSync(IDX, out)
      const line = `[build-wiki] search_index ${(before / 1048576).toFixed(1)}→${(Buffer.byteLength(out) / 1048576).toFixed(1)} MiB`
      console.log(finalLimit ? `${line}（内容超量，已把超长条目正文截断至 ≤${finalLimit} 字以压进 24MiB）` : line)
    } catch (e) {
      console.warn('[build-wiki] 搜索索引瘦身跳过（解析失败，保留原文件）：', (e as Error)?.message)
    }
  }
  const build = () => {
    // 兼容不同环境的 python 入口；任一成功即停。
    const cmds = [
      `python -m mkdocs build -f ${CFG}`,
      `python3 -m mkdocs build -f ${CFG}`,
      `mkdocs build -f ${CFG}`,
    ]
    for (const c of cmds) {
      try { execSync(c, { stdio: 'inherit' }); shrinkSearchIndex(); return } catch { /* 试下一个入口 */ }
    }
    console.warn('[build-wiki] mkdocs 未能构建（python/mkdocs 不可用？）— 保留已有 public/wiki')
  }
  return {
    name: 'build-wiki',
    buildStart() { build() },                               // 生产构建：每次重建
    configureServer() { if (!existsSync(OUT)) build() },    // dev：仅当产物缺失时建一次（不拖慢日常启动）
  }
}

// 小剧场取材：从 lunhui-wiki 的「人物条目」生成 public/lunhui-characters.json = [{name, world, content}]。
// 解析 mkdocs.yml 的 `人物:` 导航得到「世界分组 → 角色文件」，再读每个 人物/*.md 的全文。前端在「小剧场」阶段随机抽
// 1~多位（多位则同世界、彼此有关联）注入正文末尾的 <xiaojuchang> 生成。源 md 已入库，产物 gitignore、每次 build 重建。
function buildLunhuiCharacters(): Plugin {
  const CFG = '../../lunhui-wiki/mkdocs.yml'
  const DOCS = '../../lunhui-wiki/docs'
  const OUT = 'public/lunhui-characters.json'
  const gen = () => {
    try {
      if (!existsSync(CFG)) return
      const lines = readFileSync(CFG, 'utf8').split(/\r?\n/)
      let i = lines.findIndex((l) => /^\s*-\s*人物:\s*$/.test(l))
      if (i < 0) return
      const baseIndent = (lines[i].match(/^(\s*)/) || ['', ''])[1].length
      let world = ''
      const items: { name: string; world: string; file: string }[] = []
      for (i++; i < lines.length; i++) {
        const line = lines[i]
        if (!line.trim()) continue
        const indent = (line.match(/^(\s*)/) || ['', ''])[1].length
        if (indent <= baseIndent && /^\s*-\s/.test(line)) break        // 到达下一顶层导航段
        const charM = line.match(/^\s*-\s*(.+?):\s*(?:[^\s:]*\/)?([^\s:]+\.md)\s*$/)  // 「- 名: 人物/X.md」
        if (charM) { items.push({ name: charM[1].trim(), world, file: charM[2].trim() }); continue }
        const groupM = line.match(/^\s*-\s*(.+?):\s*$/)                 // 「- 世界名:」分组头（无 .md）
        if (groupM && !/\.md\s*$/.test(line)) { world = groupM[1].trim() }
      }
      const out: { name: string; world: string; content: string }[] = []
      for (const it of items) {
        try {
          const p = DOCS + '/人物/' + it.file
          if (!existsSync(p)) continue
          let content = readFileSync(p, 'utf8').trim()
          if (content.length > 4000) content = content.slice(0, 4000)   // 单条上限，防个别超大条目
          if (content) out.push({ name: it.name, world: it.world, content })
        } catch { /* 单条失败跳过 */ }
      }
      if (out.length) { mkdirSync('public', { recursive: true }); writeFileSync(OUT, JSON.stringify(out)) }
    } catch { /* 失败不阻断构建 */ }
  }
  return { name: 'build-lunhui-characters', buildStart() { gen() }, configureServer() { if (!existsSync(OUT)) gen() } }
}

// 把根目录的世界书/预设源文件同步到 public/presets/（即部署后的内置默认值）。
// 好处：你照常编辑 预设/*.json、______.json、ST_WI…json，build 时（含 Cloudflare 构建）自动同步，
// 不必手动"重新内置"。源文件缺失时保留上次提交的副本，绝不让构建失败。
function copyBuiltinPresets(): Plugin {
  const map: [string, string][] = [
    // 正文世界书 + 模块化铁律（轮回乐园 ______.json 按要求不内置）。路径对应用户的文件夹结构：世界书/ 正文预设/ 演化预设/
    ['../../正文预设/ST_WI_Modular_Output_v11_orange_quote_fix_only.json', 'modular-output.json'],
    ['../../世界书/轮回乐园小说.json', 'novel.json'],
    // 世界选择世界书（仅「选择世界」功能用）
    ['../../世界书/世界选择.json', 'worldgen.json'],
    // 正文文本预设
    ['../../正文预设/双人成行 V5.2 —春和景明(5.29） (1).json', 'textpreset.json'],
    ['../../正文预设/轮回乐园 Alu v2.0.json', 'zhushen-alu.json'],   // 内嵌「轮回乐园 Alu v2.0」为内置正文预设（默认不激活，玩家自选）
    // 演化预设
    ['../../演化预设/主角演化.json', 'player.json'],
    ['../../演化预设/物品管理.json', 'item.json'],
    ['../../演化预设/NPC演化.json', 'npc.json'],
    ['../../演化预设/势力演化.json', 'faction.json'],
  ]
  const sync = () => {
    try { mkdirSync('public/presets', { recursive: true }) } catch { /* */ }
    for (const [src, name] of map) {
      try { if (existsSync(src)) copyFileSync(src, 'public/presets/' + name) } catch { /* 源缺失则保留已提交副本 */ }
    }
  }
  return { name: 'copy-builtin-presets', buildStart() { sync() }, configureServer() { sync() } }
}

// 扫描 public/portraits/ 自动生成图库清单 manifest.json：
//   - 子文件夹名 = 分类（category）；文件名(去扩展名) = 显示名（name）。
//   - 直接放在 public/portraits/ 根下的图 = 无分类（只出现在「全部」）。
// 你只要把图丢进 public/portraits/<分类>/，build（含 Cloudflare）与 dev 启动时自动重写 manifest，无需手写 JSON。
function buildPortraitManifest(): Plugin {
  const DIR = 'public/portraits'
  const IMG = /\.(png|jpe?g|webp|gif|avif)$/i
  const gen = () => {
    try {
      if (!existsSync(DIR)) return
      const out: { file: string; name: string; category?: string }[] = []
      for (const top of readdirSync(DIR, { withFileTypes: true })) {
        if (top.isDirectory()) {
          for (const f of readdirSync(DIR + '/' + top.name)) {
            if (IMG.test(f)) out.push({ file: top.name + '/' + f, name: f.replace(IMG, ''), category: top.name })
          }
        } else if (IMG.test(top.name)) {
          out.push({ file: top.name, name: top.name.replace(IMG, '') })
        }
      }
      // 同名双格式去重：同一张图同时有 .webp 与 .png/.jpg（WebP 化后保留旧格式是为了已保存进角色头像的
      // 旧 URL 不断链）→ 图库只列 .webp（新选图走小文件）；旧格式文件仍留在 public/ 继续可访问。
      const webpBase = new Set(out.filter((e) => /\.webp$/i.test(e.file)).map((e) => e.file.replace(IMG, '')))
      const deduped = out.filter((e) => /\.webp$/i.test(e.file) || !webpBase.has(e.file.replace(IMG, '')))
      writeFileSync(DIR + '/manifest.json', JSON.stringify(deduped, null, 2))
    } catch { /* 失败不阻断构建 */ }
  }
  return { name: 'build-portrait-manifest', buildStart() { gen() }, configureServer() { gen() } }
}

// 聊天室表情包（大贴纸·文件夹直投）：扫描 public/stickers/<包名>/ 自动生成 manifest.json：
//   - 子文件夹名 = 包 id/显示名；包内每个图(gif/png/webp/…) = 一张贴纸，id=文件名(去扩展名)。
//   - 你把自己的 gif/png/webp 丢进 public/stickers/<包名>/，build（含 Cloudflare）与 dev 启动时自动重写 manifest，无需手写。
//   - 动图(gif/apng/动态webp) 由前端 <img> 自动播放。**素材版权由放置者自负**（站点公开部署）。
function buildStickerManifest(): Plugin {
  const DIR = 'public/stickers'
  const IMG = /\.(gif|png|jpe?g|webp|apng|avif|svg)$/i
  const gen = () => {
    try {
      if (!existsSync(DIR)) return
      const packs: { id: string; label: string; stickers: { id: string; file: string }[] }[] = []
      for (const top of readdirSync(DIR, { withFileTypes: true })) {
        if (!top.isDirectory()) continue
        const stickers: { id: string; file: string }[] = []
        for (const f of readdirSync(DIR + '/' + top.name)) {
          if (IMG.test(f)) stickers.push({ id: f.replace(IMG, ''), file: top.name + '/' + f })
        }
        if (stickers.length) packs.push({ id: top.name, label: top.name, stickers })
      }
      writeFileSync(DIR + '/manifest.json', JSON.stringify(packs, null, 2))
    } catch { /* 失败不阻断构建 */ }
  }
  return { name: 'build-sticker-manifest', buildStart() { gen() }, configureServer() { gen() } }
}

// 背景音乐（文件夹直投）：扫描 public/bgm/ 自动生成 manifest.json = [{ file, name, category, bytes }]（本地 dev 用；线上走 R2）：
//   - 你把 mp3/ogg/m4a/… 丢进 public/bgm/，build（含 Cloudflare）与 dev 启动时自动重写清单，无需手写。
//   - ⚠必须是 public/bgm（不是 public/audio/bgm）：/audio/ 下有音效静态文件，Pages 会把 /audio/* 静态化、绕过 BGM 的 Function。
//   - name = 文件名(去扩展名)，作为迷你播放器显示的曲名。多首=播放列表；空=前端不显示播放器。
//   - **素材版权由放置者自负**（站点公开部署）。
function buildBgmManifest(): Plugin {
  const DIR = 'public/bgm'
  const AUD = /\.(mp3|ogg|m4a|aac|flac|opus|wav)$/i
  const gen = () => {
    try {
      if (!existsSync(DIR)) return
      const out: { file: string; name: string; category: string; bytes: number }[] = []
      const walk = (absDir: string, rel: string) => {
        const category = absDir.split(/[\\/]/).pop() || ''   // 主题 = 所在文件夹名（子文件夹丢音乐即成一个主题）
        for (const e of readdirSync(absDir, { withFileTypes: true })) {
          if (e.name.startsWith('.')) continue
          const relPath = rel ? rel + '/' + e.name : e.name
          if (e.isDirectory()) { walk(absDir + '/' + e.name, relPath); continue }
          if (!AUD.test(e.name)) continue
          let bytes = 0; try { bytes = statSync(absDir + '/' + e.name).size } catch { /* */ }
          out.push({ file: relPath, name: e.name.replace(AUD, ''), category, bytes })
        }
      }
      walk(DIR, '')
      out.sort((a, b) => (a.category + '/' + a.file).localeCompare(b.category + '/' + b.file, 'zh'))
      writeFileSync(DIR + '/manifest.json', JSON.stringify(out, null, 2))
    } catch { /* 失败不阻断构建 */ }
  }
  return { name: 'build-bgm-manifest', buildStart() { gen() }, configureServer() { gen() } }
}

// 强化老板分阶段立绘：把仓库根 图片/<老板>/阶段N/*.png 同步进 public/enhance-bosses/，
// 并生成 manifest.json = { "<老板>": { "1":[urls], "2":[...], "3":[...], "4":[...] } }。
// 你只要把图丢进 图片/凯莉/阶段1..4/，build（含 Cloudflare）与 dev 启动时自动同步+重写清单。
function syncEnhanceBosses(): Plugin {
  const SRC = '../../图片'
  const DST = 'public/enhance-bosses'
  const IMG = /\.(png|jpe?g|webp|gif|avif)$/i
  const stageNo = (n: string) => { const m = n.match(/(\d+)/); return m ? parseInt(m[1], 10) : 0 }
  const gen = () => {
    try {
      if (!existsSync(SRC)) return
      const manifest: Record<string, Record<string, string[]>> = {}
      for (const boss of readdirSync(SRC, { withFileTypes: true })) {
        if (!boss.isDirectory()) continue
        const bossDir = SRC + '/' + boss.name
        const stages: Record<string, string[]> = {}
        for (const stage of readdirSync(bossDir, { withFileTypes: true })) {
          if (!stage.isDirectory()) continue
          const no = stageNo(stage.name)
          if (no < 1 || no > 4) continue
          const files = readdirSync(bossDir + '/' + stage.name).filter((f) => IMG.test(f))
          if (!files.length) continue
          const outDir = DST + '/' + boss.name + '/' + stage.name
          mkdirSync(outDir, { recursive: true })
          const urls: string[] = []
          for (const f of files) {
            try { copyFileSync(bossDir + '/' + stage.name + '/' + f, outDir + '/' + f); urls.push(boss.name + '/' + stage.name + '/' + f) } catch { /* 单图失败跳过 */ }
          }
          if (urls.length) stages[String(no)] = urls
        }
        if (Object.keys(stages).length) manifest[boss.name] = stages
      }
      mkdirSync(DST, { recursive: true })
      writeFileSync(DST + '/manifest.json', JSON.stringify(manifest, null, 2))
    } catch { /* 失败不阻断构建 */ }
  }
  return { name: 'sync-enhance-bosses', buildStart() { gen() }, configureServer() { gen() } }
}

// 欢愉宫美女分阶段立绘：把仓库根 欢愉宫图片/<美女>/阶段N/*.png 同步进 public/joy-girls/，
// 并生成 manifest.json（结构同强化老板）。立绘标准尺寸 1215×832。
function syncJoyGirls(): Plugin {
  const SRC = '../../欢愉宫图片'
  const DST = 'public/joy-girls'
  const IMG = /\.(png|jpe?g|webp|gif|avif)$/i
  const stageNo = (n: string) => { const m = n.match(/(\d+)/); return m ? parseInt(m[1], 10) : 0 }
  const gen = () => {
    try {
      if (!existsSync(SRC)) return
      const manifest: Record<string, Record<string, string[]>> = {}
      for (const girl of readdirSync(SRC, { withFileTypes: true })) {
        if (!girl.isDirectory()) continue
        const girlDir = SRC + '/' + girl.name
        const stages: Record<string, string[]> = {}
        for (const stage of readdirSync(girlDir, { withFileTypes: true })) {
          if (!stage.isDirectory()) continue
          const no = stageNo(stage.name)
          if (no < 1 || no > 4) continue
          const files = readdirSync(girlDir + '/' + stage.name).filter((f) => IMG.test(f))
          if (!files.length) continue
          const outDir = DST + '/' + girl.name + '/' + stage.name
          mkdirSync(outDir, { recursive: true })
          const urls: string[] = []
          for (const f of files) {
            try { copyFileSync(girlDir + '/' + stage.name + '/' + f, outDir + '/' + f); urls.push(girl.name + '/' + stage.name + '/' + f) } catch { /* 单图失败跳过 */ }
          }
          if (urls.length) stages[String(no)] = urls
        }
        if (Object.keys(stages).length) manifest[girl.name] = stages
      }
      mkdirSync(DST, { recursive: true })
      writeFileSync(DST + '/manifest.json', JSON.stringify(manifest, null, 2))
    } catch { /* 失败不阻断构建 */ }
  }
  return { name: 'sync-joy-girls', buildStart() { gen() }, configureServer() { gen() } }
}

// 赌坊荷官立绘：把仓库根 赌场荷官图片/<荷官>/*.png 同步进 public/casino-dealers/，
// 并生成扁平 manifest.json = { "<荷官>": [urls] }。无图则前端回退 emoji 头像。
function syncCasinoDealers(): Plugin {
  const SRC = '../../赌场荷官图片'
  const DST = 'public/casino-dealers'
  const IMG = /\.(png|jpe?g|webp|gif|avif)$/i
  const gen = () => {
    try {
      if (!existsSync(SRC)) return
      const manifest: Record<string, string[]> = {}
      for (const dealer of readdirSync(SRC, { withFileTypes: true })) {
        if (!dealer.isDirectory()) continue
        const dir = SRC + '/' + dealer.name
        const files = readdirSync(dir).filter((f) => IMG.test(f))
        if (!files.length) continue
        const outDir = DST + '/' + dealer.name
        mkdirSync(outDir, { recursive: true })
        const urls: string[] = []
        for (const f of files) {
          try { copyFileSync(dir + '/' + f, outDir + '/' + f); urls.push(dealer.name + '/' + f) } catch { /* 单图失败跳过 */ }
        }
        if (urls.length) manifest[dealer.name] = urls
      }
      mkdirSync(DST, { recursive: true })
      writeFileSync(DST + '/manifest.json', JSON.stringify(manifest, null, 2))
    } catch { /* 失败不阻断构建 */ }
  }
  return { name: 'sync-casino-dealers', buildStart() { gen() }, configureServer() { gen() } }
}

// 欢愉宫世界书：把仓库根 世界书/新建文件夹/*.json 复制进 public/joy-worldbooks/（安全文件名 wbN.json）+ 生成 manifest（含显示名/稳定 key），前端启动加载为内置世界书（蓝灯常驻/绿灯关键词注入）。
function syncJoyWorldBooks(): Plugin {
  const SRC = '../../世界书/新建文件夹'
  const DST = 'public/joy-worldbooks'
  const clean = (f: string) => f.replace(/\.json$/i, '').replace(/^[-\s]+/, '').replace(/[\[\]【】]/g, '').replace(/\s*\(\d+\)\s*$/, '').trim()
  const gen = () => {
    try {
      if (!existsSync(SRC)) return
      const files = readdirSync(SRC).filter((f) => /\.json$/i.test(f))
      mkdirSync(DST, { recursive: true })
      const manifest: { file: string; name: string; key: string }[] = []
      files.forEach((f, i) => {
        try { copyFileSync(SRC + '/' + f, DST + '/wb' + i + '.json'); manifest.push({ file: 'wb' + i + '.json', name: clean(f), key: f }) } catch { /* 单本失败跳过 */ }
      })
      writeFileSync(DST + '/manifest.json', JSON.stringify(manifest, null, 2))
    } catch { /* 失败不阻断构建 */ }
  }
  return { name: 'sync-joy-worldbooks', buildStart() { gen() }, configureServer() { gen() } }
}

// 世界详情库切片：把仓库根 世界书/世界详情库·主库.json + ·休闲.json（世界详情工坊编译产物，每世界两条目：
//   comment=<名>·剧情 / <名>·阶位切入点|·休闲切入点，key[0]=世界名）切成 256 个哈希分桶 s<i>.json + manifest.json，
//   供前端按世界名点取（systems/worldDetail.ts：世界卡生成注 剧情+切入点 / 入世正文只注 剧情）。
//   合计 ~137MB 不能整本进前端（localStorage 5MB / Pages 单文件 25MiB 都过不了），哈希分桶后单片 ~0.5MB 按需 fetch。
//   产物 public/worlddetail/ 已 gitignore；源 size+mtime 记进 manifest.srcStamp——没变则秒跳过（工坊重编译后自动重切）。
function buildWorldDetailShards(): Plugin {
  const SRCS: [string, string][] = [['main', '../../世界书/世界详情库·主库.json'], ['leisure', '../../世界书/世界详情库·休闲.json']]
  const DST = 'public/worlddetail'
  const SHARDS = 256
  const fnv1a = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) } return h >>> 0 }
  const gen = () => {
    try {
      const avail = SRCS.filter(([, f]) => existsSync(f))
      if (!avail.length) { console.warn('[worlddetail] 源世界书缺失（世界书/世界详情库·*.json）→ 保留已有分片'); return }
      const stamp: Record<string, string> = {}
      for (const [lib, f] of avail) { const st = statSync(f); stamp[lib] = `${st.size}-${Math.round(st.mtimeMs)}` }
      const manifestPath = DST + '/manifest.json'
      if (existsSync(manifestPath)) {
        try {
          const prev = JSON.parse(readFileSync(manifestPath, 'utf8'))
          if (JSON.stringify(prev.srcStamp) === JSON.stringify(stamp)) return   // 源未变 → 秒跳
        } catch { /* manifest 损坏 → 重建 */ }
      }
      const t0 = Date.now()
      const shards: Record<string, { p: string; c?: string }>[] = Array.from({ length: SHARDS }, () => ({}))
      const worlds: Record<string, { s: number; l: string }> = {}
      for (const [lib, f] of avail) {
        const doc = JSON.parse(readFileSync(f, 'utf8'))
        const byName = new Map<string, { p?: string; c?: string }>()
        for (const e of Object.values<any>(doc.entries || {})) {
          const name = String(e?.key?.[0] || '').trim()
          const comment = String(e?.comment || '')
          if (!name || !e?.content) continue
          const rec = byName.get(name) || {}
          if (/·剧情$/.test(comment)) rec.p = e.content
          else if (/切入点$/.test(comment)) rec.c = e.content
          else continue
          byName.set(name, rec)
        }
        for (const [name, rec] of byName) {
          if (!rec.p || worlds[name]) continue   // 没·剧情条目不入库；同名先到先得（uid 全局唯一，理论不撞）
          const k = fnv1a(name) % SHARDS
          shards[k][name] = rec.c ? { p: rec.p, c: rec.c } : { p: rec.p }
          worlds[name] = { s: k, l: lib }
        }
      }
      mkdirSync(DST, { recursive: true })
      for (const f of readdirSync(DST)) if (/^s\d+\.json$/.test(f)) unlinkSync(DST + '/' + f)   // 清旧分片，防世界改名残留
      let files = 0
      shards.forEach((sh, i) => { if (Object.keys(sh).length) { writeFileSync(DST + `/s${i}.json`, JSON.stringify(sh)); files++ } })
      writeFileSync(manifestPath, JSON.stringify({ version: 1, srcStamp: stamp, shards: SHARDS, worlds }))
      console.log(`[worlddetail] 世界详情库切片：${Object.keys(worlds).length} 世界 → ${files} 分片（${Date.now() - t0}ms）`)
    } catch (e) { console.warn('[worlddetail] 切片失败（保留已有分片，不阻断构建）：', (e as Error)?.message) }
  }
  return { name: 'build-worlddetail-shards', buildStart() { gen() }, configureServer() { gen() } }
}





// 开发代理目标：解决本地 localhost 跨域（CORS）问题
// 如果你用的 API 地址不同，把 VITE_API_TARGET 写进 .env.local 文件
const API_TARGET = process.env.VITE_API_TARGET ?? 'https://api.baimeow.icu'

// dist 显式清理：下方 build.emptyOutDir:true 实测并不总生效（本地曾累积 3.6 万个旧哈希 chunk / 3.2GB 未被清理）。
// 这里在 build 启动时直接删掉整个 dist 一劳永逸——dist 内容全部可由 public/ + 本次构建再生，删了零损失。
// ⚠ 手写递归删除，绝不用 fs.rmSync({recursive:true})：本机 Node v24.12 的递归删除**静默失败**
//   （返回成功、0ms、文件全在——连新建的小目录都删不掉；单文件 unlinkSync/rmdirSync 正常）。
//   Vite 的 emptyOutDir 内部同样走 rm 递归 → 同样被这个 bug 废掉，这才是 dist 累积 686 份旧构建的根因。
function rmrfManual(p: string): number {
  let st; try { st = statSync(p) } catch { return 0 }   // 不存在=完成
  let n = 0
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) n += rmrfManual(p + '/' + name)
    try { rmdirSync(p) } catch { /* 顽固残留不阻断构建 */ }
  } else {
    try { unlinkSync(p); n = 1 } catch { /* */ }
  }
  return n
}
function cleanDist(): Plugin {
  return {
    name: 'clean-dist',
    // config 钩子在配置解析期最早执行；仅 build 命令清（dev / vite preview 不动 dist——本地 zhushen-dist 预览在用）。
    config(_cfg, env) {
      if (env.command !== 'build') return
      const t0 = Date.now()
      const n = rmrfManual('dist')
      if (existsSync('dist')) console.warn(`[cleanDist] ⚠ dist/ 未能完全清空（已删 ${n} 个文件）`)
      else console.log(`[cleanDist] 已清空 dist/（删除 ${n} 个文件，耗时 ${Date.now() - t0}ms）`)
    },
  }
}

export default defineConfig({
  plugins: [cleanDist(), react(), buildWiki(), buildLunhuiCharacters(), copyBuiltinPresets(), buildPortraitManifest(), buildStickerManifest(), buildBgmManifest(), syncEnhanceBosses(), syncJoyGirls(), syncJoyWorldBooks(), syncCasinoDealers(), buildWorldDetailShards()],
  build: {
    emptyOutDir: true,   // 防历史残留（实测不总生效，另有上方 cleanDist 插件兜底强删）
    rollupOptions: {
      output: {
        // 稳定 vendor 分包：把不随业务代码变动的大依赖拆成独立 chunk——发版后主 chunk 换哈希、
        // 这些 vendor 哈希不变 → 老玩家更新后二次加载命中缓存；首开也能多路并行下载。
        // 分组不改变加载时机（懒加载的照旧懒加载），只改打包归属。
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]node_modules[\\/](react-markdown|remark-|rehype-|micromark|mdast-|unist-|unified|vfile|hast-)/.test(id)) return 'vendor-md'
          if (id.includes('react-icons')) return 'vendor-icons'
          if (id.includes('opencc')) return 'vendor-opencc'
          if (id.includes('@dicebear')) return 'vendor-avatar'
          if (id.includes('howler')) return 'vendor-audio'
          if (id.includes('sql.js')) return 'vendor-sql'
        },
      },
    },
  },
  server: {
    proxy: {
      // 访问 http://localhost:5173/dev-proxy/* 时自动转发到目标 API
      // 使用方式：在设置里把 API 地址改为 http://localhost:5173/dev-proxy
      '/dev-proxy': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/dev-proxy/, ''),
        secure: false,
      },
    },
  },
})
