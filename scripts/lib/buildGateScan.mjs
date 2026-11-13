// 门岗纯函数：谁在起 / 加载仓库里的构建产物（dist、dist-electron），谁就必须先核构建戳。
//
// 起因（G-walk-build）：构建戳（scripts/package-build-stamp.mjs）只有付费跑核，免费的走查 / e2e / 性能驱动 /
// MCP 真机都不核，于是「通过」和截图可能来自旧构建。修法在共享边界：launchNomiApp 与几个直接起 Electron 的
// 入口起跑前调 assertFreshBuild；本门岗保证新入口绕不开它。

/** 唯一允许自己调 Electron 并把核戳放在里面的启动器。 */
export const BUILD_LAUNCHER = 'tests/ux/_launchApp.mjs'

/** 满足门岗的写法：自己核戳，或走已核戳的启动器。 */
const GATED = /\b(assertFreshBuild|assertBuilt|launchNomiApp|verifyBuild)\b/

/**
 * 用 Electron 二进制起的是**别的东西**、并不加载仓库构建产物的文件。逐条写明理由；新增要有同样的理由，
 * 起 / 加载构建产物的一律不许进这里。
 */
export const NON_BUILD_SPAWNERS = {
  'tests/network/run-proxy-cold.mjs': '只跑自带的 proxy-cold-main.cjs，文件头声明不碰 dist-electron',
}

const stripComments = (source) => source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n')

/** 把 Electron 当可执行文件用（非解构的 require('electron')）或经 Playwright 的 _electron 起 App。 */
function usesElectronBinary(code) {
  return code.split('\n').some((line) => {
    if (/\b_electron\b\s*(as\b|\.|,|\})/.test(line) && /playwright/.test(code)) return /import\b.*\b_electron\b|\{\s*_electron\b/.test(line)
    if (!/require\(\s*['"]electron['"]\s*\)/.test(line)) return false
    return !/\{[^}]*\}\s*=\s*require\(\s*['"]electron['"]\s*\)/.test(line) // 解构 = 在 Electron 进程里取 app / ipcMain，不是起它
  })
}

/**
 * @param {{ rel: string, source: string }[]} files  rel 用正斜杠
 * @returns {string[]} 违规描述
 */
export function findUngatedBuildConsumers(files) {
  const problems = []
  for (const { rel, source } of files) {
    if (rel.endsWith('.cjs')) continue // .cjs 是跑在 Electron 进程里的主进程探针 / 注入模块（-r），本身不是启动方
    const code = stripComments(source)
    if (rel === BUILD_LAUNCHER) {
      if (!/\bassertFreshBuild\s*\(/.test(code)) problems.push(`${rel}: 启动器没调 assertFreshBuild —— 走查会跑在旧构建上`)
      continue
    }
    if (!usesElectronBinary(code)) continue
    if (NON_BUILD_SPAWNERS[rel]) continue
    if (!GATED.test(code)) {
      problems.push(`${rel}: 起 Electron / 加载构建产物却没核构建戳 —— 改用 launchNomiApp()，或起跑前调 assertFreshBuild(repoRoot)（scripts/package-build-stamp.mjs）`)
    }
  }
  return problems
}
