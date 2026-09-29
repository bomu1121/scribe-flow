/**
 * 触发一次浏览器下载：内存内容 → Blob → 临时 URL → `a.click()` → 立刻释放 URL。
 *
 * 与 `lib/clipboard.ts` 的 `copyText` 同一类：一次性 DOM 操作收在一处，
 * 免得每个导出入口各写一遍（少写一句 `revokeObjectURL` 就会把整份内容一直挂在内存里）。
 */
export function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
