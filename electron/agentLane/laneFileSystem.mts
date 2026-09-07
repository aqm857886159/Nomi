// Agent lane · 会话落盘的**权限**（`0o600` 文件 / `0o700` 目录）
//
// 它在解决哪个真实摩擦：会话 jsonl 里装的是用户的**原稿正文**——他写的每一段、
// 模型读回去的每一个字、写进去的每一次修改，全是 `JSON.stringify(entry)` 原样落盘。
// 而 pi 自己的写入一律不带 mode（`harness/env/nodejs.js:636` `writeFile(resolved, content)`、
// `:654` `appendFile(resolved, content)`），落地就是 `0o666 & ~umask` ≈ **`0o644`，世界可读**。
//
// 上游在这里**自己就不一致**：同一个产品里 `auth.json` 是刻意的 `0o600`，转录却是 `0o644`
// （参考实现核对 §9.5）。别抄这个不一致——Nomi 把会话写进 `<project>/.nomi/`，那是用户会用
// Finder 打开、会同步到 iCloud、会打包发给协作者的目录。
//
// **为什么用原型委托而不是逐个方法转发**：`FileSystem` 有 18 个方法，我们只想改其中两个的
// **后置动作**。手抄 16 个「原样转发」的方法，等于把 pi 每次加方法都变成我们这里的一处静默
// 缺口（新方法会落到 `undefined` 而不是委托）。`Object.create(base)` 让「没被改写的一律走原样」
// 成为结构事实，而不是一份需要维护的清单。
//
// **chmod 失败 = 写入失败（fail-closed）**：能走到这一行说明文件已经落到盘上了，
// 而我们无法兑现「只有你能读」这句承诺。静默降级的后果是用户的原稿在一个他以为私密的
// 目录里世界可读，而系统认为一切正常——那正是 §9.5 想避免的那件事（D4：缺口明着标）。
import { chmod, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/harness/env/nodejs';
import { err, FileError, type FileSystem } from '@earendil-works/pi-agent-core';

/** 会话文件：只有属主能读写。与 pi 自己给 `auth.json` 的档位一致。 */
export const LANE_FILE_MODE = 0o600;
/** 会话目录：只有属主能进。目录不设防的话，里面的文件设了也只是挡了一半。 */
export const LANE_DIR_MODE = 0o700;

async function harden(absolutePath: string): Promise<FileError | undefined> {
  try {
    await chmod(absolutePath, LANE_FILE_MODE);
    await chmod(dirname(absolutePath), LANE_DIR_MODE);
    return undefined;
  } catch (cause) {
    return new FileError(
      'permission_denied',
      `Refused to keep ${absolutePath}: the agent transcript holds the user's manuscript and its permissions could not be restricted to the owner (${String(cause)})`,
      absolutePath,
    );
  }
}

/**
 * 先把会话根建成 `0o700`，再把它交给 pi。
 *
 * 为什么这一步不能省给下面的装饰器：pi 的 `writeFile` 用 `mkdir(recursive)` 顺手把
 * **整条**父目录链建出来，而装饰器只看得见「文件的直接父目录」。少了这一步，
 * `<project>/.nomi/agent-sessions/` 这一层会停在 `0o755`。
 */
export async function ensureLaneSessionsRoot(sessionsRoot: string): Promise<void> {
  await mkdir(sessionsRoot, { recursive: true, mode: LANE_DIR_MODE });
  // `mkdir` 的 mode 会被 umask 削一刀，而 chmod 不会。已经存在的旧目录也在这里被收紧。
  await chmod(sessionsRoot, LANE_DIR_MODE);
}

/**
 * pi 的 `NodeExecutionEnv`，外加「写完就收紧权限」。
 *
 * **`renameFile` 一个字都不改**是刻意的：pi 0.84.0 起要求它是「同文件系统的原子替换、
 * 不跨卷复制」（`harness/types.d.ts:189`），`NodeExecutionEnv` 用的就是 `node:fs/promises`
 * 的 `rename`（`env/nodejs.js:668`）——`rename(2)` 本身要么原子替换、要么 `EXDEV` 失败，
 * 从不退化成 copy+delete。而 `publishFileAtomically` 的临时文件是目标的**同目录兄弟**
 * （`session/jsonl/storage.js:71` `${destinationPath}.tmp`），所以「同文件系统」是结构事实，
 * 与用户把项目放在 iCloud 还是外接盘无关。我们唯一能破坏这条的方式就是自己写一个
 * `FileSystem`——所以我们不写。
 */
export function createLaneFileSystem(projectDir: string): FileSystem {
  const base = new NodeExecutionEnv({ cwd: projectDir });
  const absolute = (path: string) => (isAbsolute(path) ? path : resolve(base.cwd, path));
  const restricted: FileSystem = Object.create(base);

  const write: FileSystem['writeFile'] = async (path, content, context) => {
    const result = await base.writeFile(path, content, context);
    if (!result.ok) return result;
    const failure = await harden(absolute(path));
    return failure ? err<void, FileError>(failure) : result;
  };

  const append: FileSystem['appendFile'] = async (path, content, context) => {
    const result = await base.appendFile(path, content, context);
    if (!result.ok) return result;
    const failure = await harden(absolute(path));
    return failure ? err<void, FileError>(failure) : result;
  };

  restricted.writeFile = write;
  restricted.appendFile = append;

  return restricted;
}
