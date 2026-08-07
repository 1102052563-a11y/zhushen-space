/* 全局自定义 CSS（酒馆美化包入口·参考 SillyTavern User Settings → Custom CSS）。
   独立小组件自订阅 settings.customCss——App 不因此新增订阅（打字卡顿铁则）；渲染 null，只维护 head 里的
   <style id="drpg-custom-css">。scope=chat 时整段过 scopeCss 强制前缀 #chat（聊天滚动容器）——美化包
   永远摸不到聊天区外的应用壳；global=原样注入（用户显式选择、自担）。
   注入走 style.textContent（DOM 赋值不经 HTML 解析器，字面 </style> 无法逃逸成标签）。
   ⚠ 故意不做 unmount 清理：设置页/主界面是互斥的整树早退，切换视图时组件会卸载重挂——样式元素跨视图存活，
   重挂后 effect 重新对账；「清空/停用」由 effect 里的移除分支负责。 */
import { useEffect } from 'react';
import { useSettings } from '../store/settingsStore';
import { scopeCss } from '../systems/htmlSanitize';

const STYLE_ID = 'drpg-custom-css';

export default function CustomCssStyle() {
  const customCss = useSettings((s) => s.customCss);
  useEffect(() => {
    const cfg = customCss;
    const text = cfg?.enabled ? (cfg.text || '') : '';
    const css = !text.trim() ? '' : (cfg.scope === 'global' ? text : scopeCss(text, '#chat'));
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!css.trim()) { el?.remove(); return; }
    if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
    if (el.textContent !== css) el.textContent = css;
  }, [customCss]);
  return null;
}
