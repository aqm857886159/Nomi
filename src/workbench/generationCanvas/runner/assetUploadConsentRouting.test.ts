// F16b 收口不变量：公共托管同意**只能**在花钱确认卡这一处问，不许再有第二张卡。
//
// 为什么要结构测试而不是只测行为：老实现的漏法是「按条件绕过」——
// `if (options.assetUploadConsent !== 'allow' && !(await requestAssetUploadConsent(node)))`。
// 这行在传了 consent 的 3 个调用点上看起来完全正常，只在**没传**的调用点上偷偷弹第二张卡。
// 换句话说：坏行为不在被改的那几行里，而在「谁忘了传参数」里。所以判据必须是
// 「整棵源码树里还有没有能弹第二张卡的东西」，而不是「某一次调用的返回值对不对」。
//
// 三条不变量分别堵住这类 bug 的三个复活入口：
//   ① 老的弹卡函数被彻底删掉（不能再 import、不能再被条件保护着留一份）；
//   ② 老卡的 i18n 文案键跟着删（留着 = 下一个人以为它还现役，会把它接回去）；
//   ③ 每个 runGenerationNode 调用点都显式给出 consent 决定（编译期强制，不靠自觉）。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 把源码剥成「只剩代码」再扫。与 tests/ux/_assert.mjs 的同名工具同一套正则——
 * 那份是 .mjs、没有类型声明，从 .ts 测试里 import 会撞 TS7016，故此处按同一规则就地实现。
 * 不剥注释会反噬文档：本文件顶上的注释里就写着 requestAssetUploadConsent，不剥的话自己打自己红。
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const runnerDir = path.resolve(__dirname)
const srcDir = path.resolve(__dirname, '../../..')

function readSource(relativeFromSrc: string): string {
  return fs.readFileSync(path.join(srcDir, relativeFromSrc), 'utf8')
}

/** 递归收集 src/ 下所有 ts/tsx（排除测试本身——测试里提到旧名字是在说明历史，不是在用它）。 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('F16b 托管同意单一收口', () => {
  it('旧的独立托管确认卡函数已从代码库删除（不是被条件绕过）', () => {
    const offenders: string[] = []
    for (const file of collectSourceFiles(srcDir)) {
      const code = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'))
      if (/requestAssetUploadConsent/.test(code)) offenders.push(path.relative(srcDir, file))
    }
    expect(
      offenders,
      'requestAssetUploadConsent 必须整个删掉：留着它（哪怕被 if 挡住）就是 P1 并行版，'
        + '任何一个忘记传 consent 的调用点都会让第二张卡复活。',
    ).toEqual([])
  })

  it('旧卡的 i18n 文案键已删除（zh + en）', () => {
    const locale = readSource('i18n/locales/generationCommon.ts')
    expect(
      locale.includes('assetUploadConsent:'),
      '旧卡的文案块 generationCommon.assetUploadConsent 应随卡一起删除——'
        + '留着文案 = 留着把卡接回来的现成零件。',
    ).toBe(false)
    // 合并后的披露文案是唯一现役的托管说明，必须还在（否则是删过头了）。
    expect(locale.includes('spendHostingDisclosure:')).toBe(true)
  })

  it('每个 runGenerationNode 调用点都显式带上 assetUploadConsent 决定', () => {
    const missing: Array<{ file: string; line: number; text: string }> = []
    for (const file of collectSourceFiles(srcDir)) {
      const raw = fs.readFileSync(file, 'utf8')
      if (!raw.includes('runGenerationNode(')) continue
      const lines = stripCommentsAndStrings(raw).split('\n')
      lines.forEach((line: string, index: number) => {
        // 只认「调用」：排除定义/re-export/类型引用（与 check-batch-machines 同口径）。
        if (!/(?:^|[^.\w])runGenerationNode\s*\(/.test(line)) return
        if (/export\s+(async\s+)?function\s+runGenerationNode/.test(line)) return
        // 调用点自身或紧随其后的选项对象里必须出现 assetUploadConsent。
        const window = lines.slice(index, index + 8).join('\n')
        if (!/assetUploadConsent/.test(window)) {
          missing.push({ file: path.relative(srcDir, file), line: index + 1, text: line.trim() })
        }
      })
    }
    expect(
      missing,
      '这些调用点没有给出托管同意决定。consent 必须由上游确认面解析后显式传入——'
        + '缺省 = 运行时再弹一张卡，正是 F16b 要根除的那张。',
    ).toEqual([])
  })

  it('runGenerationNode 自身不再持有任何弹卡能力（只消费上游决定）', () => {
    const controller = stripCommentsAndStrings(
      fs.readFileSync(path.join(runnerDir, 'generationRunController.ts'), 'utf8'),
    )
    expect(/confirmDialog/.test(controller), 'runner 不许直接弹对话框').toBe(false)
    expect(/requestAssetUploadConsent/.test(controller)).toBe(false)
  })
})
