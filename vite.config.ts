import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  build: { target: 'es2020' },   // 兼容较老浏览器（Chrome/Edge 89+）
  base: './',
  // inspectAttr 会给每个 JSX 元素注入 code-path="src/...:行:列" 调试属性，只用于 dev；
  // 生产构建必须关闭，否则源码路径泄露进发布 bundle
  plugins: [{ ...inspectAttr(), apply: 'serve' as const }, react()],
  // 构建时间戳：写进界面页脚，用来一眼确认浏览器加载的是不是最新构建（缓存排查用）
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toLocaleString('sv-SE').slice(0, 16)),
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
