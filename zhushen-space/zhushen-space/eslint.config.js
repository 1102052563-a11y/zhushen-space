// ESLint 最小规则集——刻意不上 recommended 全家桶（几千条风格告警会把真问题淹死），
// 只开「编译器抓不到、但真能咬人」的 correctness 规则：
//   - react-hooks/rules-of-hooks   ：条件/循环里调 hook（必崩类 bug）→ error，CI 拦截
//   - react-hooks/exhaustive-deps  ：useEffect/useCallback 依赖漏写 → 闭包读到旧值的
//     隐性 bug 头号来源 → warn（存量多，先可见、逐步修；CI 不因 warn 失败）
//   - no-debugger                  ：debugger 语句禁入库
// 跑法：npm run lint（或 npx eslint src）。风格/格式一概不管，交给各自编辑器。
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'tools/**', 'functions/**', 'scripts/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-debugger': 'error',
    },
  },
];
