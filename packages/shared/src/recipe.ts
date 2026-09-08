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
  }),
]);

export const recipeStepSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(40),
  /** 支持模板变量 {{input}} / {{prev}} / {{all}}，由执行器展开。 */
  system: z.string().min(1),
  model: z.string().optional(),
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
    for (const step of steps) {
      if (ids.has(step.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `配方步骤 id 重复：${step.id}` });
      }
      ids.add(step.id);
    }
  }),
});

export type RecipeStep = z.infer<typeof recipeStepSchema>;
export type Assertion = z.infer<typeof assertionSchema>;
export type Recipe = z.infer<typeof recipeSchema>;

export function parseRecipe(raw: unknown): Recipe {
  return recipeSchema.parse(raw);
}
