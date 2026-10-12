import { describe, expect, it } from "vitest";
import { isBlockedFetchTarget } from "./url-guard";

describe("SSRF 目标校验", () => {
  it("放行公网 http/https 与 B 站短链", () => {
    expect(isBlockedFetchTarget(new URL("https://www.bilibili.com/video/BV1xx411c7mD"))).toBe(false);
    expect(isBlockedFetchTarget(new URL("https://b23.tv/abc123"))).toBe(false);
    expect(isBlockedFetchTarget(new URL("http://8.8.8.8/whatever"))).toBe(false);
  });

  it("拦截非 http(s) 协议", () => {
    expect(isBlockedFetchTarget(new URL("file:///C:/Windows/win.ini"))).toBe(true);
    expect(isBlockedFetchTarget(new URL("ftp://example.com/x"))).toBe(true);
  });

  it("拦截 IPv4 私网/回环/链路本地/CGNAT 段", () => {
    for (const host of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "172.31.255.255", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isBlockedFetchTarget(new URL(`http://${host}/`)), host).toBe(true);
    }
    // 172.32 与 172.15 是网段外
    expect(isBlockedFetchTarget(new URL("http://172.32.0.1/"))).toBe(false);
    expect(isBlockedFetchTarget(new URL("http://172.15.0.1/"))).toBe(false);
  });

  it("拦截本机域名后缀与 IPv6 敏感段", () => {
    for (const host of ["localhost", "db.internal", "nas.lan", "printer.local", "[::1]", "[fc00::1]", "[fd12::1]", "[fe80::1]", "[::ffff:10.0.0.1]"]) {
      expect(isBlockedFetchTarget(new URL(`http://${host}/`)), host).toBe(true);
    }
    expect(isBlockedFetchTarget(new URL("http://[2606:4700::1]/"))).toBe(false);
  });
});
