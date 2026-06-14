/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#070a10',
        panel: '#0e141d',
        panel2: '#141c28',
        edge: '#1e2a3a',
        god: '#46e3cf',      // 主神系统青光
        blood: '#e0445a',    // 危险 / 伤害
        gold: '#d8b14e',     // 奖励点
        san: '#9b7ad6',      // 精神
        dim: '#8b9db2',      // 次要文字（已调亮以提升对比度/可读性）
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
