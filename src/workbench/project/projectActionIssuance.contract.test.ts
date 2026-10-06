/**
 * Class regression for "an action re-reads the current project after it started".
 *
 * Structure (key = trusted window + project): project IO authority is issued only by
 * projectCanvasReadSurface.ts (`withProjectAction` for renderer-started actions,
 * `withMainProjectAction` for actions main started on its own trusted input). Downstream helpers
 * only accept the issued ProjectExecutionContext. The compiler already rejects a module-private
 * issuer import and a forgotten required context (see the @ts-expect-error block below, checked by
 * check:test-types). What the compiler cannot see is *when* an entry issues: calling the issuer
 * after an await is the late-binding bug again. This scan pins the remaining shapes.
 */
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { ProjectCanvasReadSurfaceCoordinator, ProjectExecutionContext } from './projectCanvasReadSurface'

const repoRoot = path.resolve(__dirname, '../../..')
const OWNER = 'src/workbench/project/projectCanvasReadSurface.ts'
const ISSUERS = new Set(['withProjectAction', 'withMainProjectAction', 'subscribeProjectOpened', 'whenProjectAdopted'])
const PRIVATE_ISSUER_NAMES = ['captureCurrentProjectExecutionContext', 'projectContextIssuers', 'captureProjectExecutionContext']

function productionSources(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue
      out.push(full)
    }
  }
  walk(root)
  return out
}

export type IssuanceViolation = { file: string; line: number; rule: string; text: string }

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)
}

/**
 * The context itself (optionally unioned), not a callback that merely receives one. `| null` is an
 * explicit "no project open at the action start" decided by the issuer; `?`, `| undefined` and
 * initializers are the silent-default shapes this rule forbids.
 */
function contextType(type: ts.TypeNode | undefined): { nullable: boolean } | null {
  if (!type) return null
  const isContext = (node: ts.TypeNode): boolean =>
    ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'ProjectExecutionContext'
  if (isContext(type)) return { nullable: false }
  if (!ts.isUnionTypeNode(type) || !type.types.some(isContext)) return null
  return { nullable: type.types.some((member) => member.kind === ts.SyntaxKind.UndefinedKeyword) }
}

/** Pure scan so the rule itself can be proven red on a planted violation. */
export function scanProjectActionIssuance(file: string, text: string): IssuanceViolation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const violations: IssuanceViolation[] = []
  const report = (node: ts.Node, rule: string): void => {
    violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule, text: node.getText(source).slice(0, 120) })
  }
  const isOwner = file === OWNER
  const visit = (node: ts.Node): void => {
    if (!isOwner && ts.isIdentifier(node) && PRIVATE_ISSUER_NAMES.includes(node.text)) report(node, 'private-issuer-reference')
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ISSUERS.has(node.expression.text) && !isOwner) {
      // Late issuance: an await earlier in the same function body means the action already yielded
      // before it fixed its project, so it would adopt whatever project is current by then.
      let fn: ts.Node | undefined = node.parent
      while (fn && !isFunctionLike(fn)) fn = fn.parent
      if (fn) {
        let awaitedBefore = false
        const findAwait = (inner: ts.Node): void => {
          if (awaitedBefore || inner.getStart(source) >= node.getStart(source)) return
          if (inner !== fn && isFunctionLike(inner)) return
          if (ts.isAwaitExpression(inner) || (ts.isForOfStatement(inner) && inner.awaitModifier)) {
            if (inner.getEnd() <= node.getStart(source)) { awaitedBefore = true; return }
          }
          ts.forEachChild(inner, findAwait)
        }
        ts.forEachChild(fn, findAwait)
        if (awaitedBefore) report(node, 'issued-after-await')
      }
    }
    if (!isOwner && (ts.isParameter(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node))) {
      const context = contextType(node.type)
      const optional = context && (context.nullable || Boolean(node.questionToken) || ('initializer' in node && Boolean(node.initializer)))
      if (optional) report(node, 'optional-project-context')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}

/**
 * Ratchet for "business code reads the project this window has open right now".
 * The old global readers are deleted outright; re-adding one (definition or reference) anywhere in
 * src/ or electron/ is a violation. The two live readers are display/transport-only and every
 * remaining reference is pinned below with its reason. Counts may only go down: a lower count must
 * lower the entry, and a new reference fails until someone argues it into this list.
 */
const DELETED_CURRENT_PROJECT_READERS = new Set([
  'getActiveWorkbenchProjectId', 'getDesktopActiveProjectId', 'setDesktopActiveProjectId',
  'subscribeDesktopActiveProjectIdChange', 'getCanvasEventsProjectId',
  'activeTaskProjectFallback', 'rememberActiveProjectForTasks', 'withProjectIdSecondChance',
])
const LIVE_CURRENT_PROJECT_READERS = new Map<string, string>([
  ['useOpenProjectId', 'src/workbench/project/useOpenProjectId.ts'],
  ['captureCurrentProjectCanvasReadSurfaceBinding', OWNER],
])
export const CURRENT_PROJECT_READER_ALLOWLIST: Record<string, { reads: number; reason: string }> = {
  'src/workbench/project/projectCanvasReadSurface.ts': { reads: 1, reason: 'owner: withMainProjectAction compares the binding main issued with this window\'s current epoch' },
  'src/workbench/capability/capabilityApplyHandler.ts': { reads: 1, reason: 'host request start: capture the surface transport binding before the first await to seal the planner snapshot main verifies' },
  'src/workbench/generationCanvas/agent/applyCanvasToolCall.ts': { reads: 1, reason: 'agent tool call start: capture the artifact binding before any await; IO never retargets later' },
  'src/workbench/generationCanvas/nodes/ClipNode.tsx': { reads: 1, reason: 'display: which project library the clip asset picker lists (pick/upload issue their own context)' },
  'src/workbench/generationCanvas/nodes/NodeParameterControls.tsx': { reads: 1, reason: 'display: asset reference picker listing' },
  'src/workbench/creation/storyboard/shotRow/ShotReferenceStrip.tsx': { reads: 1, reason: 'display: asset reference picker listing (upload issues its own context)' },
  'src/workbench/creation/storyboard/shotRow/useShotMentionSource.ts': { reads: 1, reason: 'display: @-mention asset suggestions when the host passes no project' },
  'src/workbench/timeline/TimelineSecondaryAddRow.tsx': { reads: 1, reason: 'display: music picker listing (adding issues its own context)' },
  'src/workbench/preview/PreviewSourcePanel.tsx': { reads: 1, reason: 'display: preview source asset listing' },
  'src/workbench/production/useActiveProductionRun.ts': { reads: 1, reason: 'display: task center polls the open project\'s production run' },
  'src/media/useFilmstrip.ts': { reads: 1, reason: 'display: filmstrip cache key when the URL carries no project' },
  'src/workbench/ai/resident/useShotVerifyFeedback.tsx': { reads: 1, reason: 'display: show only the open project\'s verify card (fix issues its own context)' },
  'src/workbench/generationCanvas/components/MemoryFold.tsx': { reads: 1, reason: 'display: list the open project\'s memory facts (edits issue their own context)' },
  'src/ui/browser/dialog/NomiBrowserDialogView.tsx': { reads: 1, reason: 'display: main-window asset box labels its project (writes are issued by main from the window session)' },
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent
  return (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) && parent.name === node
}

/** Pure scan (proven red on planted readers): deleted readers anywhere, live readers counted outside their owner. */
export function scanCurrentProjectReaders(file: string, text: string): { deleted: string[]; reads: number } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const deleted: string[] = []
  let reads = 0
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (DELETED_CURRENT_PROJECT_READERS.has(node.text)) deleted.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${node.text}`)
      const liveOwner = LIVE_CURRENT_PROJECT_READERS.get(node.text)
      const inImport = ts.isImportSpecifier(node.parent) || ts.isImportClause(node.parent)
      if (liveOwner && !inImport && !(file === liveOwner && isDeclarationName(node))) reads += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { deleted, reads }
}

describe('project action issuance', () => {
  it('has no private issuer reference, late issuance, or optional context anywhere in production sources', () => {
    const violations = productionSources(path.join(repoRoot, 'src')).flatMap((absolute) => {
      const file = path.relative(repoRoot, absolute).replace(/\\/g, '/')
      return scanProjectActionIssuance(file, fs.readFileSync(absolute, 'utf8'))
    })
    expect(violations).toEqual([])
  })

  it('rejects each planted violation shape', () => {
    const planted = `
      import { withProjectAction, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
      export async function late(file: File) { await file.arrayBuffer(); return withProjectAction((project) => project) }
      export async function persist(file: File, context?: ProjectExecutionContext) { return file }
      export async function fallback(file: File, context: ProjectExecutionContext | undefined) { return file }
      export type Options = { projectContext?: ProjectExecutionContext }
      export const selfCapture = () => captureCurrentProjectExecutionContext()
      export async function fine(file: File) { return withProjectAction(async (project) => { await file.arrayBuffer(); return project }) }
    `
    expect(scanProjectActionIssuance('src/planted.ts', planted).map((violation) => violation.rule)).toEqual([
      'issued-after-await', 'optional-project-context', 'optional-project-context', 'optional-project-context', 'private-issuer-reference',
    ])
  })
  it('keeps the current-project reader ratchet: deleted readers stay deleted, live reads only as pinned', () => {
    const deleted: string[] = []
    const reads: Record<string, number> = {}
    for (const root of ['src', 'electron']) {
      for (const absolute of productionSources(path.join(repoRoot, root))) {
        const file = path.relative(repoRoot, absolute).replace(/\\/g, '/')
        const found = scanCurrentProjectReaders(file, fs.readFileSync(absolute, 'utf8'))
        deleted.push(...found.deleted)
        if (found.reads > 0) reads[file] = found.reads
      }
    }
    expect(deleted).toEqual([])
    expect(reads).toEqual(Object.fromEntries(Object.entries(CURRENT_PROJECT_READER_ALLOWLIST).map(([file, entry]) => [file, entry.reads])))
  })

  it('flags each planted current-project reader shape', () => {
    const planted = `
      import { getDesktopActiveProjectId } from '../../desktop/activeProject'
      import { useOpenProjectId } from '../project/useOpenProjectId'
      export const upload = () => getDesktopActiveProjectId()
      export const deps = { activeProject: activeTaskProjectFallback }
      export function useLabel() { return useOpenProjectId() }
    `
    const found = scanCurrentProjectReaders('src/planted.tsx', planted)
    expect(found.deleted.map((entry) => entry.split(' ')[1])).toEqual(['getDesktopActiveProjectId', 'getDesktopActiveProjectId', 'activeTaskProjectFallback'])
    expect(found.reads).toBe(1)
  })
})

// Compile-time half (check:test-types). Each line must stay an error; if a default, optional
// context or exported self-capture comes back, the directive becomes unused and the gate turns red.
type Surface = typeof import('./projectCanvasReadSurface')
type PersistNodeImage = typeof import('../generationCanvas/adapters/persistNodeImage')
type AssetImport = typeof import('../generationCanvas/adapters/assetImportAdapter')
type ClipboardPaste = typeof import('../generationCanvas/adapters/clipboardImagePaste')
type ClipUpload = typeof import('../generationCanvas/nodes/clipNodeUpload')
type Rasterize = typeof import('../generationCanvas/nodes/artifact/rasterizeArtifactToReferenceAsset')
type ShotCuts = typeof import('../generationCanvas/nodes/extractShotCutsToNodes')
type TaskApi = typeof import('../api/taskApi')
type CatalogTask = typeof import('../generationCanvas/runner/catalogTaskActions')
type RecoverTask = typeof import('../generationCanvas/runner/recoverTaskActions')
type ShotVerify = typeof import('../generationCanvas/agent/shotVerifyStore')
type RunController = typeof import('../generationCanvas/runner/generationRunController')
type UploadApi = typeof import('../api/assetUploadApi')
// @ts-expect-error the renderer-wide "active project id" module is deleted, not merely unused.
export type DeletedActiveProject = typeof import('../../desktop/activeProject')
// @ts-expect-error the workbench session no longer exports a current-project reader.
export type DeletedSessionReader = typeof import('./workbenchProjectSession')['getActiveWorkbenchProjectId']
// @ts-expect-error the issuer is module-private: business code cannot read "the current project".
export type SelfCapture = Surface['captureCurrentProjectExecutionContext']
// @ts-expect-error the coordinator no longer exposes a capture method either.
export type CoordinatorCapture = ProjectCanvasReadSurfaceCoordinator['captureProjectExecutionContext']
export function forgottenContextsDoNotCompile(
  persist: PersistNodeImage, assetImport: AssetImport, clipboard: ClipboardPaste, clip: ClipUpload,
  rasterize: Rasterize, shotCuts: ShotCuts, file: File, project: ProjectExecutionContext,
): void {
  // @ts-expect-error required context
  void persist.persistNodeImageFile(file, 'node')
  // @ts-expect-error required context
  void persist.persistNodeImageBlob(file, 'node', 'name.png')
  // @ts-expect-error required projectContext
  void assetImport.importLocalMediaFilesToGenerationCanvas([file], { basePosition: { x: 0, y: 0 } })
  // @ts-expect-error required projectContext
  void clipboard.pasteClipboardMediaToGenerationCanvas({ basePosition: { x: 0, y: 0 } })
  // @ts-expect-error required context (the project id derives from it)
  void clip.importClipNodeAsset(file, 'project-id')
  // @ts-expect-error required project
  void rasterize.rasterizeArtifactToReferenceAsset({ fileType: 'svg', url: 'nomi-local://a.svg' })
  // @ts-expect-error required project
  void shotCuts.extractShotCutsToNodes({ reportFeedback: () => undefined, node: {} as never, seconds: [1] })
  void persist.persistNodeImageFile(file, 'node', project)
}

/** Background runs and task polling: the project identity is fixed at submission and must be passed. */
export function backgroundIdentityIsRequired(
  taskApi: TaskApi, catalog: CatalogTask, recover: RecoverTask, verify: ShotVerify, runs: RunController, upload: UploadApi,
  node: import('../generationCanvas/model/generationCanvasTypes').GenerationCanvasNode, file: File, project: ProjectExecutionContext,
): void {
  const request = { kind: 'text_to_image' as const, prompt: 'p' }
  // @ts-expect-error submission must name its project (null = explicitly none); taskApi never fills it in
  void taskApi.runWorkbenchTaskByVendor('vendor', request)
  // @ts-expect-error streaming must name its project
  void taskApi.runWorkbenchTextTaskStream('vendor', request, { onDelta: () => undefined })
  // @ts-expect-error polling repeats the task's own project identity
  void taskApi.fetchWorkbenchTaskResultByVendor({ taskId: 't', vendor: 'vendor' })
  // @ts-expect-error a catalog run needs its project target
  void catalog.runCatalogGenerationTask(node, {})
  // @ts-expect-error recovery is issued at the click
  void recover.recoverNodeResult('node')
  // @ts-expect-error verify belongs to an issued project
  void verify.verifyShotsAndReport(['shot'])
  // @ts-expect-error a batch run needs its project target
  void runs.runGenerationNodesBatch(['node'], { assetUploadConsent: 'not-needed' })
  // @ts-expect-error uploads take the issued binding, not a projectId
  void upload.importWorkbenchLocalAssetFile(file, 'name', { projectId: 'p' })
  void recover.recoverNodeResult('node', project)
}
