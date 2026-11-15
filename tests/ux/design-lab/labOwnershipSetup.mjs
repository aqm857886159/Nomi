// 视觉基线跑之前的**端口归属断言**（Playwright globalSetup）。
//
// 这是整趟跑里第一个碰到服务器的地方，也是像素被信任之前的最后一道：答话的那个进程必须是本树的
// （labServer.mjs 是那条不变量的 owner）。手工 `npx playwright test` 不经过门岗脚本，但经过 globalSetup——
// 断言放这儿，两条入口一次覆盖。
//
// 2026-11-14 以前这里还有一段预热：开发服务器冷启动要预打包依赖、中途整页重载，头几条用例会撞上半渲染帧。
// 换成对着打包产物跑以后没有冷启动这回事，预热连同它的机器标记一起删了。
import { assertLabPortOwnership } from './labServer.mjs'

export default async function labOwnershipSetup() {
  // foreign 直接抛：在别人的服务器上截图 = 拿别的分支的 UI 当自己的基线。
  assertLabPortOwnership('visual')
}
