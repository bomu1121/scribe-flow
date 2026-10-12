/** 按两个组件各自的算法算一遍下拉里会显示什么（含用户当前设置里的展示范围与检索密钥状态）。 */
import { DatabaseSync } from "node:sqlite";
import { availablePromptBlocks, bindablePromptBlocks, BUILTIN_PROMPT_BLOCKS } from "../packages/shared/src/prompt.ts";

const db = new DatabaseSync("apps/server/data/scribe-flow.sqlite", { readOnly: true });
const val = (k) => db.prepare("SELECT value FROM app_settings WHERE key=?").get(k)?.value;
const hiddenNodes = JSON.parse(val("visibility.hiddenNodes") || "[]");
const searchReady = Boolean(val("search.apiKey"));
const custom = [];

console.log("展示范围（hiddenNodes）:", hiddenNodes.join(", ") || "（空）");
console.log("检索密钥已配:", searchReady, "\n");

// 节点卡片：allBlocks（内置 + 自定义）减去阴阳师攻略系列
const nodeList = availablePromptBlocks(
  [...BUILTIN_PROMPT_BLOCKS, ...custom].filter((b) => b.series !== "阴阳师攻略"),
  searchReady,
  hiddenNodes,
);
console.log(`节点卡片下拉（${nodeList.length} 项）:`);
for (const b of nodeList) console.log("  ·", b.name);

// 快捷新建：先按系列去重，再过滤
const quickList = availablePromptBlocks(bindablePromptBlocks(custom), searchReady, hiddenNodes);
console.log(`\n快捷新建下拉（${quickList.length} 项）:`);
for (const b of quickList) console.log("  ·", b.name);

console.log(`\n被隐藏的内置块（${BUILTIN_PROMPT_BLOCKS.length - nodeList.length} 个）:`);
for (const b of BUILTIN_PROMPT_BLOCKS) if (!nodeList.some((x) => x.id === b.id)) console.log("  ✗", b.name, `(${b.id})`);
