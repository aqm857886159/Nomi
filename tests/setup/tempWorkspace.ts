import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMP_KEYS = ["TMPDIR", "TEMP", "TMP"] as const;

export type TempWorkspace = {
  root: string;
  teardown: () => void;
};

/** Own one Vitest run's scratch space and restore the host environment after it. */
export function createTempWorkspace(
  env: NodeJS.ProcessEnv = process.env,
  tempBase = os.tmpdir(),
): TempWorkspace {
  // 真路径：macOS 的 tmpdir 是 /var → /private/var 的链接，而子进程 cwd、git、import.meta.url 给的都是真路径。
  // 同一条规矩也在 scripts/_test-temp.mjs（node:test 那边）；两边都在 Linux 上用链接 TMPDIR 复现。
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tempBase, "nomi-vitest-run-")));
  const previous = new Map<string, string | undefined>(TEMP_KEYS.map((key) => [key, env[key]]));
  for (const key of TEMP_KEYS) env[key] = root;

  let tornDown = false;
  return {
    root,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      // 先还原宿主环境，再删目录：删除失败也不能把临时目录的环境变量漏给后续进程。
      for (const key of TEMP_KEYS) {
        const value = previous.get(key);
        if (value === undefined) delete env[key];
        else env[key] = value;
      }
      // Windows 上 Chromium 关窗后还会短暂锁住 profile 里的日志文件（EBUSY / EPERM）；
      // 交给 Node 自带的重试处理这类瞬时锁，不在测试里自己写等待。
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

export function setup(): () => void {
  return createTempWorkspace().teardown;
}
