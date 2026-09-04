import { createApp } from "vue";
import { createPinia } from "pinia";
import { ElLoading } from "element-plus";
import App from "./App.vue";
import router from "./router";
import { initDropdownModal } from "./lib/dropdown-modal";

import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/600.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";
import "./styles/tokens.css";
import "element-plus/dist/index.css";
import "./styles/element-theme.css";
import "./styles/app.css";
import "./styles/markdown.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
// Element Plus 组件按需显式引入；v-loading 指令全局注册
app.directive("loading", ElLoading.directive);
app.mount("#app");
initDropdownModal();
