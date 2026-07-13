import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

// 轮回WIKI：每次 vite build（含 Cloudflare）自动用 mkdocs 重建静态站到 public/wiki/。
// 好处：你只改 lunhui-wiki/docs/*.md，build 时自动重建 → 无需手动 mkdocs、无需提交几百个构建产物（public/wiki 已 gitignore）。
// Cloudflare 需在构建命令前装好依赖（见仓库根 部署到网页-指导.md：pip install -r ../../lunhui-wiki/requirements.txt）。
// 失败不阻断游戏构建（保留已有 public/wiki）；本地需已装 mkdocs-material+jieba。
function buildWiki(): Plugin {
  const CFG = '../../lunhui-wiki/mkdocs.yml'
  const OUT = 'public/wiki/index.html'
  const build = () => {
    // 兼容不同环境的 python 入口；任一成功即停。
    const cmds = [
      `python -m mkdocs build -f ${CFG}`,
      `python3 -m mkdocs build -f ${CFG}`,
      `mkdocs build -f ${CFG}`,
    ]
    for (const c of cmds) {
      try { execSync(c, { stdio: 'inherit' }); return } catch { /* 试下一个入口 */ }
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
      writeFileSync(DIR + '/manifest.json', JSON.stringify(out, null, 2))
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

// 背景音乐（文件夹直投）：扫描 public/audio/bgm/ 自动生成 manifest.json = [{ file, name }]：
//   - 你把 mp3/ogg/m4a/… 丢进 public/audio/bgm/，build（含 Cloudflare）与 dev 启动时自动重写清单，无需手写。
//   - name = 文件名(去扩展名)，作为迷你播放器显示的曲名。多首=播放列表；空=前端不显示播放器。
//   - **素材版权由放置者自负**（站点公开部署）。
function buildBgmManifest(): Plugin {
  const DIR = 'public/audio/bgm'
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





// 开发代理目标：解决本地 localhost 跨域（CORS）问题
// 如果你用的 API 地址不同，把 VITE_API_TARGET 写进 .env.local 文件
const API_TARGET = process.env.VITE_API_TARGET ?? 'https://api.baimeow.icu'

export default defineConfig({
  plugins: [react(), buildWiki(), buildLunhuiCharacters(), copyBuiltinPresets(), buildPortraitManifest(), buildStickerManifest(), buildBgmManifest(), syncEnhanceBosses(), syncJoyGirls(), syncJoyWorldBooks(), syncCasinoDealers()],
  build: { emptyOutDir: true },   // 始终清空 dist 再构建（防 index-*.js 历史残留堆积；从外层目录构建时 Vite 默认会跳过清空）
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
