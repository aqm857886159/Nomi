// 整库类型检查实际编译哪些 tsconfig 的唯一正本（scripts/typecheck.mjs、scripts/check-test-types.mjs、推送前的选择器都从这里读）。
// 2026-10-09 复审：推送前选择器曾手写一份目录清单，选中的文件有一大半根本没有任何 tsc program 编译——选择范围和实际执行脱节。
export const TYPECHECK_PROJECTS = Object.freeze({
  app: 'tsconfig.app.json',
  electron: 'electron/tsconfig.json',
  electronPi: 'electron/tsconfig.pi.json',
  // check:test-types 的两份：全部测试文件 / agent-runtime 原生测试
  test: 'tsconfig.test.json',
  nativeTest: 'tests/agent-runtime/tsconfig.json',
})

/** 配置文件本身与它们 extends 的公共配置：改了就等于改了所有 program 的编译选项。 */
export const TYPECHECK_SHARED_CONFIGS = Object.freeze(['tsconfig.json', 'tsconfig.base.json'])
