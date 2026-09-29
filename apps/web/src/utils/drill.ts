import { MULTI_PRODUCT_SEPARATOR, parseDrillSet, type DrillSet } from "@scribe-flow/shared";

/**
 * 结果页解析 process.drill 产物。
 *
 * 引擎在多输入场景下会把多份产物用固定分隔符连接成主输出（见 combineOutputs），
 * 所以这里按同一分隔符切分后逐份解析：任一份坏掉不影响其它份，全部坏掉才当作无产物。
 *
 * 说明：生成期已经做过引文校验与逐条丢弃，这里只做结构解析（sourceText 传空即跳过引文比对），
 * 避免「结果页把生成期已入库的题再判一次死刑」。
 */

/** 引擎拼接多份产物用的分隔符。值只在 shared 定义一处，这里是结果页侧的别名（不再复制字面量）。 */
export const DRILL_PRODUCT_SEPARATOR = MULTI_PRODUCT_SEPARATOR;

export function parseDrillSets(text: string): DrillSet[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];
  const chunks = raw.includes(DRILL_PRODUCT_SEPARATOR) ? raw.split(DRILL_PRODUCT_SEPARATOR) : [raw];
  const sets: DrillSet[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const { set } = parseDrillSet(trimmed, "");
    if (set) sets.push(set);
  }
  return sets;
}
