/* ── 顶栏天气效果·分类器 ───────────────────────────────────────────────
   把杂项演化维护的天气字符串(miscStore.weather，AI 自由文本如「阴冷微雨」)
   归一成 { kind, intensity, tone }，供 WeatherFx 顶栏背景渲染。
   新增天气只需加一条关键词。纯函数、无副作用。
   ──────────────────────────────────────────────────────────────────── */
export type WeatherKind = 'rain' | 'snow' | 'fog' | 'thunder' | 'sun' | 'overcast' | 'wind' | 'none';
export type WeatherIntensity = 'light' | 'mid' | 'heavy';
export interface WeatherParse {
  kind: WeatherKind;
  intensity: WeatherIntensity;
  tone: '' | 'cold' | 'warm';
}

export function parseWeather(raw?: string): WeatherParse {
  const t = raw || '';
  let kind: WeatherKind = 'none';
  if (/雷|電|电|霹/.test(t)) kind = 'thunder';        // 先判雷：雷雨含「雨」，须优先
  else if (/雪/.test(t)) kind = 'snow';
  else if (/雨|霖|淋/.test(t)) kind = 'rain';
  else if (/雾|霾|霭|烟/.test(t)) kind = 'fog';
  else if (/晴|阳|烈日|骄阳|艳阳|暑|曝/.test(t)) kind = 'sun';   // 不用裸「烈/日」，避免「浓烈/末日/28日」误判成晴
  else if (/阴|云|沉/.test(t)) kind = 'overcast';
  else if (/风|飓/.test(t)) kind = 'wind';

  let intensity: WeatherIntensity = 'mid';
  if (/微|细|小|薄|零星|和煦/.test(t)) intensity = 'light';
  if (/大|暴|狂|倾盆|鹅毛|滂沱|弥漫|交加|呼啸/.test(t)) intensity = 'heavy';

  let tone: '' | 'cold' | 'warm' = '';
  if (/阴冷|阴沉|冷|寒|昏|凛/.test(t)) tone = 'cold';
  if (/烈日|炎|酷|暖|和煦/.test(t)) tone = 'warm';

  return { kind, intensity, tone };
}

/* 该天气是否「亮天空」——顶栏文字需转深色才看得清(晴/多云/雪/雾/风)。
   雨/雷/无天气=暗天，沿用原浅色文字。 */
export function isLightSky(kind: WeatherKind): boolean {
  return kind === 'sun' || kind === 'overcast' || kind === 'snow' || kind === 'fog' || kind === 'wind';
}

/* 粒子层用哪种 canvas 模式(其余天气走纯 CSS 景物/背景)。 */
export function canvasMode(kind: WeatherKind): 'rain' | 'snow' | 'wind' | 'fog' | 'off' {
  if (kind === 'rain' || kind === 'thunder') return 'rain';
  if (kind === 'snow') return 'snow';
  if (kind === 'wind') return 'wind';
  if (kind === 'fog') return 'fog';
  return 'off';
}

/* ── 奇异天气·AI 生成 CSS 特效(混合方案：常规天气走上面预设，认不出的奇异天气用 AI 出的纯 CSS) ──
   AI 在杂项演化同一次调用里、于 <weatherfx> 块内给出纯 CSS；前端 sanitize 后注入 Shadow DOM 隔离渲染。 */
const WEATHERFX_RE = /<weatherfx>([\s\S]*?)<\/weatherfx>/i;
export function extractWeatherFxCss(text?: string): string {
  const m = WEATHERFX_RE.exec(text || '');
  return m ? m[1].trim() : '';
}

/* 安全过滤：只保留 CSS，杜绝 JS / 外部加载 / 老式注入向量；并限长。 */
export function sanitizeWeatherCss(raw?: string): string {
  let css = (raw || '').trim();
  if (!css) return '';
  css = css.replace(/<\/?(style|script|link)[^>]*>/gi, ''); // 去掉可能夹带的标签包裹
  css = css.replace(/@import[^;]*;?/gi, '');                // 禁外部样式导入
  css = css.replace(/expression\s*\(/gi, 'none(');          // 旧 IE JS 注入
  css = css.replace(/(behavior|-moz-binding)\s*:/gi, 'x:'); // 行为绑定
  css = css.replace(/javascript\s*:/gi, '');
  css = css.replace(/url\s*\([^)]*\)/gi, 'none');            // 去所有 url()：天气特效不需外链图，杜绝追踪/外泄
  css = css.replace(/<[^>]*>/g, '');                         // 去残留任何标签
  if (css.length > 4000) css = css.slice(0, 4000);          // 限长防性能/超大注入
  return css;
}
