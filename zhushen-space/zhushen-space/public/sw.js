/*
 * 轮回乐园 PWA Service Worker
 * 唯一作用：让"添加到主屏幕"以独立 App 窗口启动（隐藏浏览器地址栏 / 底部工具栏）。
 *
 * 刻意【不做离线缓存】：本游戏强依赖实时 AI 接口与最新前端包，
 * 任何缓存都可能导致"更新不生效 / 内容陈旧"。这里只做同源 GET 透传，
 * 仅为满足浏览器的"可安装(installable)"判定，绝不拦截或缓存接口请求。
 */
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  // 顺手清掉任何历史遗留缓存，保证永不返回陈旧内容
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch { /* 忽略 */ }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // 只接管同源 GET（页面与静态资源）并直接透传网络；
  // 跨域接口、POST、流式请求一律不碰，交给浏览器默认处理。
  if (req.method !== 'GET') return
  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return
  event.respondWith(fetch(req))
})
