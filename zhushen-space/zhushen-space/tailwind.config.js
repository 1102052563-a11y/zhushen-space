/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // token 改为 CSS 变量（"R G B" 三元组 + <alpha-value>）→ 切主题只改 <html> 上的 --c-* 即可全局换色。
        // 默认值见 index.css :root；各主题见 systems/uiThemes.ts。
        void:   'rgb(var(--c-void) / <alpha-value>)',
        panel:  'rgb(var(--c-panel) / <alpha-value>)',
        panel2: 'rgb(var(--c-panel2) / <alpha-value>)',
        edge:   'rgb(var(--c-edge) / <alpha-value>)',
        god:    'rgb(var(--c-god) / <alpha-value>)',      // 主神系统青光（随主题）
        blood:  'rgb(var(--c-blood) / <alpha-value>)',    // 危险 / 伤害
        gold:   'rgb(var(--c-gold) / <alpha-value>)',     // 奖励点
        san:    'rgb(var(--c-san) / <alpha-value>)',      // 精神
        dim:    'rgb(var(--c-dim) / <alpha-value>)',      // 次要文字
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      // 统一排版规范（设置→界面外观→统一排版）：圆角/text-sm 行高经 CSS 变量路由。
      // 变量未定义时 fallback＝Tailwind 默认值（开关关=逐像素原样）；html[data-ui-unify="1"] 在 index.css 改写变量。
      borderRadius: {
        DEFAULT: 'var(--r-base, 0.25rem)',
        md: 'var(--r-md, 0.375rem)',
        lg: 'var(--r-lg, 0.5rem)',
      },
      fontSize: {
        sm: ['0.875rem', { lineHeight: 'var(--lh-sm, 1.25rem)' }],
      },
    },
  },
  plugins: [],
}
