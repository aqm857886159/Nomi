// AI 对话的 per-project 桶交换(harness S1,治串台根因):
// 两个面板的对话字段是全局单例,切项目时 store 实例不重建 → 上个项目的气泡漂进下个项目。
// 修法:字段形状不动(消费组件零改),内部按 projectId 存桶——切换时「存旧桶、载新桶」。
// 桶只活在内存(conversation 域,不混进画布 payload;落盘是 S1b/P-3 的事)。
export function createConversationBuckets<T>(empty: () => T) {
  const buckets = new Map<string, T>()
  return {
    /** 切项目:把当前字段存进旧项目的桶,返回新项目的桶(没有则空)。prevId=null 表示首次进入。 */
    swap(prevId: string | null, nextId: string | null, current: T): T {
      if (prevId && prevId !== nextId) buckets.set(prevId, current)
      if (!nextId) return empty()
      return buckets.get(nextId) ?? empty()
    },
    /** 测试用。 */
    clear() {
      buckets.clear()
    },
  }
}
