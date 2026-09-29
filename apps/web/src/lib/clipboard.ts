import { toast } from "@/lib/toast";

/**
 * 复制一段文本到剪贴板，并按调用方的说法给一次提示。
 *
 * 浏览器拒绝写入（非安全上下文、无权限）时不抛错，只退回「手动选择文本」的提示——
 * 剪贴板失败不该打断调用方的主流程（如打开浮层、切换选中）。
 */
export async function copyText(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error("复制失败，请手动选择文本");
  }
}
