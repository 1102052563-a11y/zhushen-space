import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'

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
  plugins: [react(), copyBuiltinPresets(), buildPortraitManifest(), buildStickerManifest(), syncEnhanceBosses(), syncJoyGirls(), syncJoyWorldBooks(), syncCasinoDealers()],
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
