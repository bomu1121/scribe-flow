---
title: 画布性能优化：三处改动与实测数字（200 节点）
class: research
owner: 念前
last_reviewed: 2026-09-27
---

# 画布性能优化（200 节点实测）

一次针对**画布模块**的前端技术升级：先量基线，再按业界公开的做法改三处，每改一处重测同一组指标。
所有数字都是本机实测，测量口径与复现步骤写在 §1 与 §6。

## 0. 结论（数字前置）

测量环境：200 个节点的可运行链路（`文本 → 文本工具 ×199`，正好是这个产品的节点上限），
浏览器视口 3840×2160（与使用者的显示器一致），每次改动单独测、不叠加。

| 指标 | 基线 | 改动后 | 变化 |
| --- | --- | --- | --- |
| **跑一次 200 节点时主线程最长阻塞** | **32 655 ms** | **264 ms** | **−99.2%（124 倍）** |
| 自动布局（整理画布）的长任务合计 | 728 ms | 53 ms | −93% |
| 自动布局的最长掉帧 | 526 ms | 60 ms | −89% |
| 画布 DOM 元素总数（200 节点） | 8 926 | 2 099 | −76% |
| 画布内渲染的节点数 | 200 | 36（视口内） | −82% |
| 首屏 200 节点进 DOM | 2 250 ms | 2 340 ms | **没改善（见 §5）** |

三处改动分别对应三件业界有明确做法的事：**视口裁剪**、**事件合流 + 增量更新**、**布局进 Web Worker**。
其中第二处是这次最大的一笔：服务端 268 ms 就跑完的一次运行，前端原本要卡 32 秒。

## 1. 测量方法（同一套口径，改动前后各跑一遍）

- **测试图**：用脚本通过 `PUT /api/projects/:id/graph` 写入 200 节点链路。选 `process.text` 串链是因为它是纯文本变换，**不需要密钥、不联网就能真跑**，于是同一张图既能测渲染、也能测运行事件。
- **长任务**：`PerformanceObserver({ type: "longtask" })`，记录每个长任务的时长与出现时的 `location.pathname`（防止把别的页面的数字算进来）。
- **掉帧**：`requestAnimationFrame` 采样时间戳，统计相邻帧间隔的最大值与超过 100 ms 的次数。
- **DOM 与内存**：`document.getElementsByTagName("*").length`、`.vue-flow__node` 计数、`performance.memory.usedJSHeapSize`。
- **每次读数前先确认前提**：画布上节点数 > 0；运行结束后用 API 核对确实新增了一条运行记录（否则测到的可能是别的页面的数字）。

## 2. 现状：三处实现，各自的代价

### 2.1 没有开视口裁剪

`FlowCanvas.vue` 的 `<VueFlow>` 没传 `only-render-visible-elements`，默认关闭。
实测后果：200 个节点全部驻留在 DOM 里，DOM 元素总数 8 926；放大 6 级之后视口里只剩十几个节点，
DOM 里的节点数**仍然是 200**。

### 2.2 每个运行事件都重建整张节点表

```ts
// 改动前
nodesRef.value = nodesRef.value.map((node) =>
  node.id === event.nodeId ? { ...node, data: { ...node.data, ...patch } } : node,
);
```

`nodes` 是 Vue Flow 的受控 prop。数组一旦换成新引用，Vue Flow 就会走一遍内部的 `setNodes`
并重新解析全部节点。一次 200 节点的运行会发出数百个 `node.started / node.progress / node.done` 事件，
每个事件都触发一轮全量重建与全量渲染，于是服务端 268 ms 的运行在前端堆成**单个 32.7 秒的长任务**。

### 2.3 ELK 在主线程同步跑

```ts
// 改动前
const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
const elk = new ELK();          // 没有 workerUrl，全部在主线程
```
`elk.bundled.js` 是自包含版本，按 elkjs 官方说明它不支持 worker。
实测：200 节点布局出三个长任务（155 + 512 + 61 ms），最长掉帧 526 ms。

## 3. 全网调研：别人怎么做（含来源与关键数字）

| 技术 | 出处 | 关键结论 / 数字 | 与本项目的对应 |
| --- | --- | --- | --- |
| 视口裁剪 | Vue Flow 文档的 Hidden 示例；`onlyRenderVisibleElements` | 默认关闭；开启后只渲染视口内元素；**注意**平移会让节点反复挂载/卸载，节点组件越重尖峰越明显 | 直接可用，本项目没开 |
| 裁剪到底省什么 | xyflow RFC #4239（空间索引调研） | 裁剪本身很快（RBush 建树 2 500 节点约 1 ms）；**真正的瓶颈是"一次事务里更新上千个节点"的 store 更新逻辑** | 与 2.2 的现象完全对上：慢的不是裁剪，是"每个事件都全量更新" |
| 大图渲染方式 | xyflow Discussion #5446、Elastic/Kibana 的 769 节点案例 | 100+ 节点时 HTML 渲染会卡；Kibana 那个案例从"完全不可用"改善到"不崩但仍不理想"；建议 canvas 渲染 + 裁剪，`will-change: transform` 有帮助 | 本次未做 canvas 渲染，属后续可选项 |
| 布局进 Worker | elkjs 官方 README | **支持 Web Worker**，要求用 `elk-api.js` 并传 `workerUrl`（`elk.bundled.js` 不行） | 本项目用的正是 bundled 版，等于关掉了这个能力 |
| 布局两趟 | React Flow + ELK cookbook | 大图布局会阻塞主线程；放进 worker；并建议"先量尺寸再布局再渲染"两趟，以及用 rAF 做平滑重排 | 本项目已把尺寸传给 ELK（`NODE_CARD_WIDTH`），只差 worker |
| 长文档渲染（本次未用上） | WICG `content-visibility` explainer；remarkjs #1027；ProseMirror 的 400 KB 案例 | `content-visibility: auto` 只省布局与绘制、**不省解析**；Markdown 因前瞻语法难以做块级虚拟化；ProseMirror 打开 400 KB 文档出现 5.75 s 长任务，最终靠"分级降级"（>300 KB 转只读） | 结果页的长文档渲染是下一个可优化点，见 §5 |
| 打字/流式渲染延迟 | qwen-code 的性能 issue；markstream-vue 的虚拟化基准 | 流式 markdown 渲染接近 O(n²)（5 k 字符从 465 ms 涨到 7.83 s）；**纯防抖会让流式体验变差**，推荐 50–100 ms 的前沿+尾沿节流；>50 k 字符再上 Worker；虚拟化后首屏 2.1 s→180 ms、内存 420→68 MB | 结果页编辑态每键重解析的问题同源（见上一份审计 C7/D7） |

来源为搜索摘要转述，未逐篇读原文；只有 elkjs 的 worker 支持是我在本机核过的（包里确实有
`elk-api.d.ts` 且构造函数签名里有 `workerUrl`，也有 `elk-worker.min.js`）。

## 4. 三处改动与实测结果

### 改动 1：开启视口裁剪

```html
<!-- FlowCanvas.vue 的 <VueFlow> -->
:only-render-visible-elements="true"
```

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| DOM 元素总数 | 8 926 | 2 099 |
| 视口内渲染的节点 | 200 | 36 |
| 跑一次运行的主线程最长阻塞 | 32 655 ms | 11 633 ms |

裁剪单独就能砍掉 64% 的阻塞，因为每个事件原本要渲染 200 个节点组件，裁剪后只渲染视口内的 36 个。
**但首屏没变**：建 200 个节点对象与算布局的成本还在，裁剪省的只是"渲染"。

### 改动 2：事件合流到帧 + 只替换受影响的节点

把 `applyRunEvent` 的一次性全量重建，换成"记进待办表，每个动画帧合并刷一次"：

```ts
const pendingPatches = new Map<string, Record<string, unknown>>();
let flushHandle: number | null = null;

function flushRunEvents() {
  flushHandle = null;
  if (pendingPatches.size === 0) return;
  const patches = new Map(pendingPatches);
  pendingPatches.clear();
  nodesRef.value = nodesRef.value.map((node) => {
    const patch = patches.get(node.id);
    return patch ? { ...node, data: { ...node.data, ...patch } as ScribeNodeData } : node;
  });
}

function queueRunPatch(nodeId, patch) {
  pendingPatches.set(nodeId, { ...(pendingPatches.get(nodeId) ?? {}), ...patch });
  if (flushHandle === null) flushHandle = requestAnimationFrame(flushRunEvents);
}
```
（同一节点在一帧内的多个事件会合并成一条补丁；未受影响的节点保持原对象引用。）

| 指标 | 改前（已开裁剪） | 改后 |
| --- | --- | --- |
| 跑一次运行的主线程最长阻塞 | 11 633 ms | **264 ms** |
| 最长掉帧 | 11 638 ms | 269 ms |

**正确性核对**：运行结束后，视口内的 36 个节点全部正确显示为「完成」——合流没有丢更新。
这一步的收益来源是把"数百次全量更新"压成"每帧一次"，正好对应 §3 里 xyflow RFC 的结论：
瓶颈在 store 更新的次数，不在裁剪算法。

### 改动 3：ELK 放进 Web Worker

```ts
type ElkInstance = import("elkjs/lib/elk-api.js").ELK;
let elkInstance: Promise<ElkInstance> | null = null;

function getElk(): Promise<ElkInstance> {
  if (!elkInstance) {
    elkInstance = (async () => {
      const [{ default: ELK }, { default: workerUrl }] = await Promise.all([
        import("elkjs/lib/elk-api.js"),                 // 支持 worker 的 API 版
        import("elkjs/lib/elk-worker.min.js?url"),      // worker 脚本作为资源引入
      ]);
      return new ELK({ workerUrl });
    })();
  }
  return elkInstance;
}
```
（做成懒加载单例：每次 `new ELK()` 都会拉起一个 worker，而 worker 启动本身有成本。）

| 指标 | 改前 | 改后（冷启动） | 改后（worker 就绪） |
| --- | --- | --- | --- |
| 自动布局长任务合计 | 728 ms | 163 ms | **53 ms** |
| 最长掉帧 | 526 ms | 108 ms | **60 ms** |

**正确性核对**：布局后 200 个节点有 200 个不同的 x 坐标、沿链路按层递增（`n_src(12,12)`、`n_t1(492,12)`、`n_t2(892,12)`…），与改动前的分层结果一致。

## 5. 没有改善的、以及新引入的风险

- **首屏渲染时间没有改善**（2 250 ms → 2 340 ms，三次测量内属噪声）。裁剪不减"建 200 个节点对象"的成本，
  想改善首屏得换思路（例如分批挂载、或把首屏只渲染视口内的节点对象而不是全部建出来）。**不要把这三处改动说成"首屏更快了"**，它不是。
- **裁剪会带来节点组件的反复挂载/卸载**，这是官方文档点名的副作用。本项目在这里有一个具体隐患：
  `ScribeNode.vue` 的 `onMounted` 会在卡片带 `url` 时发起一次 B 站解析并把远端值 patch 回工程图。
  节点滚出视口再滚回来就会重新挂载 → 可能重复发请求、重复写图。**我在基准图里没有 B 站卡片，所以这一点没有验证**；
  上生产前建议加一个"只在缺字段时才解析"的守卫。
- **裁剪与 `fitView` 的已知冲突**（xyflow issue #3573 说 `useNodesInitialized` 可能恒为 false）在本项目没有复现：
  `适应视图` 与 `整理画布` 之后的视图都正确。原因大概是本项目没用 `useNodesInitialized`，但这条要长期盯着。
- **事件合流改变了 UI 更新的时间语义**：同一节点在一帧内的多次进度更新只会显示最后一次。
  代价是进度条最细也只到"每帧一次"（60 Hz 下约 16 ms），对当前的产品形态无所谓；
  但如果将来要做逐条日志级别的实时演示，要重新评估。
- **worker 的代价**：多一个 worker 资源文件（`elk-worker.min.js`），首次布局多付约 100 ms 的冷启动。
  连续布局第二次只用 53 ms。若只布局一次就再也不动，这个交换仍然划算，因为主线程不卡了。

## 6. 复现步骤

```bash
# 1) 起服务
pnpm dev

# 2) 造一张 200 节点的可运行链路（PUT /api/projects/:id/graph），然后打开它
#    结构：source.text → process.text ×199，端口 transcript/out → in

# 3) 在页面里注入测量器（DevTools 控制台或 CDP）
window.__lt = []; window.__frames = [];
new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration))))
  .observe({ type: "longtask", buffered: false });
(function tick(){ window.__frames.push(performance.now()); requestAnimationFrame(tick); })();

# 4) 触发三件事，各读一次 window.__lt / 帧间隔 / DOM 计数
#    - 点「运行」（200 节点链路，纯文本，不需要密钥）
#    - 点「更多操作 → 整理画布」
#    - 点「更多操作 → 适应视图」后放大 6 级，数 .vue-flow__node
```

改动前的对照数字是通过 `git stash` 之外的方式得到的：本次是先测基线、再改代码、再重测，
所以每个数字都对应当时的工作区状态，没有事后补测。

## 7. 诚实清单

- **三处改动的数字都是单次会话内测得**（各 1 到 3 次读数）：首屏是三次（2 250/2 269/2 336 ms），
  其余交互项各测一次到两次。没有做多轮统计，也没有算方差。
- **一次测量中途作废并重做**：我第一次测"开裁剪后的运行阻塞"得到 159 ms，看起来很漂亮，
  但核对 URL 发现页面已经跳到了结果页——那个数字是量在结果页上的。重做后得到 11 633 ms（真实的画布数字），
  最终结论用的是重做后的值。**这也是为什么 §1 要求"读数前先确认画布上有节点、运行后核对运行记录"**。
- **一条假设被自己的测量否掉了**：页面一度长时间无响应，我怀疑是上一份审计里那条 O(n²) 的 `buildSegmentMap`，
  于是在 Node 里按真实规模（200 节点 / 199 行）量了一遍，结果是 **2 ms**，假设不成立。
  卡顿另有原因（标签页状态），换新标签页后恢复正常。那条 O(n²) 仍然成立，但触发它需要的是"单节点吃下成百上千行输入"，不是"节点多"。
- **测试与门禁**：`pnpm --filter @scribe-flow/web typecheck` exit 0；`pnpm lint` exit 0；
  193 个用例（shared 71 + server 108 + web 14）**分别单独跑全过**。
  但 `pnpm test` 的并行运行在本机失败了：报的是 `spawn UNKNOWN (-4094)`、`Fatal process out of memory: Zone`、
  `MemoryChunk allocation failed` 这类**进程创建/V8 原生层**的错误，不是断言失败（同一个 `-r` 运行里 `shared` 那个包是过的）。
  我当时的内存是 32.5 GB 里空着 8.9 GB、只有 7 个 node 进程，所以不像真的内存耗尽；`vue-tsc` 同期也原生崩过一次。
  **我把它归为环境问题而不是改动导致的**，依据是：改动只在前端、且三个包单独跑都能过。
  但这一条请你复核一次（重启机器或换个终端再跑 `pnpm test`）。
- **没有做的**：没有在多显示器/其他分辨率下重测；没有测真实工程（含 B 站卡片、AI 节点）的表现；
  没有验证裁剪对 `source.bili` 卡片重挂载的具体影响（§5 第一条）；没有跑视觉回归。
- **改动只在一个文件**：`apps/web/src/components/canvas/FlowCanvas.vue`（未提交）。要回退就是回退这一个文件。
