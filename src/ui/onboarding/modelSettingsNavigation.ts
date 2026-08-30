export type ModelSettingsPage =
  | { type: 'home' }
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
