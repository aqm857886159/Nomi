// 打包后「这个路径要交给**另一个进程**」时的唯一改写点。
//
// ── 为什么需要它 ──
//
// `app.asar` 是个只读归档文件，不是目录。Electron 给自己的 `fs` 打了补丁，所以主进程
// `readFileSync('.../app.asar/node_modules/x/bin/y')` 读得到；`existsSync` 也回 `true`。
// 但补丁只在**这个进程里**成立：`execve` 走的是内核，`java -javaagent:<path>` 走的是 JVM，
// 两个都不认识 asar，拿到同一个路径得到的是 `ENOTDIR`。
//
// 也就是说，asar 里的可执行文件有一个**最坏的失败形状**：`existsSync` 说有，spawn 说没有。
// 任何「先探在不在、再决定用哪条路」的上游库都会被它骗过去——库探到了，于是不走降级分支，
// 然后把一个跑不起来的路径交出去。electron-builder 的 `build.asarUnpack` 把这些文件额外
// 摊一份到 `app.asar.unpacked/` 下面（同样的相对路径），本函数就是把路径从归档里那份
// 指到摊开的那份。
//
// ── 它不做什么 ──
//
// 不做 `existsSync`。「文件在不在」是调用方的事：ffmpeg 那边探不到要报「没装」，
// 沙箱那边探不到要退回让上游自己找。把判断塞进来，两个调用方就都只能得到同一种处置。
import path from "node:path";

/**
 * 把 `.../app.asar/...` 指到 `.../app.asar.unpacked/...`；路径里没有 `app.asar` 时原样返回。
 *
 * `(?!\.unpacked)` 是防重入：已经改写过的路径再进来一次，不会变成 `app.asar.unpacked.unpacked`。
 */
export function asarUnpackedPath(candidate: string): string {
  if (!candidate.includes("app.asar")) return candidate;
  return candidate.replace(/app\.asar(?!\.unpacked)/g, "app.asar.unpacked");
}

/**
 * `asarUnpackedPath` 的 POSIX 分隔符版本，给要跨平台拼相对路径的调用方。
 *
 * 单独给一个入口而不是让调用方自己 `split/join`：改写规则只有一条，落点却有两种写法，
 * 两种写法各自散在调用点就是同一条规则的第二份定义。
 */
export function asarUnpackedJoin(base: string, ...segments: string[]): string {
  return asarUnpackedPath(path.join(base, ...segments));
}
