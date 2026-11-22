// 「这个世界是 buildWorld / seedOldUserData 发的」的登记。纯 JS、不引产品代码：走查启动器（plain node）只验这个，
// 不必为了验一个标记去加载整个主人模块图。tests/world/index.ts 发世界时登记，launchNomiApp({ world }) 和 damageWorldFile 查。
// 登记表挂在进程级的 globalThis[Symbol.for(...)] 上：走查里 tests/ux/_world.mjs 经 tsx 的 CJS 加载 index.ts（连带这个文件），
// 启动器用 ESM 引这个文件——同一文件会被加载成两份（Node 文档的「双包隐患」），表若是模块里的变量就各管各的，
// buildWorld 发的世界在启动器那边成了「没发过」。tests/ux/launcherDirs.test.mjs 用纯 node 子进程钉着这一条。
const REGISTRY = Symbol.for('nomi.test-world.issued')
const issued = (globalThis[REGISTRY] ??= new WeakSet())

export function markWorldIssued(world) {
  issued.add(world)
  return world
}

export function isIssuedWorld(value) {
  return typeof value === 'object' && value !== null && issued.has(value)
}
