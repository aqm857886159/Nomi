#!/usr/bin/env node
// 裸 NUL 字节门岗（2026-09-02）。抓的是一类**没有任何报错的**失效：源文件对 grep 和 git 隐身。
//
// 起因：源码里把复合键分隔符写成了**字面 U+0000 字节**（而不是 `\0` 转义）。运行期毫无区别，
// 但 git 和 grep 都用「文件里有没有 NUL」来判定二进制，于是那个文件：
//   · `grep -rn "某符号" <该文件>` **一条不出、且不报任何错**——它只是被安静地跳过了。
//     全仓搜索（审计、重构、安全扫查、subagent 的搜索）从此有看不见的盲区。
//     2026-09-02 实测：`grep -an "expectNoCjkInEnglishDom" tests/ux/_assert.mjs` 零命中，
//     我一度据此认定该函数不在这个文件里——它就在第 232 行。
//   · `git diff` 显示 `Bin 3372 -> 3703 bytes` 而不是行 diff，于是这个文件的改动**没法评审**，
//     pre-commit 的 Ponytail 评审也读不到它。
//
// 两个工具的阈值还不一样，更难察觉：git 只看**前 8000 字节**里有没有 NUL，grep 看整个文件。
// 所以同一个 NUL，可能 git diff 正常、grep 却瞎——单看其中一个工具会误判「这文件没事」。
//
// 规矩：跟踪在册的非二进制资产文件，一个裸 NUL 都不许有。要 U+0000 就写转义
// （`\0` 或 `\u0000`，仓内既有写法见 src/ui/onboarding/modelSettingsCatalogProjection.ts），
// 运行期完全等价，但文件保持纯文本。
//
// 为什么只收 NUL、不顺手把所有 C0 控制字符都禁掉：只有 NUL 会触发上面那两个「静默失明」。
// 别的裸控制字符（如 electron/assets/mediaTypes.test.ts:129 的 PNG magic `\x89PNG\r\n<0x1a>\n`）
// 是正当的二进制签名夹具，不造成工具失明——把它们一起禁掉就得当天先开豁免名单，
// 而一条上线就带豁免的规则，远不如一条精确的硬零规则站得住。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 真二进制资产：它们本来就该含 NUL，不在本门岗管辖范围。
const BINARY_ASSET_EXT = /\.(png|jpe?g|gif|ico|icns|webp|avif|woff2?|ttf|otf|eot|mp4|mov|webm|mp3|wav|m4a|flac|zip|gz|tgz|bz2|7z|pdf|node|dylib|so|dll|exe|asar|bin|wasm|glb|gltf|hdr|exr|psd|sketch|db|sqlite3?|keystore|jks)$/i

// --cached 已跟踪 + --others 未跟踪，--exclude-standard 去掉 gitignore 的（node_modules/dist/截图…）。
// **必须带 --others**：只扫已跟踪文件的话，一个刚写出来、还没 git add 的新文件带着裸 NUL 会
// 大摇大摆走过门岗——写这条门岗时我自己就踩了：脚本自身当时含裸 NUL，它却报「全仓通过」，
// 因为它没把自己算进去。门岗漏掉「新文件」这一类，等于对最常见的引入路径失明。
function filesToScan() {
  // -z：文件名用 NUL 分隔，这样带空格/换行的路径也不会被切错。
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
}

const offenders = []
let scanned = 0
for (const relative of filesToScan()) {
  if (BINARY_ASSET_EXT.test(relative)) continue
  let buffer
  try {
    buffer = fs.readFileSync(path.join(repoRoot, relative))
  } catch {
    continue // 软链接失效 / 稀疏检出：不是本门岗的事
  }
  scanned += 1
  if (!buffer.includes(0)) continue
  const lines = buffer.toString('utf8').split('\n')
  const hits = []
  lines.forEach((line, index) => {
    if (line.includes('\0')) hits.push({ line: index + 1, text: line.trim().replaceAll('\0', '␀') })
  })
  offenders.push({ file: relative, count: buffer.filter((byte) => byte === 0).length, hits })
}

if (offenders.length === 0) {
  console.log(`✅ 裸 NUL 字节门岗通过：扫了 ${scanned} 个跟踪文件，无一含裸 NUL`)
  process.exit(0)
}

console.error(`裸 NUL 字节门岗未通过——这些文件对 grep 和 git 是「二进制」，搜不到也评审不了：`)
for (const offender of offenders) {
  console.error(`- ${offender.file}（${offender.count} 个裸 NUL）`)
  for (const hit of offender.hits.slice(0, 5)) {
    console.error(`    第 ${hit.line} 行（␀ = 那个裸 NUL）：${hit.text.slice(0, 120)}`)
  }
}
console.error(`  → 把裸 NUL 换成转义：模板/字符串里写 \\0 或 \\u0000，正则字符类里写 \\u0000。`)
console.error(`     运行期完全等价（字符串里仍是 U+0000），但文件重新变回纯文本、能搜也能评审。`)
process.exit(1)
