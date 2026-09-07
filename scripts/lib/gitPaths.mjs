// 从 git 读「路径列表」的唯一入口（2026-09-07）。
//
// 起因：git 默认 `core.quotePath=true`——凡是非 ASCII 的路径，`--name-only` / `ls-files`
// 这类输出会变成 `"docs/\344\270\255\346\226\207.md"`：外面裹一对引号，里面是八进制转义。
// pre-push 闸的 `is_docs_only()` 拿这串去比 `^docs/` 和 `\.md$`，两头都被引号挡掉，
// 于是**纯中文文件名的文档改动被判成「有代码改动」**，docs-only PR 白等五门。
//
// 这不是那一处的手滑，是一整族：本仓所有按路径分类（前缀 / 后缀）或按路径读文件的门岗
// 都从这两个命令取输入。落到别处的症状更隐蔽——路径被转义后 `fs.existsSync` 恒 false，
// 多数调用点又把读失败 try/catch 吞掉，门岗于是**静默少扫几个文件**，不报错也不报红
// （check:secrets 少扫一个文件 = 敏感数据从那个文件溜进公开仓库）。
//
// 修在最早的共享边界（P2）：这类调用一律走本模块，统一加 `-z`。
// 选 `-z` 而不是 `-c core.quotePath=false`：前者按 NUL 分隔，
// 顺手把「路径里含空格 / 换行」这一族也一起关掉，且不依赖任何配置项。
import { execFileSync } from 'node:child_process'

/** 把 `-z` 插在子命令后面（不能追加到末尾——`--` 之后会被当成 pathspec）。 */
function withNulTermination(args) {
  if (args.includes('-z')) return args
  return [args[0], '-z', ...args.slice(1)]
}

export function splitNulPaths(stdout) {
  return stdout.split('\0').filter(Boolean)
}

/**
 * 跑一条列路径的 git 命令，返回未转义的路径数组。
 * 用法与原来一致，只是别自己写 `-z`：`gitPaths(['diff', '--name-only', base, head])`。
 */
export function gitPaths(args, { cwd = process.cwd(), maxBuffer } = {}) {
  const stdout = execFileSync('git', withNulTermination(args), {
    cwd,
    encoding: 'utf8',
    ...(maxBuffer ? { maxBuffer } : {}),
  })
  return splitNulPaths(stdout)
}

/**
 * `git diff --name-status` 的 `-z` 版本：记录之间用 NUL 分隔，而**重命名/复制**
 * （`R100` / `C75`）会多占一条记录——`status\0旧路径\0新路径\0`。
 * 按行 split 的老写法读到的是 `R100\t旧\t新`，一旦路径被转义就连状态字母都对不上。
 */
export function gitNameStatus(args, options = {}) {
  const records = splitNulPaths(execFileSync('git', withNulTermination(args), {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
  }))
  const entries = []
  for (let i = 0; i < records.length; i += 1) {
    const status = records[i]
    if (!/^[A-Z]/.test(status)) continue
    const takesTwoPaths = status.startsWith('R') || status.startsWith('C')
    const target = takesTwoPaths ? records[i + 2] : records[i + 1]
    i += takesTwoPaths ? 2 : 1
    if (target) entries.push({ status, path: target })
  }
  return entries
}
