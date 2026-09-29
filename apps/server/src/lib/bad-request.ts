import type { Context } from "hono";

/** Zod 校验失败结果的最小形状：只用得上第一条 issue 的文案，不必绑死 zod 的泛型。 */
interface ParseFailure {
  error: { issues: { message?: string }[] };
}

/**
 * 请求体校验失败的统一出口：400 + Zod 第一条 issue 的文案（没有文案时退回兜底提示）。
 *
 * 以前每个路由都手写一遍这一行，文案与状态码只能靠人肉对齐；现在形状只有一个来源，
 * 改响应体时不会漏掉某一处。
 *
 * `fallback` 只在 Zod 的 issue 没有文案时用到，供少数接口沿用自己原有的提示语
 * （如「参数不正确」「导入数据不合法」）；响应体形状与状态码不随它变化。
 */
export function badRequest(c: Context, parsed: ParseFailure, fallback = "请求格式不正确"): Response {
  return c.json({ error: parsed.error.issues[0]?.message ?? fallback }, 400);
}
