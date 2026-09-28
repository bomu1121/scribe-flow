import { z } from "zod";

/**
 * AI 加工节点配方（节点内多步链，M8-1 阶段 A）。
 * 配方挂在提示词块上（PromptBlock.recipe?）；没有配方的块走原有单次调用路径。
 * 结构刻意收敛：只支持「顺序步骤 + 确定性断言门」，不引入任意图/循环（见调研文档 L0-L4 分级）。
 */

export const MAX_RECIPE_STEPS = 8;

export const assertionSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("contains"), value: z.string().min(1) }),
  z.object({ op: z.literal("notContains"), value: z.string().min(1) }),
  z.object({ op: z.literal("lengthGte"), value: z.number().int().min(0) }),
  z.object({ op: z.literal("lengthLte"), value: z.number().int().min(0) }),
  z.object({ op: z.literal("jsonRootKeys"), value: z.array(z.string().min(1)).min(1) }),
  z.object({
    op: z.literal("citationsInOriginal"),
    /** 取值路径，如 "blocks[].quotes[]"：逐层进数组收集字符串。 */
    field: z.string().min(1),
    /** 允许未命中的条数；未命中消息只展示前几条。 */
    maxMiss: z.number().int().min(0).max(10).default(0),
    /**
     * 至少要收集到几条引用，省略即不要求。
     * 存在意义：`maxMiss` 只数「没命中的」，字段被整段改写或丢掉时收集到 0 条，
     * 一份引用全丢的产物反而能安然通过 maxMiss=0 的检查。多步配方里靠上一步「转抄」字段时这是真实会发生的失败，
     * 用 minCount 把它变成机械可查的失败，交给断言门重问一次。
     */
    minCount: z.number().int().min(0).max(200).optional(),
  }),
]);

export const recipeStepSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(40),
  /** 支持模板变量 {{input}} / {{prev}} / {{all}} / {{sources}}，由执行器展开。 */
  system: z.string().min(1),
  model: z.string().optional(),
  /**
   * 联网检索：执行本步之前先按上一步产物里的检索词上网检索，结果经 `{{sources}}` 注入 system。
   *
   * 与 `PromptBlock.externalCheck` 是**两件事**，不要混：
   * - `externalCheck`（溯源）：产物**生成之后**逐条联网核查，判断说法有没有外部依据；
   * - `search`（本字段）：某一步**执行之前**先找参考资料，供这一步生成时参考（如知识巩固找同类练习题）。
   * 两者共用设置页同一份检索渠道配置。
   */
  search: z
    .object({
      /** 检索词的取值路径（相对**上一步**输出的 JSON），如 `points[].queries[]`。 */
      queriesFrom: z.string().min(1),
      /** 本次最多用几个检索词（默认 2，上限 6）：检索请求数直接等于它，是成本与耗时的闸门。 */
      maxQueries: z.number().int().min(1).max(6).optional(),
    })
    .optional(),
  expects: z
    .object({
      kind: z.enum(["text", "json"]),
      asserts: z.array(assertionSchema).optional(),
    })
    .optional(),
});

export const recipeSchema = z.object({
  schema: z.literal(1),
  steps: z.array(recipeStepSchema).min(1).max(MAX_RECIPE_STEPS).superRefine((steps, ctx) => {
    const ids = new Set<string>();
    for (const [index, step] of steps.entries()) {
      if (ids.has(step.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `配方步骤 id 重复：${step.id}` });
      }
      ids.add(step.id);
      // 检索词取自「上一步产物」，第 1 步没有上一步——声明了也永远取不到词，属于写错而不是运行时才知道的事。
      if (step.search && index === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `配方步骤「${step.id}」是第 1 步，不能声明 search（检索词取自上一步产物）` });
      }
    }
  }),
});

export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type Assertion = z.infer<typeof assertionSchema>;
export type Recipe = z.infer<typeof recipeSchema>;

export function parseRecipe(raw: unknown): Recipe {
  return recipeSchema.parse(raw);
}
