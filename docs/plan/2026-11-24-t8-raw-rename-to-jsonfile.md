# T-8 raw rename consolidation

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## ★0 Prior art

- Node exposes synchronous and promise-based rename for already staged files. This confirms that publication can stay on the same native operation and preserve errno identity. [Node filesystem API](https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath)
- npm's writer owns serialization, temporary files and fsync, and calls rename once. This confirms that a whole-file writer fits MCP profiles, while already staged exports, binary files and lock directories need a rename operation. [write-file-atomic source](https://github.com/npm/write-file-atomic/blob/main/lib/index.js)
- graceful-fs backs off on Windows when the target is absent. This confirms reuse of the existing timer policy for exports, which must also work when replacing an existing MP4. [graceful-fs source](https://github.com/isaacs/node-graceful-fs/blob/main/polyfills.js)

出口：`electron/workspace/workspaceManifestLock.ts:463` · The sync API returns contention to its caller immediately. The async API rechecks ownership after its own bounded wait, and orphan cleanup advances on its own timer. Keeping one native attempt preserves those exits.

## ★1 Creator goal and measures

A creator can reopen a workspace, save a project or resume a run without a second writer taking the current owner's place. A creator can export an MP4, replace an existing output and open the completed file. Both tasks follow the existing commands and locations. Desktop replay of these tasks is unverified in this local refactor.

- Ownership → contenders leave the current owner intact → all lock contention, recovery and fencing cases pass in `productionRunLock.test.ts`, `workspaceManifestLock.test.ts` and `workspaceManifestLock.transientRelease.test.ts`.
- Publication → a staged result lands or the prior target survives → all relevant cases pass in `jsonFile.test.ts`, `ffmpegRunner.test.ts` and the affected store suites.
- Coverage → native calls use the shared owner → baseline 24 frozen calls in 17 files, target 0 of 24 remaining, measured from `eslint-suppressions.json` and Electron ESLint.

### ★1b Related surfaces

Workspace save, production recovery, export, settings, media import and Agent trace retain the outcomes and messages from their existing callers.

### ★1c Existing data

Project and run locks, receipt quarantine, assets, output files and skill backups retain their paths and data formats. Auto-detected MCP profiles share the existing manual-profile writer, which adds a trailing newline already accepted by the shared JSON reader. Existing profiles parse as written. The previous release can read the same record.

## ★2 Ownership and scope

`persistence.atomic-rename` registers `electron/jsonFile.ts` as the native rename owner. `electron/sharingRetry.ts` owns sharing-error classification and backoff. Callers own validation, transaction fences, rollback, permissions and cleanup. `production.run-lock` and `project.directory-lifecycle` retain their current owners in the concept registry. Workspace async acquisition owns the wait deadline and recovery, and FFmpeg owns output validation and cleanup after its publication budget expires.

Baseline `door-map` counted 9 files and 15 calls to `renameSyncWithRetry`, 26 files and 41 calls to `writeJsonFileAtomic`, and zero async rename wrapper calls. The ESLint freeze supplied the 17 remaining caller files. The regression contract records the post-change door map.

| Callers | Publication contract |
|---|---|
| Lane trace, certification cleanup, attention sound | Async rename with permissions, cleanup and rollback still owned by the caller |
| Upload content store | Compact sidecars and existing cleanup. Hash-cache updates stay single-attempt and synchronous. Source backfill stays async |
| Browser media | Network staging stays async. The synchronous Electron download callback keeps one attempt before reporting completion |
| Verified asset cache, FFmpeg | Publish only verified output. Preserve file sync and the FFmpeg long timer budget |
| MCP detected clients | Share the manual-profile JSON writer. Keep best-effort registration |
| Host config | Rename once inside the existing retry of the whole checked transaction |
| Asset preview, artifact projection, logging | Keep one attempt after a preview existence check or secret read, and during best-effort log rotation. Scratch preview adoption can use the ordinary shared retry |
| Proposal receipt, speech install, skill migration | Attempt quarantine once. Keep staged executable directory and Markdown/backup framing |
| Production Run lock, workspace manifest lock | One attempt for stale-owner quarantine, workspace candidate publication and background orphan reaping. Existing workspace release retry remains with its existing owner |

## ★3 Prior decisions and reuse

[#1586 replacement decision](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7103051778) and [go-ahead after the menu merge](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7106971443) authorize a single replacement with characterization first. The [main-thread wait decision](../engineering/direction-checks/2026-11-13-main-thread-sync-wait.md) keeps export timer-based and leaves the lock flows synchronous where they already are. The direction review below compares the three paths.

## ★4 States

| State | Caller behavior |
|---|---|
| Empty | Existing first-save, first-export or first-registration path creates the target |
| Loading | Existing workspace wait and export progress continue through final publication |
| Success | The completed file or lock is visible before returning success |
| Failure | The original errno reaches the existing caller's failure mapping |
| Partial success | Optional caches and detection remain best effort. A committed workspace save retains the existing release cleanup path |
| Cancelling | Existing export and download cancellation logic owns the operation |
| Expired | Existing acquisition deadlines and production fencing decide recovery |
| Capability unavailable | Existing download or export error remains actionable through the same command after the resource returns |

## ★5 Interruptions

Each cell inherits the caller's existing status, spend policy and receipts. File publication itself makes no provider submission.

| State | Stop | Close | Offline | Restart | Repeat |
|---|---|---|---|---|---|
| Acquiring | Caller cancellation or deadline | Existing shutdown | Local lock continues | Existing owner recovery | Competing owner sees contention |
| Publishing | Existing caller cancellation boundary | Existing shutdown | Local staging continues | Existing staging and recovery rules apply | Existing serialization or conflict handling applies |
| Completed or failed | Existing result or error | Existing receipts | Existing local result or error | Reload recorded state | Existing entry point starts the next attempt |

## ★6 External data and failures

The input is a local file or directory supplied by its caller. Node supplies errno. `EEXIST`, `ENOTEMPTY` and `ENOENT` propagate immediately from the retrying APIs. `EPERM`, `EBUSY` and `EACCES` use the existing shared budget on retrying paths. An eligibility or ownership check around a rename remains in the enclosing operation so it can be repeated by that owner. [Node filesystem API](https://nodejs.org/api/fs.html#fsrenamesyncoldpath-newpath)

## ★7 Performance

There are zero new interactions. The existing FFmpeg retry table remains timer-based and totals 2,600 ms. Contention-sensitive sync operations still attempt once per caller decision. The existing short retry budget is 400 ms. Measure attempts and timer use in the JSON, workspace lock and FFmpeg tests. End-to-end Windows latency is unverified.

## ★8 Real conditions

Local filesystem success, overwrite and failed rename are exercised with actual temporary files by the unit suites. Windows real handle contention, desktop workspace and export replay, English UI, minimum window, production-scale media, clean install, paid execution and keyboard-only paths are unverified. The existing Windows-specific lock test is platform gated. There are no new board elements.

## ★9 Acceptance and rollback

| Check | Counterexample | Evidence |
|---|---|---|
| Complete publication and cleanup | No-op or rejecting rename leaves the old file or never publishes | JSON and FFmpeg tests check the new bytes and that staging is gone |
| Failed publication | Overwrite old JSON or strand the temporary file on failure | JSON test checks old bytes, original error and exact directory contents |
| Error identity and retry policy | Retry errno for a missing source or lock conflict, or wrap the error | JSON matrix checks identity and one attempt for both retry APIs |
| Workspace contention | Repeat a candidate rename after the first conflicting attempt | Workspace matrix checks one attempt and preserves the competing owner's bytes |
| Host config commit | Retry the syscall while skipping the fence and original-byte comparison | Host config tests inject shared-file conflicts and concurrent edits |
| Existing output replacement | Fall back to six attempts or block synchronously during export | FFmpeg tests exercise the long budget and successful retry |
| Static ownership | Reintroduce either old raw form or incorrectly reject an owner-backed call | T-8 structural fixtures and full Electron lint |
| Delivery | A new boundary, size or type failure, or stale suppression | Requested structural gates, sequential Electron typechecks and before/after count |

Hard gates ⑩ and ⑪ are outside this filesystem change. For ⑫, published files and lock ownership are the local outcomes, with Electron UI replay unverified. Independent acceptance before merge is pending. Revert the single commit to roll back the call sites and suppressions together.

Local acceptance on macOS

- The baseline characterization passed 70 tests with one platform skip. Six new helper cases failed because the shared exports were missing. The async publication test also rejected isolated no-op and reject-all versions and passed after restoration.
- A native rename over an occupied directory returned `ENOTEMPTY` and preserved the existing owner file. The workspace suite exercised `EEXIST`, `ENOTEMPTY` and `EPERM` contention after one attempt.
- Vitest passed 1,258 tests across 84 suites with three skips at two workers. The Node Agent Lane trace suites passed 15 tests. The T-8 structural suite passed nine tests.
- The freeze moved from 24 raw rename suppressions to zero. Eight overlapping hot-path suppressions became stale when their raw calls moved and were pruned. Electron ESLint reported zero errors and 42 warnings. Both Electron typechecks passed.

## Direction check

### 0. Cause

The rename policy was already shared. Frozen lint findings let equivalent producers bypass the native operation owner or wrap the syscall locally.

### 1. Evidence

| Case | Immediate cause | Class |
|---|---|---|
| FFmpeg 7e19dd053 | Export rename previously waited on the main thread. The async retry fixed the wait, while both raw calls remained frozen | Shared policy with local publication |
| Workspace candidate and orphan recovery | Caller owns lock decisions and invokes raw rename as part of them | Caller-owned retry |
| Detected MCP profiles and log archive | Each writer called the same native operation directly | Duplicate native boundary |

### 2. Why it can recur

Atomic publication and deciding whether to retry are different responsibilities. Callers need both an ordinary rename with shared retry and a single attempt for checked transactions. This file-publication seam is outside the registered seams table. It supports ⑫ through successful file publication, while ⑩ and ⑪ concern model controls.

### 3. Predictions

On 2026-12-08, rerun Electron lint and the T-8 node test. Predict zero suppressed raw renames and rejection of both prior raw forms. Predict the workspace contention matrix still sees exactly one candidate publication attempt on each conflict. Reopen the review if either prediction fails.

### 4. Independent target

The existing FFmpeg, host config and lock tests predate this refactor. New characterization adds observable target bytes, unchanged competing ownership and original errors. Independent acceptance is pending.

### 5. Ownership

这一整块：主进程的文件与目录原子发布，涉及自写登记 durable-json、mcp-protocol 和 logging-and-crash。
归谁：Node 文件系统 API（Electron 43.4.1 内置）及 `electron/jsonFile.ts:44` 的主进程调用边界。https://nodejs.org/api/fs.html#fsrenamesyncoldpath-newpath
我们哪里绕开了它：基线 `electron/export/ffmpegRunner.ts:311` 直接调用原生重命名，`electron/workspace/workspaceManifestLock.ts:436` 在发布协议内直接调用。

The scan flags export, settings and workspace directories plus the three registered capabilities above. No edited file is individually hot. The replacement uses the existing library boundary and removes the bypasses in the same commit. The existing durability review is due 2026-11-30. Recheck library fit against caller-owned retries, overwriting a completed export and file/directory publication before any library swap. MCP protocol and log rotation behavior stay with their registered implementations.

### 6. Options

| Option | Cost and result |
|---|---|
| Retain local calls | The lint findings stay frozen and the next writer can copy a bypass |
| Move native calls to the existing Node-backed owner | Recommended. Preserves publication and the caller's decision to repeat a checked operation. No new dependency |
| Delete staging and write directly | A failed write can expose partial data, and lock publication loses its atomic operation |

### 7. Tradeoff

Centralize the syscall while letting each lock or transaction decide when it has enough evidence to try again.

Characterization is in `electron/jsonFile.test.ts` and `electron/workspace/workspaceManifestLock.test.ts`, backed by existing lock, host config and FFmpeg tests.
