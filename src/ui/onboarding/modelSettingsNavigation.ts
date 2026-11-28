export type ModelSettingsPage =
  | { type: 'home' }
  | { type: 'otherWays'; section?: 'network' | 'data' }
  | { type: 'usage'; vendorKey: string }
  | { type: 'platformConnect'; vendorKey: string }
  | {
      type: 'connection'
      vendorKey: string
      focus?: ModelSettingsConnectionFocus
    }
  | { type: 'model'; vendorKey: string; modelKey: string }
  | { type: 'capability'; vendorKey: string; modelKey: string }
  | { type: 'add'; preset?: string; existingVendorKey?: string; initialScreen?: 'form' | 'scriptDraft'; integrationSessionId?: string }
  | { type: 'verification'; runId: string }
  | { type: 'script'; vendorKey: string; modelKey: string }

export type ModelSettingsConnectionFocus = {
  target: 'baseUrl' | 'apiKey'
  requestId: number
}

export type ModelSettingsNavigation = {
  stack: ModelSettingsPage[]
}

export type ModelSettingsDialogEscapeAction = 'none' | 'back' | 'close'

function samePage(left: ModelSettingsPage, right: ModelSettingsPage): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function createModelSettingsNavigation(initialPage?: Exclude<ModelSettingsPage, { type: 'home' }>): ModelSettingsNavigation {
  return { stack: initialPage ? [{ type: 'home' }, initialPage] : [{ type: 'home' }] }
}

export function currentModelSettingsPage(navigation: ModelSettingsNavigation): ModelSettingsPage {
  return navigation.stack.at(-1) ?? { type: 'home' }
}

export function openModelSettingsPage(
  navigation: ModelSettingsNavigation,
  page: Exclude<ModelSettingsPage, { type: 'home' }>,
): ModelSettingsNavigation {
  if (samePage(currentModelSettingsPage(navigation), page)) return navigation
  return { stack: [...navigation.stack, page] }
}

export function replaceModelSettingsPage(
  navigation: ModelSettingsNavigation,
  page: Exclude<ModelSettingsPage, { type: 'home' }>,
): ModelSettingsNavigation {
  const stack = navigation.stack.length > 1 ? navigation.stack.slice(0, -1) : [{ type: 'home' } as const]
  return { stack: [...stack, page] }
}

/**
 * Return to the owning connection and discard any model-detail layers above it.
 * Recovery actions use a request id so the same field can be focused again later.
 */
export function openModelSettingsConnectionPage(
  navigation: ModelSettingsNavigation,
  vendorKey: string,
  focus?: ModelSettingsConnectionFocus,
): ModelSettingsNavigation {
  let connectionIndex = -1
  for (let index = navigation.stack.length - 1; index >= 0; index -= 1) {
    const candidate = navigation.stack[index]
    if (candidate.type === 'connection' && candidate.vendorKey === vendorKey) {
      connectionIndex = index
      break
    }
  }
  const connection: Extract<ModelSettingsPage, { type: 'connection' }> = {
    type: 'connection',
    vendorKey,
    ...(focus ? { focus } : {}),
  }
  if (connectionIndex >= 0) {
    return { stack: [...navigation.stack.slice(0, connectionIndex), connection] }
  }
  return { stack: [{ type: 'home' }, connection] }
}

export function backModelSettingsPage(navigation: ModelSettingsNavigation): ModelSettingsNavigation {
  if (navigation.stack.length <= 1) return { stack: [{ type: 'home' }] }
  return { stack: navigation.stack.slice(0, -1) }
}

export function modelSettingsDialogOwner(
  navigation: ModelSettingsNavigation,
): Extract<ModelSettingsPage, { type: 'model' }> | null {
  const current = currentModelSettingsPage(navigation)
  if (current.type !== 'model' && current.type !== 'capability' && current.type !== 'script' && current.type !== 'verification') {
    return null
  }
  for (let index = navigation.stack.length - 1; index >= 0; index -= 1) {
    const candidate = navigation.stack[index]
    if (candidate.type === 'model') return candidate
    if (candidate.type === 'connection' || candidate.type === 'home') return null
  }
  return null
}

export function modelSettingsDialogEscapeAction(
  navigation: ModelSettingsNavigation,
): ModelSettingsDialogEscapeAction {
  const owner = modelSettingsDialogOwner(navigation)
  if (!owner) return 'none'
  return currentModelSettingsPage(navigation).type === 'model' ? 'close' : 'back'
}

export function closeModelSettingsDialog(navigation: ModelSettingsNavigation): ModelSettingsNavigation {
  let ownerIndex = -1
  for (let index = navigation.stack.length - 1; index >= 0; index -= 1) {
    if (navigation.stack[index].type === 'model') {
      ownerIndex = index
      break
    }
  }
  if (ownerIndex < 0) return navigation
  const stack = navigation.stack.slice(0, ownerIndex)
  return { stack: stack.length > 0 ? stack : [{ type: 'home' }] }
}

export function openModelSettingsDialog(
  navigation: ModelSettingsNavigation,
  identity: { vendorKey: string; modelKey: string },
): ModelSettingsNavigation {
  const owner = modelSettingsDialogOwner(navigation)
  if (owner?.vendorKey === identity.vendorKey && owner.modelKey === identity.modelKey) {
    const ownerIndex = navigation.stack.lastIndexOf(owner)
    return { stack: navigation.stack.slice(0, ownerIndex + 1) }
  }

  let connectionIndex = -1
  for (let index = navigation.stack.length - 1; index >= 0; index -= 1) {
    const candidate = navigation.stack[index]
    if (candidate.type === 'connection' && candidate.vendorKey === identity.vendorKey) {
      connectionIndex = index
      break
    }
  }
  const base = connectionIndex >= 0
    ? navigation.stack.slice(0, connectionIndex + 1)
    : [{ type: 'home' } as const, { type: 'connection', vendorKey: identity.vendorKey } as const]
  return {
    stack: [...base, { type: 'model', vendorKey: identity.vendorKey, modelKey: identity.modelKey }],
  }
}

export function openModelSettingsDialogPage(
  navigation: ModelSettingsNavigation,
  identity: { vendorKey: string; modelKey: string },
  page: Extract<ModelSettingsPage, { type: 'capability' | 'script' | 'verification' }>,
): ModelSettingsNavigation {
  const owner = modelSettingsDialogOwner(navigation)
  if (owner?.vendorKey === identity.vendorKey && owner.modelKey === identity.modelKey) {
    return openModelSettingsPage(navigation, page)
  }

  let connectionIndex = -1
  for (let index = navigation.stack.length - 1; index >= 0; index -= 1) {
    const candidate = navigation.stack[index]
    if (candidate.type === 'connection' && candidate.vendorKey === identity.vendorKey) {
      connectionIndex = index
      break
    }
  }
  const base = connectionIndex >= 0
    ? navigation.stack.slice(0, connectionIndex + 1)
    : [{ type: 'home' } as const, { type: 'connection', vendorKey: identity.vendorKey } as const]
  return {
    stack: [
      ...base,
      { type: 'model', vendorKey: identity.vendorKey, modelKey: identity.modelKey },
      page,
    ],
  }
}

/**
 * 格式任务页上点「完成」去哪：任务成功（completed / partial）后，模型已经落在这次任务的那条连接上
 * （自接的中转是一条新连接，晋级时旧来源下线）——「完成」带人去**那条连接**，只选了一个模型就直接
 * 打开它，而不是退回发起页、对着已经不存在的旧来源（2026-11-17 第一轮验收发现）。
 * 没晋级（失败 / 取消 / 还在跑）或那条连接还没进目录，就照常退一层。
 */
export function finishAdapterRunNavigation(
  navigation: ModelSettingsNavigation,
  run: { vendorKey: string; stage: string; selectedModelKeys: readonly string[] } | undefined,
  connectionExists: (vendorKey: string) => boolean,
): ModelSettingsNavigation {
  if (!run) return backModelSettingsPage(navigation)
  const promoted = (run.stage === 'completed' || run.stage === 'partial') && connectionExists(run.vendorKey)
  if (!promoted) return backModelSettingsPage(navigation)
  // 从这个模型自己的详情打开的任务：退一层就回到它，已经是那条连接上的身份。
  if (modelSettingsDialogOwner(navigation)?.vendorKey === run.vendorKey) return backModelSettingsPage(navigation)
  const connection = openModelSettingsConnectionPage(navigation, run.vendorKey)
  return run.selectedModelKeys.length === 1
    ? openModelSettingsDialog(connection, { vendorKey: run.vendorKey, modelKey: run.selectedModelKeys[0] })
    : connection
}
