import { describe, expect, it } from "vitest";
import { RETRYABLE_NODE_TYPES, describeError, isRetryableError } from "./engine";

/** 构造带 cause 的错误链（Error.cause 在构造参数里打类型补丁较繁琐，直接赋值）。 */
function withCause<T extends Error>(error: T, cause: unknown): T {
  Object.assign(error, { cause });
  return error;
}

describe("RETRYABLE_NODE_TYPES", () => {
  it("source.bili 也应自动重试（B 站下载常遇瞬时网络错误）", () => {
    expect(RETRYABLE_NODE_TYPES.has("source.bili")).toBe(true);
  });
});

describe("isRetryableError", () => {
  it("网络瞬时错误（fetch failed）可重试", () => {
    expect(isRetryableError(new TypeError("fetch failed"), false)).toBe(true);
  });

  it("媒体层包装过的传输错误仍可重试", () => {
    const connect = new Error("Connect Timeout Error (attempted address: 203.0.113.1:443, timeout: 10000ms)");
    connect.name = "ConnectTimeoutError";
    const fetchErr = withCause(new TypeError("fetch failed"), connect);
    const wrapped = withCause(new Error("获取播放地址失败（BV1kZt16MEh5）：fetch failed"), fetchErr);
    expect(isRetryableError(wrapped, false)).toBe(true);
  });

  it("永久性 B 站错误不重试", () => {
    expect(isRetryableError(new Error("B 站登录已失效，请重新扫码登录"), false)).toBe(false);
    expect(isRetryableError(new Error("该视频没有可下载的音轨"), false)).toBe(false);
  });

  it("取消与配置类错误不重试", () => {
    expect(isRetryableError(new Error("fetch failed"), true)).toBe(false);
    expect(isRetryableError(new Error("未配置 AI 模型密钥，请到设置页填写"), false)).toBe(false);
  });
});

describe("describeError", () => {
  it("展开 fetch failed 的 cause 链，不再只显示表层消息", () => {
    const connect = new Error("Connect Timeout Error (attempted address: 203.0.113.1:443, timeout: 10000ms)");
    connect.name = "ConnectTimeoutError";
    const fetchErr = withCause(new TypeError("fetch failed"), connect);
    const out = describeError(fetchErr);
    expect(out).toContain("fetch failed");
    expect(out).toContain("Connect Timeout Error");
  });

  it("cause 消息与上层重复时不重复拼接", () => {
    const inner = new Error("fetch failed");
    const outer = withCause(new Error("音轨下载失败（BV1kZt16MEh5）：fetch failed"), inner);
    expect(describeError(outer)).toBe("音轨下载失败（BV1kZt16MEh5）：fetch failed");
  });

  it("无 cause 时保持原消息，超长截断", () => {
    expect(describeError(new Error("B 站链接为空"))).toBe("B 站链接为空");
    const long = describeError(new Error("x".repeat(1000)));
    expect(long.length).toBeLessThanOrEqual(400);
  });
});
