/* ════════════════════════════════════════════
   navBus（P4·空态深链）：任意面板一行代码请求「打开设置并直达某子页」。

   背景：9+ 个面板的空态写着「请到 设置 → 变量管理 → X 开启」——纯文本不可点，玩家要自己
   翻三层菜单（审计：空态引导文案模式·文字变按钮）。而 SettingsPanel 的 page 路由是组件内部
   state，面板与 App 之间又隔着 lazy 边界，逐层 prop 钻取要动十几个文件。
   这里用 CustomEvent 解耦：面板调 openSettingsPage('arena-manager') → App 监听后
   setSettingsOpen(true) + 把子页传给 SettingsPanel 的 initialPage。零 prop 钻取，
   新面板要深链照抄一行即可。事件名带 zs- 前缀防撞。
════════════════════════════════════════════ */

export const OPEN_SETTINGS_EVENT = 'zs-open-settings';

/** 请求打开设置并直达子页（page = SettingsPanel 的 Page 值，如 'arena-manager'/'variables'）。 */
export function openSettingsPage(page: string): void {
  try { window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: page })); } catch { /* SSR/异常静默 */ }
}
