import type fs from 'node:fs';

/**
 * 「还是不是同一个文件」的唯一判断。只吃 `{ bigint: true }` 的 stat：
 * - Windows 的 ino 是 64 位文件 ID，超过 2^53，用 Number 取会丢低位，相邻两个文件会被当成同一个；
 * - 旧 libuv（<1.51，Node 22.x 常见）在 Windows 上按路径 lstat/stat 的 dev 恒为 0，按句柄 fstat 才是真卷号，
 *   两边 dev 永远对不上；新 libuv（Electron 43 / Node 24）已一致。所以 dev 只在两边都报了非 0 时才比，
 *   ino 永远比。dev 为 0 既不能当「同卷」也不能当「不同卷」的证据，换文件仍由 ino 拦。
 * 来源：libuv/libuv#4698 与 affaan-m/ECC#3041（同一差异）。
 * docs/fixes/2026-10-06-windows-legacy-file-identity.root-cause.json
 */
export function sameFileIdentity(left: fs.BigIntStats, right: fs.BigIntStats | undefined): boolean {
  if (!right || left.ino !== right.ino) return false;
  return left.dev === 0n || right.dev === 0n || left.dev === right.dev;
}
