import { describe, expect, it } from "vitest";
import { hrefToRemotePath, parseMultistatus, remoteToUrl } from "./nutstore";

const config = { serverUrl: "https://dav.jianguoyun.com/dav/", account: "user@example.com", password: "app-password" };

const SAMPLE_MULTISTATUS = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/ScribeFlow/Obsidian/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getlastmodified>Thu, 01 Jan 2026 00:00:00 GMT</D:getlastmodified>
        <D:getetag>"abc-1"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/ScribeFlow/Obsidian/%E6%B5%8B%E8%AF%95.md</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype/>
        <D:getcontentlength>123</D:getcontentlength>
        <D:getlastmodified>Fri, 02 Jan 2026 00:00:00 GMT</D:getlastmodified>
        <D:getetag>"abc-2"</D:getetag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

describe("nutstore WebDAV helper", () => {
  it("解析 PROPFIND multistatus 并正确识别目录/文件", () => {
    const parsed = parseMultistatus(SAMPLE_MULTISTATUS);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ href: "/dav/ScribeFlow/Obsidian/", isDirectory: true });
    expect(parsed[1]).toMatchObject({
      href: "/dav/ScribeFlow/Obsidian/%E6%B5%8B%E8%AF%95.md",
      isDirectory: false,
      size: 123,
      etag: '"abc-2"',
    });
  });

  it("把服务器 href 还原为逻辑远程路径并解码中文", () => {
    expect(hrefToRemotePath(config, "/dav/ScribeFlow/Obsidian/测试.md")).toBe("/ScribeFlow/Obsidian/测试.md");
    expect(hrefToRemotePath(config, "/dav/ScribeFlow/Obsidian/")).toBe("/ScribeFlow/Obsidian");
  });

  it("把逻辑远程路径拼接到 dav 根 URL，保留中文编码", () => {
    expect(remoteToUrl(config, "/ScribeFlow/Obsidian/测试.md")).toBe("https://dav.jianguoyun.com/dav/ScribeFlow/Obsidian/%E6%B5%8B%E8%AF%95.md");
  });
});
