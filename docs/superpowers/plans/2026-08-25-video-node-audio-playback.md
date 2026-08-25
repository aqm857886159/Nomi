# Video Node Audio Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a canvas video playing with audio after the user explicitly starts it, while still allowing pointer-leave to stop only an automatic hover preview.

**Architecture:** Keep the existing hover-preview helper and its temporary mute restoration. Add an explicit per-element playback marker that is set by user playback and checked by the pointer-leave stop path. Pointer leave pauses/resets only when the element is still an automatic hover preview; explicit user playback remains untouched. The node surface remains single-player at a time through the existing UI behavior; this change does not add a second audio system.

**Tech Stack:** React 18, TypeScript, Vitest, Electron renderer media elements.

---

### Task 1: Lock the playback-state contract with regression tests

**Files:**
- Modify: `src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.test.ts`
- Modify: `src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.ts`
- Modify: `src/workbench/generationCanvas/nodes/NodeVideoPlaybackGuard.tsx`

- [x] **Step 1: Add a failing test for explicit playback surviving pointer leave**

  Extend the fake video with a `dataset` object and assert the new public helper contract:

  ```ts
  it('does not stop user-started playback when the pointer leaves the node', () => {
    const video = fakeVideo(false)

    startNodeVideoHoverPreview(video)
    markNodeVideoUserPlayback(video)
    stopNodeVideoHoverPreview(video)

    expect(video.pause).not.toHaveBeenCalled()
    expect(video.currentTime).toBe(3)
    expect(video.muted).toBe(false)
  })
  ```

  Import `markNodeVideoUserPlayback` from the same module. The test must fail before implementation because the helper does not exist.

- [x] **Step 2: Run the focused test and verify the expected red failure**

  Run:

  ```bash
  pnpm exec vitest run src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.test.ts
  ```

  Expected: the existing two tests pass and the new test fails because `markNodeVideoUserPlayback` is not exported.

- [x] **Step 3: Implement the minimal explicit-playback marker**

  In `useNodeVideoHoverPreview.ts`:

  1. Add `const userPlayback = new WeakSet<HTMLVideoElement>()`.
  2. Export `markNodeVideoUserPlayback(video)` that adds the element to the set and restores the pre-hover mute value if one was saved.
  3. Update `stopNodeVideoHoverPreview(video)` to return without pausing/resetting when the element is in `userPlayback`.
  4. Keep the existing hover-only pause/reset and mute restoration unchanged for videos never explicitly started by the user.
  5. Clear the marker when the video is explicitly paused or reaches its natural end through a small exported `clearNodeVideoUserPlayback(video)` helper; the caller will wire this to the node video event handlers so a later hover can preview again.

- [x] **Step 4: Wire user media events at the playback-guard boundary**

  Modify `NodeVideoPlaybackGuard.tsx` so the shared guarded `<video>` receives the interaction tracking:

  - On pointer down/click, mark the video as user playback when it is paused or muted; this covers clicking the native play/unmute controls while the hover preview is active.
  - On play, mark playback unless the event is the one automatic hover `play()` call; on volume change, mark an explicit unmute. This also covers keyboard/native-control paths whose pointer events may not reach the author DOM.
  - On `onPause` and `onEnded`, clear the user-playback marker.
  - Invoke any caller-provided handlers after the internal marker update, and preserve the existing error/metadata healing handlers.

  Keep `BaseGenerationNode.tsx` unchanged apart from its existing `NodeVideoPlaybackGuard` usage; the playback guard is the single boundary for this media behavior.

- [x] **Step 5: Add the hover-only regression test**

  Keep a test proving the old intended behavior still holds:

  ```ts
  it('stops and rewinds a preview that was never user-started', () => {
    const video = fakeVideo(true)

    startNodeVideoHoverPreview(video)
    stopNodeVideoHoverPreview(video)

    expect(video.pause).toHaveBeenCalledOnce()
    expect(video.currentTime).toBe(0)
    expect(video.muted).toBe(true)
  })
  ```

- [x] **Step 6: Run the focused tests and verify green**

  Run:

  ```bash
  pnpm exec vitest run src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.test.ts
  ```

  Expected: all tests pass, including both explicit-playback and hover-only paths.

- [ ] **Step 7: Commit the scoped implementation**

  ```bash
  git add src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.ts src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.test.ts src/workbench/generationCanvas/nodes/NodeVideoPlaybackGuard.tsx docs/superpowers/plans/2026-08-25-video-node-audio-playback.md
  git commit -m "fix(canvas): keep user-started video playback audible"
  ```

### Task 2: Verify and deliver

**Files:**
- No additional production files; verification covers the scoped implementation.

- [x] **Step 1: Run repository gates required for a user-visible change**

  Run in order:

  ```bash
  pnpm run check:filesize
  pnpm run check:tokens
  pnpm run check:i18n
  pnpm run lint:ci
  pnpm run typecheck
  pnpm run test
  pnpm run build
  ```

- [x] **Step 2: Review the diff against origin/main**

  ```bash
  git diff --check origin/main...HEAD
  git diff --stat origin/main...HEAD
  git diff origin/main...HEAD -- src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.ts src/workbench/generationCanvas/nodes/useNodeVideoHoverPreview.test.ts src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx
  ```

- [ ] **Step 3: Request code review before merge**

  Review the exact branch diff for state attribution, event ordering, and regressions. Fix any important findings and rerun focused tests.

- [ ] **Step 4: Push, open PR, and merge after verification**

  ```bash
  git push -u origin codex/video-node-audio-playback
  gh pr create --base main --head codex/video-node-audio-playback --title "fix(canvas): keep user-started video playback audible" --body-file /tmp/video-node-audio-playback-pr.md
  gh pr merge --squash --delete-branch
  ```

  Report the PR URL, merge commit, verification outputs, and any known limitation.
