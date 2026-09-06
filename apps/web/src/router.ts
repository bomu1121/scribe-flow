import { createRouter, createWebHistory } from "vue-router";

/**
 * 单壳工作台路由：
 * 除“设置/提示词”等系统页外，所有内容都发生在工作台壳内 ——
 * 没有独立的“工程列表页/运行记录页”，工程与运行记录都在左侧探索器里。
 */
const routes = [
  {
    path: "/",
    name: "home",
    component: () => import("@/views/HomeView.vue"),
    meta: { title: "开始" },
  },
  {
    path: "/project/:id",
    name: "project-editor",
    component: () => import("@/views/ProjectEditorView.vue"),
    meta: { title: "画布编辑器" },
  },
  {
    path: "/project/:id/run/:runId",
    name: "run-detail",
    component: () => import("@/views/RunDetailView.vue"),
    meta: { title: "运行详情" },
  },
  {
    path: "/settings",
    name: "settings",
    component: () => import("@/views/SettingsView.vue"),
    meta: { title: "设置" },
  },
  {
    path: "/settings/prompts/:id?",
    name: "prompt-editor",
    component: () => import("@/views/PromptEditorView.vue"),
    meta: { title: "提示词块" },
  },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export default createRouter({
  history: createWebHistory(),
  routes,
});
