/**
 * 等一会儿再继续。
 *
 * 单独成一个文件是因为它被三处不相干的地方用到：引擎的节点等待、坚果云客户端的限流退避、
 * 外部核查的重试间隔。塞进其中任何一方，另外两方都要为了一层等待多背一个不相干的依赖。
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
