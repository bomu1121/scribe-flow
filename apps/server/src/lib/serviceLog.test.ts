import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openServiceLog } from "./serviceLog";

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "sf-servicelog-"));
}

function tombstonePath(dataDir: string): string {
  return join(dataDir, "logs", "service.running");
}

/**
 * 墓碑机制是「服务重启导致运行中断」唯一查得到的原因线索（`node --watch` 重启不发信号，
 * 进程内来不及写任何东西，见 serviceLog.ts 顶部说明），所以这里把三种形态都钉住：
 * 没有墓碑＝正常退出、有墓碑＝被替换/强杀、墓碑损坏＝仍然算异常但没有身份。
 */
describe("openServiceLog", () => {
  it("首次启动没有墓碑，日志写在 data/logs 下并立起本次墓碑", () => {
    const dataDir = makeDataDir();
    const log = openServiceLog(dataDir);

    expect(log.previousRun).toBeNull();
    expect(log.file).toBe(join(dataDir, "logs", "service.log"));

    log.write("一条测试记录");
    expect(readFileSync(log.file, "utf8")).toContain("一条测试记录");
    expect(existsSync(tombstonePath(dataDir))).toBe(true);

    log.clearTombstone();
    expect(existsSync(tombstonePath(dataDir))).toBe(false);
  });

  it("墓碑还在＝上次没正常退出，带上上次的 pid 与启动时间", () => {
    const dataDir = makeDataDir();
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    writeFileSync(tombstonePath(dataDir), JSON.stringify({ pid: 42488, startedAt: 1759000000000 }), "utf8");

    const log = openServiceLog(dataDir);

    expect(log.previousRun).toEqual({ pid: 42488, startedAt: 1759000000000 });
    log.clearTombstone();
  });

  it("墓碑损坏也算「上次没正常退出」，只是不知道是谁——不能当成没发生过", () => {
    const dataDir = makeDataDir();
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    writeFileSync(tombstonePath(dataDir), "{写到一半就被杀", "utf8");

    const log = openServiceLog(dataDir);

    expect(log.previousRun).toEqual({ pid: null, startedAt: null });
    log.clearTombstone();
  });

  it("正常退出清掉墓碑后，下次启动不再报「上次未正常退出」（幂等、可反复）", () => {
    const dataDir = makeDataDir();
    const first = openServiceLog(dataDir);
    first.clearTombstone();

    const second = openServiceLog(dataDir);
    expect(second.previousRun).toBeNull();
    second.clearTombstone();
  });

  it("后一次启动会覆盖前一次的墓碑（哪怕前一次没清）", () => {
    const dataDir = makeDataDir();
    openServiceLog(dataDir);
    const second = openServiceLog(dataDir);

    const raw = JSON.parse(readFileSync(tombstonePath(dataDir), "utf8")) as { pid: number };
    expect(raw.pid).toBe(process.pid);
    expect(second.previousRun).not.toBeNull();
    second.clearTombstone();
  });
});
