import { defineConfig } from 'vitest/config';

// 测试专用配置（独立于 vite.config.ts）：不加载那些会去读仓库根 图片/预设 目录的素材同步插件，
// 只跑纯函数 / 确定性引擎的单测。node 环境 + 一个内存版 localStorage 垫片（部分 store 在 import 时
// 就会 hydrate persist，node 里没有该全局会直接抛错）。
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
