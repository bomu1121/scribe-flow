import type { RunEvent } from "@scribe-flow/shared";

/**
 * SSE 订阅封装：自动重连，返回关闭函数。
 * M3 运行引擎接入后使用；M0 仅定义契约。
 */
export function subscribeRunEvents(runId: string, onEvent: (event: RunEvent) => void, onError?: (error: Event) => void): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (closed) return;
    source = new EventSource(`/api/runs/${runId}/events`);

    source.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data) as RunEvent);
      } catch {
        // 忽略无法解析的事件
      }
    };

    source.onerror = (ev) => {
      onError?.(ev);
      source?.close();
      source = null;
      if (!closed) {
        timer = setTimeout(connect, 2000);
      }
    };
  }

  connect();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    source?.close();
    source = null;
  };
}
