import { formatMediaBytes, type MediaImportRejection } from '../shared/contracts/mediaImportPolicy'

/**
 * 准入拒绝 → 给模型的一句人话（主进程侧，不走渲染层 i18n）。
 *
 * 和渲染层的 `mediaImportRejectionMessage` 是同一个可辨识联合的两个消费者（派生，不是并行版）：
 * 渲染层给用户看、要过 i18n；这条给模型看、必须带数字。每一支都说清「多大 / 上限多少 / 为什么」
 * ——只说「过大」等于让模型原地重试同一个文件。
 */
export function mcpImportRejectionMessage(fileName: string, rejection: MediaImportRejection): string {
  const name = fileName || '未命名文件'
  switch (rejection.reason) {
    case 'unsupported-kind':
      return `${name}：这个入口不收这种文件（认出的种类：${rejection.kind ?? '认不出'}；收的是 ${rejection.accepted.join('/')}${rejection.narrowedBecause ? `，因为${rejection.narrowedBecause}` : ''}）。`
    case 'no-disk-space':
      return `${name}：磁盘放不下（文件 ${formatMediaBytes(rejection.fileBytes)}，可用 ${formatMediaBytes(rejection.freeBytes)}，这次导入需要 ${formatMediaBytes(rejection.neededBytes)}）。`
    case 'over-hard-cap':
      return `${name}：超过这个入口的上限（文件 ${formatMediaBytes(rejection.fileBytes)}，上限 ${formatMediaBytes(rejection.capBytes)}${rejection.because ? `，${rejection.because}` : ''}）。`
  }
}
