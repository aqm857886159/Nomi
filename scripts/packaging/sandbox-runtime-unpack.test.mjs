// 打包门岗 · `@anthropic-ai/sandbox-runtime` 的 `vendor/` 必须落在 asar **外面**。
//
// ── 起因（2026-09-12）──
//
// `build.asarUnpack` 原先只列了 ffmpeg/ffprobe 两家。沙箱运行时随 `dependencies` 进包，
// 于是它的 `vendor/` 二进制（Linux 的 `apply-seccomp`、Windows 的 `srt-win.exe`、
// java agent 的 jar）全被压进 `app.asar`。asar 是**只读归档文件，不是目录**：里面的路径
// 能被本进程打了补丁的 `fs` 读到，但不能被 `execve`，也不能被 JVM 当 `-javaagent:` 打开。
//
// ── 这个门岗守的到底是什么 ──
//
// 不是「今天对不对」——今天对不对由真机打包证据回答（`tests/ux/packaged-sandbox-active.e2e.mjs`，
// 以及教训文件里记的那两次实测）。它守的是**上游升级把二进制挪了位置时会不会有人知道**：
//
//   ① 清单断言——「会被交给另一个进程打开」的资产集合要和记录的一致。上游把 `apply-seccomp`
//      从 `vendor/seccomp/<arch>/` 挪进 `dist/bin/`，`vendor/**` 这条通配符照样绿（它罩的是
//      一个还存在的目录），但清单变了 → 红，逼人回来重看这份分析还成不成立。
//   ② 覆盖断言——清单里每一个资产都得被某条 asarUnpack 通配符罩住，两种写法都要罩住
//      （见下面 pnpm 那段）。有人把通配符收窄时当场红。
//
// ── 为什么只解包 `vendor/`，不解包 `dist/` ──
//
// `dist/` 是 JS，由**本进程**的 ESM loader 读，Electron 的 asar 补丁对它成立——实测在
// 归档里也能 `import` 并成功 `SandboxManager.initialize()`。解包它不会让任何事变好：
// 运行时用 `import.meta.url` 找 vendor 时，拿到的仍然是**加载路径**（`app.asar/...`），
// 不是解包副本的路径。这一条是整件事最反直觉的地方，也是为什么光加通配符修不好这个 bug：
// 真正让二进制被用上的是我们显式传进去的那三个路径
// （`electron/agentLane/laneCodingSandbox.mts` 的 `laneSandboxVendorPaths`）。
// 通配符负责「盘上有一份真的」，显式路径负责「有人指到那一份」——两半缺一不可。
//
// ── 为什么要两条通配符 ──
//
// pnpm 布局里 `node_modules/@anthropic-ai/sandbox-runtime` 是**符号链接**，真文件躺在
// `node_modules/.pnpm/@anthropic-ai+sandbox-runtime@<version>/node_modules/...`。
// ffmpeg 那两条（`node_modules/@ffmpeg-installer/**` + `node_modules/.pnpm/@ffmpeg-installer+*/**`）
// 是同一个理由，本测试把这条成对关系也断言住。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

const PACKAGE_NAME = '@anthropic-ai/sandbox-runtime'
/** 安装后 pnpm 建的那根符号链接（electron-builder 打包时看到的名字）。 */
const LINK_DIR = `node_modules/${PACKAGE_NAME}`

/**
 * 「会被交给另一个进程打开」的资产清单（相对包根）。
 *
 * 判据是**它会不会被当文件交给另一个进程**，不是「它是不是二进制」：
 *   · `vendor/seccomp/<arch>/apply-seccomp` —— Linux 上 bwrap 直接 exec 它；
 *   · `vendor/srt-win/<arch>/srt-win.exe` —— Windows broker，spawn 的就是这个路径；
 *   · `vendor/java-proxy-agent/srt-proxy-agent.jar` —— 以 `-javaagent:<path>` 交给 JVM 打开，
 *     JVM 不认识 asar，路径在归档里等于不存在。
 * `vendor/**\/build.ts` 是上游自己的构建脚本，运行时一次都不碰，不在清单里。
 * `dist/cli.js` 带 x 位（package.json 的 `bin`），但 Nomi 从不 spawn 它——它在「带 x 位」
 * 那一栏里，不在「我们要解包」那一栏里，所以下面两个清单是分开的两份。
 */
const SPAWNED_ASSETS = Object.freeze([
  'vendor/java-proxy-agent/srt-proxy-agent.jar',
  'vendor/seccomp/arm64/apply-seccomp',
  'vendor/seccomp/x64/apply-seccomp',
  'vendor/srt-win/arm64/srt-win.exe',
  'vendor/srt-win/x64/srt-win.exe',
])

/** 包里所有带 x 位或可执行扩展名的文件。多出一个 = 上游加了新的外部资产，回来重判它属于哪一栏。 */
const EXECUTABLE_SHAPED_FILES = Object.freeze([...SPAWNED_ASSETS, 'dist/cli.js'])

/** glob → RegExp。只支持本文件用到的 `**` / `*` 两种，够用且看得懂（不引第三方匹配器）。 */
function globToRegExp(pattern) {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 1
        if (pattern[index + 1] === '/') index += 1
      } else {
        source += '[^/]*'
      }
      continue
    }
    source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

function packageRoot() {
  // 走 require.resolve 而不是拼路径，拿到的就是 pnpm 真实落盘的那个目录（符号链接已解开）。
  return path.resolve(path.dirname(require.resolve(`${PACKAGE_NAME}/package.json`)))
}

function relativeToRepo(absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join('/')
}

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const patterns = manifest.build.asarUnpack ?? []
const matchers = patterns.map((pattern) => ({ pattern, test: globToRegExp(pattern) }))
const matched = (candidate) => matchers.some((matcher) => matcher.test.test(candidate))

describe('沙箱运行时的 vendor 二进制必须解包到 asar 外面', () => {
  it('包真的装着——测试自己先证明它在看真东西', () => {
    expect(fs.existsSync(path.join(packageRoot(), 'package.json'))).toBe(true)
  })

  it('可执行形状的文件清单没漂——上游挪了位置就红，逼人重看这份分析', () => {
    const root = packageRoot()
    const found = []
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        const executableBit = (fs.statSync(full).mode & 0o111) !== 0
        if (executableBit || /\.(?:exe|jar|dll|node|so|dylib)$/.test(entry.name)) {
          found.push(path.relative(root, full).split(path.sep).join('/'))
        }
      }
    }
    walk(root)
    expect(found.sort()).toEqual([...EXECUTABLE_SHAPED_FILES].sort())
  })

  it('每个被 spawn 的资产，两条路径（pnpm 链接名与真实落盘处）都被某条通配符罩住', () => {
    const root = packageRoot()
    for (const asset of SPAWNED_ASSETS) {
      expect({ asset, covered: matched(`${LINK_DIR}/${asset}`) }).toEqual({ asset, covered: true })
      expect({ asset, covered: matched(`${relativeToRepo(root)}/${asset}`) }).toEqual({ asset, covered: true })
    }
  })

  it('清单里的每个资产在盘上真的存在——路径写错时覆盖断言会假绿', () => {
    const root = packageRoot()
    for (const asset of SPAWNED_ASSETS) {
      expect({ asset, onDisk: fs.existsSync(path.join(root, ...asset.split('/'))) })
        .toEqual({ asset, onDisk: true })
    }
  })
})
