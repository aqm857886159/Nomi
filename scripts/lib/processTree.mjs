import { spawnSync } from 'node:child_process'

/** 子进程必须自成进程组，超时时才能在 POSIX 上一次终止整个后代树。 */
export function processTreeSpawnOptions() {
  return process.platform === 'win32' ? {} : { detached: true }
}

/** 终止自己创建的进程及其后代；活进程不是组长时显式报调用方误用。 */
export function killProcessTree(child, signal = 'SIGKILL') {
  const pid = child?.pid
  // 测试替身没有 pid 时仍保留 ChildProcess 的信号语义；真实 spawn 必须带 pid 才能进入这里。
  if (!pid) return child?.kill?.(signal) ?? false
  try {
    if (process.platform === 'win32') {
      // A completed parent PID may be reused; do not issue a new native kill against it.
      if (child.exitCode != null || child.signalCode != null) return false
      const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      if (result.error || result.status !== 0) {
        if (child.exitCode != null || child.signalCode != null) return false
        throw new Error('process_cleanup_failed: native tree termination was not successful', { cause: result.error ?? new Error('taskkill_exit_' + result.status) })
      }
    } else {
      process.kill(-pid, signal)
    }
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') {
      if (child?.exitCode === null && child?.signalCode === null) {
        throw new Error('killProcessTree: live child is not a process-group leader; spawn it with processTreeSpawnOptions()', { cause: error })
      }
      return false
    }
    throw error
  }
}
