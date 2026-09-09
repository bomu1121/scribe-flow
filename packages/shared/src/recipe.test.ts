import { describe, expect, it } from "vitest";
import { parseRecipe, recipeSchema } from "./recipe";

describe("recipeSchema", () => {
  it("接受最小合法配方（单步）", () => {
    const recipe = { schema: 1, steps: [{ id: "a", label: "A", system: "只输出文本" }] };
    expect(recipeSchema.safeParse(recipe).success).toBe(true);
  });

  it("steps 为空或超过 8 步时拒绝", () => {
    expect(recipeSchema.safeParse({ schema: 1, steps: [] }).success).toBe(false);
    const many = {
      schema: 1,
      steps: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, label: `S${i}`, system: "x" })),
    };
    expect(recipeSchema.safeParse(many).success).toBe(false);
  });

  it("步骤 id 重复时拒绝并给出中文错误", () => {
    const recipe = {
      schema: 1,
      steps: [
        { id: "dup", label: "A", system: "x" },
        { id: "dup", label: "B", system: "y" },
      ],
    };
    const result = recipeSchema.safeParse(recipe);
    expect(result.success).toBe(false);
    if (!result.success) expect(JSON.stringify(result.error.issues)).toContain("重复");
  });

  it("断言门 op 白名单：未知 op 拒绝，合法断言通过", () => {
    const bad = { op: "llmJudge", value: "x" } as unknown;
    expect(recipeSchema.safeParse({ schema: 1, steps: [{ id: "a", label: "A", system: "x", expects: { kind: "text", asserts: [bad] } }] }).success).toBe(false);
    const good = {
      schema: 1,
      steps: [
        {
          id: "a",
          label: "A",
          system: "x",
          expects: {
            kind: "json",
            asserts: [
              { op: "jsonRootKeys", value: ["blocks"] },
              { op: "citationsInOriginal", field: "blocks[].quotes[]", maxMiss: 0 },
              { op: "lengthGte", value: 1 },
            ],
          },
        },
      ],
    };
    expect(recipeSchema.safeParse(good).success).toBe(true);
  });
});

describe("parseRecipe", () => {
  it("内置 v3 配方可通过运行时校验（zod 与常量一致）", async () => {
    const { BUILTIN_PROMPT_BLOCKS } = await import("./prompt");
    const v3 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.insight.v3");
    expect(v3?.recipe).toBeDefined();
    expect(parseRecipe(v3!.recipe)).toEqual(v3!.recipe);
  });

  it("观点提炼 v4 排版版配方可通过运行时校验（zod 与常量一致）", async () => {
    const { BUILTIN_PROMPT_BLOCKS } = await import("./prompt");
    const v4 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.insight.v4");
    expect(v4?.recipe).toBeDefined();
    expect(parseRecipe(v4!.recipe)).toEqual(v4!.recipe);
  });

  it("阴阳师攻略核对版配方可通过运行时校验（zod 与常量一致）", async () => {
    const { BUILTIN_PROMPT_BLOCKS } = await import("./prompt");
    const v2 = BUILTIN_PROMPT_BLOCKS.find((block) => block.id === "builtin.gameguide.v2");
    expect(v2?.recipe).toBeDefined();
    expect(parseRecipe(v2!.recipe)).toEqual(v2!.recipe);
  });
});
