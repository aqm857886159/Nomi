// UI 驱动 IPC 目录的单一真相源（driver 与 client 同源计算 → 必然一致）。
//
// 为什么不写死 /tmp/nomi-ui：这台机器同时跑多个 worktree/会话，写死的共享目录会让
// 一个会话的 ui.mjs 命令被另一个会话的 driver 接走、遥控错的 app（栽过：命令路由到
// Nomi-sb 的 app，甚至可能触发它的「生成 AI 发送」花额度）。按 worktree 根派生唯一目录，
// 各会话只跟自己的 app 通信，互不串台。
//
// 覆盖：设 NOMI_UI_DIR 显式指定（CI / 调试用）。
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// 本文件固定在 <worktree>/tests/ux/uiDir.mjs → 上两级 = 当前 worktree 根。
// driver 与 client 都从各自 import 本文件计算，得到同一个 worktree 的同一个目录。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const UI_DIR =
  process.env.NOMI_UI_DIR ||
  path.join(os.tmpdir(), "nomi-ui-" + crypto.createHash("sha1").update(repoRoot).digest("hex").slice(0, 10));
