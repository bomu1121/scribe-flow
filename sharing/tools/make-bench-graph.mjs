/**
 * 现场演示道具：生成一张 200 节点的工程（正好是这个产品的节点上限）。
 * 用途：演示「一次运行把界面卡 32 秒」那一幕。
 *
 * 跑法（先确保 pnpm dev 已经起来）：
 *   node sharing/tools/make-bench-graph.mjs
 *
 * 它会建一个工程叫「演示·200 节点」并打印地址。分享当天提前打开那个地址就行。
 * 讲完可以从工程列表里直接删掉，不影响别的数据。
 */
const BASE = "http://127.0.0.1:8787";
const NODE_COUNT = 200;
const PROJECT_NAME = "演示·200 节点";

const nodes = [];
for (let i = 0; i < NODE_COUNT; i += 1) {
  const data =
    i === 0
      ? { label: "第一份", text: "这是一段用于演示的文稿。" + "内容内容内容。".repeat(20) }
      : { label: `文本工具 ${i}`, operation: "cleanup" };
  // 摆成 20 个一行、蛇形折返，这样"只渲染看得见的节点"这件事看得出来
  const row = Math.floor(i / 20);
  const col = row % 2 === 0 ? i % 20 : 19 - (i % 20);
  nodes.push({
    id: i === 0 ? "n_src" : `n_t${i}`,
    type: i === 0 ? "source.text" : "process.text",
    position: { x: col * 420, y: row * 320 },
    data,
  });
}

const edges = [];
for (let i = 0; i < NODE_COUNT - 1; i += 1) {
  edges.push({
    id: `e${i}`,
    source: nodes[i].id,
    target: nodes[i + 1].id,
    sourceHandle: i === 0 ? "transcript" : "out",
    targetHandle: "in",
  });
}

const graph = { schemaVersion: 1, nodes, edges, viewport: { x: 40, y: 40, zoom: 0.5 } };

const created = await fetch(`${BASE}/api/projects`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: PROJECT_NAME, description: "技术分享现场演示用" }),
});
if (!created.ok) {
  console.error("建工程失败：", created.status, await created.text());
  process.exit(1);
}
const project = await created.json();
const id = project.id ?? project.project?.id;

const put = await fetch(`${BASE}/api/projects/${id}/graph`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ graph }),
});
if (!put.ok) {
  console.error("写图失败：", put.status, await put.text());
  process.exit(1);
}

const back = await (await fetch(`${BASE}/api/projects/${id}/graph`)).json();
console.log(`已建好：nodes = ${back.graph.nodes.length}，edges = ${back.graph.edges.length}`);
console.log("分享当天打开这个地址：");
console.log(`  http://127.0.0.1:5173/project/${id}`);
console.log("");
console.log("演示动作：点右上角「运行」。服务端几百毫秒跑完，看界面会不会卡。");
console.log("这条链路全是纯文本节点，不需要密钥、不联网、不下载，跑一百次也不花钱。");
