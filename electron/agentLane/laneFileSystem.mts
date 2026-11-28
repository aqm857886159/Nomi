// Agent lane · 会话落盘的**权限**（`0o600` 文件 / `0o700` 目录）
//
// 会话 jsonl 里装的是用户的**原稿正文**——他写的每一段、模型读回去的每一个字、写进去的每一次修改，
// 全是 `JSON.stringify(entry)` 原样落盘。而 pi 的 `SessionManager` 写入默认不带 `0o600` mode，
// 落地就是 `0o666 & ~umask` ≈ **`0o644`，世界可读**。
//
// Nomi 把会话写进 `<project>/.nomi/`，那是用户会用 Finder 打开、会同步到网盘、会打包发给协作者的目录。
// **chmod 失败 = 写入失败（fail-closed）**：无法兑现「只有你能读」这句承诺时绝不静默降级。
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 会话文件：只有属主能读写。与 pi 自己给 `auth.json` 的档位一致。 */
export const LANE_FILE_MODE = 0o600;
/** 对话身份的根（`laneSessionCwd` 的前缀）。写进表头、算 slug、列表认对话都只认这一个串，它不是宿主路径。 */
export const LANE_IDENTITY_ROOT = '/nomi-lane/';
/** 会话目录：只有属主能进。目录不设防的话，里面的文件设了也只是挡了一半。 */
export const LANE_DIR_MODE = 0o700;

export class LaneSessionPermissionError extends Error {
  readonly code = 'permission_denied';
  constructor(readonly path: string, cause: unknown) {
    super(
      `Refused to keep ${path}: the agent transcript holds the user's manuscript and its permissions could not be restricted to the owner (${String(cause)})`,
      { cause },
    );
    this.name = 'LaneSessionPermissionError';
  }
}

/**
 * 先把会话根或子目录建成 `0o700`。
 * `mkdir` 的 mode 会被 umask 削一刀，而 `chmod` 不会；已经存在的旧目录也在这里被收紧。
 */
export async function ensureLaneSessionsRoot(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: LANE_DIR_MODE });
  await chmod(directory, LANE_DIR_MODE);
}

/** 每次落盘后收紧文件 `0o600` 与直接父目录 `0o700`（fail-closed）。 */
export async function hardenLaneSessionFile(absolutePath: string): Promise<void> {
  try {
    await chmod(absolutePath, LANE_FILE_MODE);
    await chmod(dirname(absolutePath), LANE_DIR_MODE);
  } catch (cause) {
    throw new LaneSessionPermissionError(absolutePath, cause);
  }
}
