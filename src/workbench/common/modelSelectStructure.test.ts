// 结构不变量：**有状态**的模型选择器必须渲染第二段（供应商）——否则用户选不了「走哪家」。
//
// 起因（2026-08-18 用户报「框选没办法选择不同供应商的模型 导致一直生成失败」）：
// CanvasSelectionToolbar 调 useDedupedModelSelect 时把当前值写死成 ''，于是 hook 内的 selectedModel
// 恒为 null → providerOptions 恒为 []，供应商那一段**结构上不可能出现**。UI 看着好好的、类型全对、
// 七道门岗全绿，但供应商被 pickHealthiestProvider 替用户定死一家；那家在他账号上不通 = 每次都失败。
//
// 这是「语法对、语义错」的一类：光看单文件看不出来，只有把「谁用了这个 hook」摆一起才看得见。
// 故用源码结构断言钉住它——第 5 个调用点再犯同样的错，这条会红。
//
// 两条出路，各自合法：
//   A. 有状态选择器（节点参数条/镜卡）→ 用 useDedupedModelSelect，且必须渲染 onProviderPick 那一段。
//   B. 一次性批量命令（无常驻值）→ 根本不该用这个 hook，改用 BulkModelPicker（选项自带厂商，一家一行）。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = path.join(process.cwd(), 'src')
const HOOK_NAME = 'useDedupedModelSelect'
const HOOK_FILE = path.join(SRC_ROOT, 'workbench/common/useDedupedModelSelect.ts')

/**
 * 剥掉注释再断言——本文件所有断言都扫**代码**而非原文。否则记录该 bug 的注释里正好会提到
 * `BulkModelPicker` / `useDedupedModelSelect`（如共享组件顶上的说明），会让 toContain 命中注释、
 * not.toContain 被注释误伤：语义反噬文档。也满足 check:walkthroughs 的「扫源码结构测试必须剥注释」门岗。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function readCode(relative: string): string {
  return stripComments(fs.readFileSync(path.join(process.cwd(), relative), 'utf8'))
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
    out.push(full)
  }
  return out
}

/** 真正 import 了这个 hook 的源文件（排除 hook 自身与测试）。 */
function filesImportingHook(): string[] {
  return listSourceFiles(SRC_ROOT).filter((file) => {
    if (path.resolve(file) === path.resolve(HOOK_FILE)) return false
    const source = stripComments(fs.readFileSync(file, 'utf8'))
    return new RegExp(`import\\s*\\{[^}]*\\b${HOOK_NAME}\\b[^}]*\\}\\s*from`).test(source)
  })
}

describe('model select structure — 选了模型就必须选得了供应商', () => {
  it('每个用 useDedupedModelSelect 的文件都渲染了供应商那一段（onProviderPick）', () => {
    const offenders = filesImportingHook().filter(
      (file) => !stripComments(fs.readFileSync(file, 'utf8')).includes('onProviderPick'),
    )

    expect(
      offenders.map((file) => path.relative(process.cwd(), file)),
      [
        '不变量：useDedupedModelSelect 是**两段式**选择器——第二段（供应商）不渲染，',
        '用户就锁不了「走哪家」，供应商只能由 pickHealthiestProvider 定死一家；',
        '那家在用户账号上不通就每次生成都失败、且界面上无路可换',
        '（2026-08-18 用户实报：「框选没办法选择不同供应商的模型 导致一直生成失败」）。',
        '',
        '上面这些文件 import 了该 hook 却没有引用 onProviderPick。两条出路：',
        '  A. 它是有状态选择器（节点/镜卡，有常驻当前值）→ 补上供应商那一段 NomiSelect；',
        '  B. 它是一次性批量命令（无常驻值，如「统一模型」）→ 别用这个 hook，',
        '     改用 src/workbench/common/BulkModelPicker.tsx（选项按供应商摊平，一家一行）。',
      ].join('\n'),
    ).toEqual([])
  })

  // 2026-09-06：这一轮返工的**类**根因是「共享边界长出第二个答案」，一次改动里犯了三回：
  // 第二条供应商排序规则、同一行上两种「走哪家」的说法、以及把 catalog 的全局硬过滤放宽成
  // 「每个选择器自己决定看不看得见没接入的家」。前两条各自删到只剩一份，这条把第三条钉死：
  // 用户 2026-09-06 拍板「没接入的家不显示」之后，那道闸只剩 catalog 一处，**没有放宽口**。
  it('「这家能不能跑」只有 catalog 一道闸，谁也不许自带取景开关', () => {
    const cache = readCode('src/config/modelCatalogCache.ts')
    expect(cache, '闸必须住在 catalog 派生层').toContain('export function keepRunnableVendorOptions')
    expect(cache, '放宽口是被删掉的旧实现，不许复活（P1）').not.toContain('includeUnconfigured')

    // 谁都不该再有第二个「取景」参数：有了它，「谁能看见没接入的家」就又变成一件可商量的事。
    const survivors = listSourceFiles(SRC_ROOT)
      .map((file) => path.relative(process.cwd(), file))
      .filter((relative) => /MODEL_PICKER_CATALOG_SCOPE|CatalogOptionScope|includeUnconfigured/.test(readCode(relative)))
      .sort()
    expect(
      survivors,
      [
        '有文件还带着 catalog 取景开关。2026-09-06 用户拍板：没接入的供应商，它的模型不显示——',
        '既然任何界面都不再需要「连没配 key 的家也给我」那一份，这个开关就没有第二种取景可选，',
        '留着只会让下一个人以为「看不看得见」是调用点的自由（P1 无并行版、无逃生口）。',
      ].join('\n'),
    ).toEqual([])
  })

  // 同一个问题只能有一个答案：「先走哪家」的排序规则全仓只许有 sortModelProviders 一份。
  // 第一版留下了 resolveBestProvider（零生产调用方却还在），两份规则里活着的那份还悄悄
  // 丢了供应商分级——默认家于是从官方漂到字母序第一家，没有人做过这个决定。
  it('「先走哪家」只有一条排序规则', () => {
    const identity = readCode('src/config/modelIdentity.ts')
    expect(identity, '排序规则必须住在 sortModelProviders').toContain('export function sortModelProviders')
    expect(identity, '分级这一级不许省：省了就退化成厂商名字母序').toContain('vendorTier(a.provider.vendor) - vendorTier(b.provider.vendor)')
    const survivors = listSourceFiles(SRC_ROOT)
      .map((file) => path.relative(process.cwd(), file))
      .filter((relative) => readCode(relative).includes('resolveBestProvider'))
      .sort()
    expect(survivors, 'resolveBestProvider 是被 sortModelProviders 取代的旧规则，不许复活（P1）').toEqual([])
  })

  it('批量选模型只有一份实现：所有批量调用点都走同一份 BulkModelPicker，不各写各的', () => {
    // 画布两个批量入口（框选工具条 + 底部「生成全部」坞）实现共同住进 CanvasBulkModelSelect —
    // 那份薄封装内部用 BulkModelPicker（PR #157：抽共享组件防两入口漂移）。分镜批量条直接用 BulkModelPicker。
    const sharedCanvasPicker = 'src/workbench/generationCanvas/components/CanvasBulkModelSelect.tsx'
    const bulkPickerImplementations = [sharedCanvasPicker, 'src/workbench/creation/storyboard/StoryboardBulkBar.tsx']
    for (const relative of bulkPickerImplementations) {
      const source = readCode(relative)
      expect(source, `${relative} 应使用共享的 BulkModelPicker`).toContain('BulkModelPicker')
      // P1 无并行版：批量调用点不许再自己调那个两段式 hook（调了就又会退化成「选不了家」）。
      expect(source, `${relative} 不该再直接用 ${HOOK_NAME}`).not.toContain(HOOK_NAME)
    }

    // 画布两个入口都必须复用共享组件、不许各自内联再实现一遍（否则又会漂移）。
    const canvasBulkEntryPoints = [
      'src/workbench/generationCanvas/components/CanvasSelectionToolbar.tsx',
      'src/workbench/generationCanvas/components/CanvasBatchGenerateDock.tsx',
    ]
    for (const relative of canvasBulkEntryPoints) {
      const source = readCode(relative)
      expect(source, `${relative} 应复用共享的 CanvasBulkModelSelect`).toContain('CanvasBulkModelSelect')
      expect(source, `${relative} 必须把完整同级组交给共享选择器，才能区分同类不同执行模式`).toContain(
        'peerGroups=',
      )
      expect(source, `${relative} 不该再直接用 ${HOOK_NAME}`).not.toContain(HOOK_NAME)
      expect(source, `${relative} 不该再自己内联 BulkModelPicker（要走共享组件）`).not.toContain(
        "from '../../common/BulkModelPicker'",
      )
    }
  })

  it('BulkModelPicker 选中后把 vendor 一起交出去（只写 modelKey 就等于没修）', () => {
    const picker = readCode('src/workbench/common/BulkModelPicker.tsx')
    expect(picker).toContain('resolveProviderByAddress')
    expect(picker).toContain('onPick(provider.option.value, provider.vendor)')

    // 画布共享封装把 (value, vendor) 一起回抛给 onApplyModel（vendor 丢了 = 又锁不了家）。
    const sharedCanvasPicker = readCode('src/workbench/generationCanvas/components/CanvasBulkModelSelect.tsx')
    expect(sharedCanvasPicker).toContain(
      'onApplyModel({ executionKind: group.executionKind, requiredMode: group.requiredMode, value, vendor',
    )
  })
})
