import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/",
    name: "projects",
    component: () => import("@/views/ProjectListView.vue"),
    meta: { title: "工程" },
  },
  {
    path: "/project/:id",
    name: "project-editor",
    component: () => import("@/views/ProjectEditorView.vue"),
    meta: { title: "画布编辑器", immersive: true },
  },
  {
    path: "/project/:id/run/:runId",
    name: "run-detail",
    component: () => import("@/views/RunDetailView.vue"),
    meta: { title: "运行详情" },
  },
  {
    path: "/runs",
    name: "runs",
    component: () => import("@/views/RunsView.vue"),
    meta: { title: "运行记录" },
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
