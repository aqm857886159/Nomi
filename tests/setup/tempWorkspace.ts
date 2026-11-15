import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MCP_CLIENT_HOST_ENV_VARS } from "../../electron/shared/mcpClientRegistry";

const TEMP_KEYS = ["TMPDIR", "TEMP", "TMP"] as const;
/** 能力目录（token / 实例登记 / 批准收据密钥）的覆盖变量；名字的 owner 是 electron/capabilityCore/security.ts。 */
const CAPABILITY_DIR_KEY = "NOMI_CAPABILITY_DIR";

export type TempWorkspace = {
  root: string;
  teardown: () => void;
};

/**
 * Own one Vitest run's scratch space and restore the host environment after it.
 *
 * 宿主自己的配置位置变量（CLAUDE_CONFIG_DIR / CODEX_HOME …，名单只在注册表）整轮摘掉：产品按宿主规则跟着它们读写，
 * 单测把主目录换成临时目录、却挡不住开发者 shell 里继承来的这几个变量——不摘，`installMcp('codex')` 一类单测
 * 就写进开发者真实的 $CODEX_HOME/config.toml。要测「设了变量」的用例自己 vi.stubEnv（unstubEnvs 会还原成摘掉的样子）。
 *
 * 能力目录同理：整轮把 NOMI_CAPABILITY_DIR 指到本轮自己的 <root>/capability（外面设了也盖掉）。不指的话，任何调到
 * ensureToken() / 批准收据密钥的单测都落在创作者真实的 ~/.nomi/capability-core（令牌、批准收据密钥）。
 * 所有 worker 共用这一处，不靠每条测试自己 stub。
 */
export function createTempWorkspace(
  env: NodeJS.ProcessEnv = process.env,
  tempBase = os.tmpdir(),
): TempWorkspace {
  // 真路径：macOS 的 tmpdir 是 /var → /private/var 的链接，而子进程 cwd、git、import.meta.url 给的都是真路径。
  // 同一条规矩也在 scripts/_test-temp.mjs（node:test 那边）；两边都在 Linux 上用链接 TMPDIR 复现。
  const root = fs.realpathSync(fs.mkdtempSync(path.join(tempBase, "nomi-vitest-run-")));
  const keys = [...TEMP_KEYS, ...MCP_CLIENT_HOST_ENV_VARS, CAPABILITY_DIR_KEY];
  const previous = new Map<string, string | undefined>(keys.map((key) => [key, env[key]]));
  for (const key of TEMP_KEYS) env[key] = root;
  for (const key of MCP_CLIENT_HOST_ENV_VARS) delete env[key];
  env[CAPABILITY_DIR_KEY] = path.join(root, "capability");

  let tornDown = false;
  return {
    root,
    teardown() {
      if (tornDown) return;
      tornDown = true;
      // 先还原宿主环境，再删目录：删除失败也不能把临时目录的环境变量漏给后续进程。
      for (const key of keys) {
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

/** 创作者默认能力目录的「有没有 / 何时改过」快照；和 security.ts 的默认路径同一处算法（home/.nomi/capability-core）。 */
function defaultCapabilityDirStamp(): string {
  try {
    return String(fs.statSync(path.join(os.homedir(), ".nomi", "capability-core")).mtimeMs);
  } catch {
    return "absent";
  }
}

export function setup(): () => void {
  const before = defaultCapabilityDirStamp();
  const workspace = createTempWorkspace();
  return () => {
    workspace.teardown();
    // 事后断言：整轮单测没往默认能力目录里新建 / 删除过东西（有人绕过了上面那条变量，例如手写 spawn 或硬编码 home 路径）。
    // 只读 stat，不读里面的文件。创作者的 Nomi 正开着时它自己也会改这个目录，那种情况会误报——先关 Nomi 再跑。
    if (defaultCapabilityDirStamp() !== before) {
      throw new Error(
        "单测期间默认能力目录（主目录下 .nomi/capability-core）被改动：有测试绕过了 NOMI_CAPABILITY_DIR 隔离。" +
          "（若创作者的 Nomi 正开着，它自己也会改这个目录——关掉再跑。）",
      );
    }
  };
}
