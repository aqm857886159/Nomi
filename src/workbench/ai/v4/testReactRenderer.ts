import { createRequire } from 'node:module'
import React from 'react'

const require = createRequire(import.meta.url)
const Reconciler = require('react-reconciler')

export type TestHostNode = { props: unknown; hidden?: boolean }

export function createReactTestRenderer<T extends TestHostNode = TestHostNode>(options: {
  createInstance?: (type: string, props: Record<string, unknown>) => T
  commitUpdate?: (instance: T, props: Record<string, unknown>) => void
} = {}) {
  const renderer = Reconciler({
    now: Date.now,
    supportsMutation: true,
    // The in-memory test host is secondary; ReactDOM SSR owns the primary
    // context slot when a real lazy Markdown fixture is preloaded.
    isPrimaryRenderer: false,
    getRootHostContext: () => ({}),
    getChildHostContext: () => ({}),
    getPublicInstance: (instance: T) => instance,
    prepareForCommit: () => null,
    resetAfterCommit: () => undefined,
    shouldSetTextContent: () => false,
    createInstance: options.createInstance ?? ((type, props) => ({ type, props } as unknown as T)),
    createTextInstance: (text: string) => ({ type: '#text', props: { text } }),
    appendInitialChild: () => undefined,
    appendChild: () => undefined,
    appendChildToContainer: () => undefined,
    removeChild: () => undefined,
    removeChildFromContainer: () => undefined,
    clearContainer: () => undefined,
    detachDeletedInstance: () => undefined,
    finalizeInitialChildren: () => false,
    prepareUpdate: () => true,
    // react-reconciler 0.34: (instance, type, oldProps, newProps, internalHandle)
    commitUpdate: (instance: T, _type: string, _oldProps: Record<string, unknown>, props: Record<string, unknown>) => {
      if (options.commitUpdate) options.commitUpdate(instance, props)
      else instance.props = props
    },
    commitTextUpdate: () => undefined,
    hideInstance: (instance: T) => { instance.hidden = true },
    unhideInstance: (instance: T) => { instance.hidden = false },
    hideTextInstance: (instance: TestHostNode) => { instance.hidden = true },
    unhideTextInstance: (instance: TestHostNode) => { instance.hidden = false },
    // Same no-resource host contract as React's test renderer: in-memory nodes
    // have no external commit dependency, while React.lazy still suspends.
    maySuspendCommit: () => false,
    maySuspendCommitOnUpdate: () => false,
    maySuspendCommitInSyncRender: () => false,
    preloadInstance: () => true,
    startSuspendingCommit: () => null,
    suspendInstance: () => undefined,
    suspendOnActiveViewTransition: () => undefined,
    waitForCommitToBeReady: () => null,
    getSuspendedCommitReason: () => null,
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    noTimeout: -1,
    getCurrentEventPriority: () => 2,
    setCurrentUpdatePriority: () => undefined,
    getCurrentUpdatePriority: () => 2,
    resolveUpdatePriority: () => 2,
    resolveEventType: () => null,
    resolveEventTimeStamp: () => -1,
    trackSchedulerEvent: () => undefined,
    shouldAttemptEagerTransition: () => false,
    supportsMicrotasks: false,
  })
  const root = renderer.createContainer({}, 0, null, false, null, '', () => undefined, null)
  return {
    render(node: React.ReactElement | null) {
      renderer.flushSyncFromReconciler(() => renderer.updateContainerSync(node, root, null, () => undefined))
      renderer.flushSyncWork()
    },
    flushPassiveEffects() {
      renderer.flushPassiveEffects()
      renderer.flushSyncWork()
      renderer.flushPassiveEffects()
      renderer.flushSyncWork()
    },
    close() {
      renderer.flushSyncFromReconciler(() => renderer.updateContainerSync(null, root, null, () => undefined))
      renderer.flushSyncWork()
      renderer.flushPassiveEffects()
    },
  }
}
