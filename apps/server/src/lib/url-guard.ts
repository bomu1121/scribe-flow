/**
 * 用户提供的 URL 在服务端发起请求前的目标校验（SSRF 防线）。
 *
 * 本服务无认证，任何能连到端口的人都能让服务端替它取 URL；协议与私网网段
 * 在这里挡掉。域名解析到内网 IP（DNS 重绑定）不在此列——那是 Origin 守卫
 * 与「只绑本机」的部署假设负责的面。
 */
export function isBlockedFetchTarget(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal")) {
    return true;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
    if (octets.some((n) => n > 255)) return true; // 非法 IP 字面量，宁可拦错
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true; // 本网/内网/回环
    if (a === 169 && b === 254) return true; // 链路本地，含云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }

  if (host.includes(":")) {
    // IPv6 字面量：未指定/回环/私有/链路本地，以及 v4 映射地址。
    // 注意 URL 会把 ::ffff:10.0.0.1 归一化成十六进制 ::ffff:a00:1，两种形态都要认。
    if (host === "::" || host === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = Number.parseInt(mappedHex[1], 16);
      const lo = Number.parseInt(mappedHex[2], 16);
      return isBlockedFetchTarget(new URL(`http://${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`));
    }
    const mapped = host.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isBlockedFetchTarget(new URL(`http://${mapped[1]}`));
    return false;
  }

  return false;
}
