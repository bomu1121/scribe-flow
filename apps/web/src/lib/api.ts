/** 统一的 API 请求封装：中文错误信息，JSON 进出。 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  status: number;
  /**
   * 服务端的错误体原文。
   *
   * 「需要用户确认」这类结果（`needConfirmStaleMaterial`）与真失败共用非 2xx，
   * 只看文案分不开，所以把整个 body 带出来给调用方判断。
   */
  detail: Record<string, unknown>;

  constructor(message: string, status: number, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    body: init.body instanceof FormData ? init.body : init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    let message = `请求失败（${res.status}）`;
    let detail: Record<string, unknown> = {};
    try {
      detail = (await res.json()) as Record<string, unknown>;
      message = (detail.error as string | undefined) ?? (detail.message as string | undefined) ?? message;
    } catch {
      // 忽略非 JSON 错误体
    }
    throw new ApiError(message, res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};
