import { createApp } from "vue";
import { createPinia } from "pinia";
import { ElLoading } from "element-plus/es/components/loading/index.mjs";
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
// Element Plus 样式按组件引入（组件 JS 本来就是显式按需 import，别再引 dist/index.css 全量包）。
// 每个入口自带 base 与依赖组件的样式链（如 dialog → overlay）。新用了别的组件就在这里补一行，
// 漏了的症状是那个组件完全没有样式。
import "element-plus/es/components/button/style/css.mjs";
import "element-plus/es/components/checkbox/style/css.mjs";
import "element-plus/es/components/collapse/style/css.mjs";
import "element-plus/es/components/dialog/style/css.mjs";
import "element-plus/es/components/dropdown/style/css.mjs";
import "element-plus/es/components/input/style/css.mjs";
import "element-plus/es/components/input-number/style/css.mjs";
import "element-plus/es/components/loading/style/css.mjs";
import "element-plus/es/components/message-box/style/css.mjs";
import "element-plus/es/components/radio/style/css.mjs";
// radio 的入口只带 el-radio.css，**不含 radio-button 与 radio-group**（三者是并列的组件入口）：
// 少了 radio-button 那一行，`el-radio-button` 渲染出来就是没有外壳的一排圆点 + 文字；
// 少了 radio-group 那一行，分组容器没有 `display: inline-flex / font-size: 0`（踩过前者一次）。
import "element-plus/es/components/radio-button/style/css.mjs";
import "element-plus/es/components/radio-group/style/css.mjs";
import "element-plus/es/components/select/style/css.mjs";
import "element-plus/es/components/switch/style/css.mjs";
import "element-plus/es/components/table/style/css.mjs";
import "element-plus/es/components/tooltip/style/css.mjs";
import "element-plus/es/components/upload/style/css.mjs";
import "./styles/element-theme.css";
import "./styles/app.css";
import "./styles/markdown.css";
import "./styles/workspace.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
// Element Plus 组件按需显式引入；v-loading 指令全局注册
app.directive("loading", ElLoading.directive);
app.mount("#app");
initDropdownModal();
