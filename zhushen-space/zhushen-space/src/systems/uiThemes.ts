// 主题配色（整体界面色 + 文字色，可在 设置→界面外观美化 切换）。
// 取材自知名开源配色：Solarized / Gruvbox / Nord / Dracula / Tokyo Night（均开源、广泛使用）。
// 原理：Tailwind 的 9 个自定义 token（void/panel/panel2/edge/god/blood/gold/san/dim）已改成 rgb(var(--c-X) / <alpha>)，
//   切主题时把这些 CSS 变量改写到 <html> 上即可全局换色；正文用的是 Tailwind 内置 slate/white（不走 token），
//   故浅色主题额外设 data-ui-light=1，由 index.css 把 slate/white 文字改成深色墨水(--c-ink)。

export interface UiTheme {
  key: string;
  label: string;
  desc: string;
  light?: boolean;   // 真·浅色主题（color-scheme:light，影响滚动条/表单控件）
  ink?: boolean;     // 是否把内置 slate/white 文字改成 --c-ink（浅色主题=深墨字；暖褐暗色=暖奶油字）
  // 9 个 token + 文字墨水，值为 "R G B" 三元组字符串
  vars: { void: string; panel: string; panel2: string; edge: string; god: string; blood: string; gold: string; san: string; dim: string; ink: string; 'ink-dim': string };
  // 选择器小样预览（hex）
  swatch: { bg: string; panel: string; accent: string; ink: string };
}

export const UI_THEMES: UiTheme[] = [
  {
    key: 'default', label: '默认·青光', desc: '原版青光暗色',
    vars: { void: '7 10 16', panel: '14 20 29', panel2: '20 28 40', edge: '30 42 58', god: '70 227 207', blood: '224 68 90', gold: '216 177 78', san: '155 122 214', dim: '139 157 178', ink: '199 210 224', 'ink-dim': '139 157 178' },
    swatch: { bg: '#070a10', panel: '#0e141d', accent: '#46e3cf', ink: '#e2e8f0' },
  },
  {
    key: 'sepia-gold', label: '古卷', desc: '暖褐暗底·墨金字·仿古修仙风',
    ink: true,
    vars: { void: '35 26 17', panel: '45 35 23', panel2: '57 44 28', edge: '107 84 48', god: '208 170 94', blood: '200 90 72', gold: '227 194 100', san: '154 143 192', dim: '154 136 102', ink: '221 208 180', 'ink-dim': '168 152 122' },
    swatch: { bg: '#231a11', panel: '#2d2317', accent: '#d0aa5e', ink: '#ddd0b4' },
  },
  {
    key: 'solarized-light', label: '羊皮纸', desc: 'Solarized 浅·亮黄底黑字',
    light: true, ink: true,
    vars: { void: '253 246 227', panel: '238 232 213', panel2: '233 226 205', edge: '202 189 150', god: '42 161 152', blood: '220 50 47', gold: '181 137 0', san: '108 113 196', dim: '101 123 131', ink: '32 48 58', 'ink-dim': '90 107 114' },
    swatch: { bg: '#fdf6e3', panel: '#eee8d5', accent: '#2aa198', ink: '#20303a' },
  },
  {
    key: 'gruvbox-light', label: '暖阳', desc: 'Gruvbox 浅·亮米黄底深褐字',
    light: true, ink: true,
    vars: { void: '251 241 199', panel: '242 229 188', panel2: '235 219 178', edge: '213 196 161', god: '104 157 106', blood: '204 36 29', gold: '215 153 33', san: '177 98 134', dim: '124 111 100', ink: '60 56 54', 'ink-dim': '102 92 84' },
    swatch: { bg: '#fbf1c7', panel: '#f2e5bc', accent: '#689d6a', ink: '#3c3836' },
  },
  {
    key: 'solarized-dark', label: '青墨', desc: 'Solarized 暗·墨蓝护眼',
    vars: { void: '0 43 54', panel: '7 54 66', panel2: '13 70 84', edge: '40 90 102', god: '42 161 152', blood: '220 50 47', gold: '181 137 0', san: '108 113 196', dim: '131 148 150', ink: '199 210 224', 'ink-dim': '131 148 150' },
    swatch: { bg: '#002b36', panel: '#073642', accent: '#2aa198', ink: '#93a1a1' },
  },
  {
    key: 'nord', label: '极地', desc: 'Nord·冷蓝灰',
    vars: { void: '46 52 64', panel: '59 66 82', panel2: '67 76 94', edge: '76 86 106', god: '136 192 208', blood: '191 97 106', gold: '235 203 139', san: '180 142 173', dim: '130 142 162', ink: '216 222 233', 'ink-dim': '130 142 162' },
    swatch: { bg: '#2e3440', panel: '#3b4252', accent: '#88c0d0', ink: '#e5e9f0' },
  },
  {
    key: 'gruvbox-dark', label: '复古暗', desc: 'Gruvbox 暗·暖褐复古',
    vars: { void: '40 40 40', panel: '60 56 54', panel2: '80 73 69', edge: '102 92 84', god: '142 192 124', blood: '251 73 52', gold: '250 189 47', san: '211 134 155', dim: '168 153 132', ink: '235 219 178', 'ink-dim': '168 153 132' },
    swatch: { bg: '#282828', panel: '#3c3836', accent: '#8ec07c', ink: '#ebdbb2' },
  },
  {
    key: 'dracula', label: '暗夜紫', desc: 'Dracula·紫调暗色',
    vars: { void: '40 42 54', panel: '56 58 74', panel2: '68 71 90', edge: '88 91 112', god: '189 147 249', blood: '255 85 85', gold: '241 250 140', san: '255 121 198', dim: '98 114 164', ink: '248 248 242', 'ink-dim': '120 130 170' },
    swatch: { bg: '#282a36', panel: '#383a4a', accent: '#bd93f9', ink: '#f8f8f2' },
  },
  {
    key: 'tokyo-night', label: '霓夜', desc: 'Tokyo Night·靛蓝霓虹',
    vars: { void: '26 27 38', panel: '36 40 59', panel2: '47 52 77', edge: '59 66 97', god: '122 162 247', blood: '247 118 142', gold: '224 175 104', san: '187 154 247', dim: '121 130 169', ink: '192 202 245', 'ink-dim': '121 130 169' },
    swatch: { bg: '#1a1b26', panel: '#24283b', accent: '#7aa2f7', ink: '#c0caf5' },
  },
];

// 把指定主题的 CSS 变量改写到 <html>（+ 浅色标记），全局换色。找不到则回退默认。
export function applyUiTheme(key: string): void {
  const t = UI_THEMES.find((x) => x.key === key) || UI_THEMES[0];
  const s = document.documentElement.style;
  const v = t.vars as Record<string, string>;
  for (const k of Object.keys(v)) s.setProperty('--c-' + k, v[k]);
  document.documentElement.setAttribute('data-ui-light', t.light ? '1' : '0');
  document.documentElement.setAttribute('data-ink', t.ink ? '1' : '0');
  document.documentElement.setAttribute('data-ui-theme', t.key);
}
