import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("element-plus")) return "element-plus";
          if (id.includes("@vue-flow") || id.includes("vue-flow")) return "vue-flow";
          if (id.includes("reka-ui")) return "reka-ui";
          return undefined;
        },
      },
    },
  },
  server: {
    // 必须显式绑 IPv4 回环。默认 host 是 "localhost"，而 Vite 只绑它解析出的**第一个**地址；
    // 本机 `dns.lookup("localhost")` 返回 [::1, 127.0.0.1]，于是只监听 [::1]:5173，
    // 127.0.0.1:5173 上无人监听 —— 而 README 和 AGENTS.md 让人打开的就是后者，
    // 报 ERR_CONNECTION_REFUSED，看起来像服务没起来。写死之后两端都能开。
    // 不要改成 "0.0.0.0" 或 true：那会把无认证的服务暴露到局域网。
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
