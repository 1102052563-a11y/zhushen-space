/* 前端卡沙箱（P3·对齐酒馆助手 JS-Slash-Runner 的 iframe 渲染思路）：
   正文里 ```html 围栏/完整 HTML 文档 → sandbox iframe（allow-scripts、**无 allow-same-origin**）——
   脚本能跑（动画/交互/内嵌小界面全量可用），但拿不到宿主 DOM / localStorage / 各 store，天然与大前端隔离。
   高度自适应：向 srcdoc 注入 ResizeObserver 上报脚本，postMessage 只认 { __zsSandboxH }（来源必须是本 iframe）并夹取。
   ⚠ 模块级 memo 组件（IME 教训：绝不定义在 MessageRow 内部）；html 不变绝不重渲 → 流式期间 iframe 不重载。 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';

const REPORTER = `<script>(function(){
  var last = 0;
  function report(){
    try {
      var h = Math.max(document.documentElement ? document.documentElement.scrollHeight : 0, document.body ? document.body.scrollHeight : 0) || 200;
      if (Math.abs(h - last) > 2) { last = h; parent.postMessage({ __zsSandboxH: h }, '*'); }
    } catch (e) {}
  }
  try {
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(report);
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    }
  } catch (e) {}
  window.addEventListener('load', report);
  setInterval(report, 800);
  report();
})();<\/script>`;

/* 把围栏内容包成可渲染文档：完整文档原样+注入上报脚本；HTML 片段套最小骨架（透明底·继承宿主字色） */
function buildSandboxDoc(html: string): string {
  const isFullDoc = /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(html);
  if (isFullDoc) {
    return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${REPORTER}</body>`) : html + REPORTER;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;color:#cbd5e1;font-family:system-ui,-apple-system,'Noto Sans SC',sans-serif;font-size:14px;line-height:1.7}
    img,video{max-width:100%}
  </style></head><body>${html}${REPORTER}</body></html>`;
}

export default memo(function HtmlSandbox({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const doc = useMemo(() => buildSandboxDoc(html), [html]);
  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (!ref.current || ev.source !== ref.current.contentWindow) return;   // 只认本 iframe 的上报
      const h = Number((ev.data as { __zsSandboxH?: unknown } | null)?.__zsSandboxH);
      if (Number.isFinite(h)) setHeight(Math.min(2000, Math.max(60, Math.round(h))));   // 夹取防恶意撑爆
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  return (
    <iframe
      ref={ref}
      sandbox="allow-scripts allow-popups"
      srcDoc={doc}
      title="前端卡"
      loading="lazy"
      style={{ width: '100%', height, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, background: 'transparent', display: 'block', margin: '8px 0' }}
    />
  );
});
