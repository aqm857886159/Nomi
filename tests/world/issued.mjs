// 「这个世界是 buildWorld / seedOldUserData 发的」的登记。纯 JS、不引产品代码：走查启动器（plain node）只验这个，
// 不必为了验一个标记去加载整个主人模块图。tests/world/index.ts 发世界时登记，launchNomiApp({ world }) 和 damageWorldFile 查。
const issued = new WeakSet()

export function markWorldIssued(world) {
  issued.add(world)
  return world
}

export function isIssuedWorld(value) {
  return typeof value === 'object' && value !== null && issued.has(value)
}
