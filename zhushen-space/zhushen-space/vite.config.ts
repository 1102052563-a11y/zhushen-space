import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, existsSync, mkdirSync } from 'fs'

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

// 开发代理目标：解决本地 localhost 跨域（CORS）问题
// 如果你用的 API 地址不同，把 VITE_API_TARGET 写进 .env.local 文件
const API_TARGET = process.env.VITE_API_TARGET ?? 'https://api.baimeow.icu'

export default defineConfig({
  plugins: [react(), copyBuiltinPresets()],
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
