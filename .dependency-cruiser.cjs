const path = require("node:path");

// 依赖方向约束。管的是"代码结构上的过度设计"：反向依赖、循环依赖、绕过包入口的深层 import。
// 比 knip 管得更靠前：knip 找已经写死的死代码，这里拦不该长出来的依赖。
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "循环依赖：两个模块互相 import，谁也没法单独理解",
      from: {},
      to: { circular: true },
    },
    {
      name: "shared-stays-leaf",
      severity: "error",
      comment: "packages/shared 是公共契约层，只能被依赖，不能反向依赖 apps",
      from: { path: "^packages/shared" },
      to: { path: "^apps" },
    },
    {
      name: "no-deep-import-into-package",
      severity: "error",
      comment: "跨包只能走包入口（@scribe-flow/shared），不许直接摸别人的 src",
      from: { pathNot: "^packages/shared" },
      to: { path: "^packages/shared/src/", pathNot: "^packages/shared/src/index\\.ts$" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "孤儿模块：没有任何人 import 它",
      from: {
        orphan: true,
        pathNot: ["\\.d\\.ts$", "\\.test\\.ts$", "vite\\.config\\.ts$"],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|node_modules)/" },
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
  },
};
