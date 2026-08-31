# Real export transition fix

## Problem

The production run persists authored `dissolve`/`match_cut` transitions in the
timeline contract, but the primary FFmpeg filtergraph originally composited each
clip onto a white base with time-windowed overlays. The exported MP4 therefore
had metadata for transitions while the pixels remained hard cuts. A first
`xfade` implementation also exposed a compatibility problem: Nomi's bundled
FFmpeg 4.4 truncated a chained xfade graph. The final implementation uses a
frame-accurate alpha overlay, which works on the bundled binary and keeps the
authored duration.

## Scope

- Carry authored transition pairs from `TimelineState` into the renderer export
  manifest.
- Render non-cut transitions with a frame-accurate alpha overlay compatible with
  the bundled FFmpeg 4.4.
- Normalize video to the timeline FPS, clone the final decoded frame when a
  provider stream is a few frames short, and trim by exact frame count.
- Keep authored transition metadata in the durable timeline artifact and export
  manifest so external MCP and in-app export share the same plan.
- Add RED/GREEN filtergraph tests and re-run one real 30-second MCP production
  run, then inspect the exported pixels, subtitles, audio and duration.

## Generation throughput policy

The old driver submitted every provider job serially. That was safe but made a
six-shot run wait roughly six provider latencies in a row. The run policy now
stores `maxConcurrentJobs` (1–6, default 1) and the driver submits bounded waves:

- the first sample remains a one-job safety wave;
- reference-card jobs settle before dependent shots;
- a shot with `previousShotId` waits for that shot to be adopted;
- only independent jobs use the configured wave size;
- each wave persists `submit_intent_persisted`/`submitting` before any provider
  call, and all outcomes are reconciled without duplicate idempotency keys.

The value can be changed in Nomi Settings or from the external Agent via
`nomi_control_run(action=set_concurrency, maxConcurrentJobs=N)`. It affects only
jobs not yet submitted; it cannot cancel or duplicate an in-flight provider
task.

## Not in scope

- Rewriting the timeline model or provider prompts.
- Claiming a transition is visible from metadata alone.
- Changing the external Agent approval surface.

## Acceptance

- Non-cut authored transitions produce an alpha fade/overlay filter in the real
  export plan (not metadata-only).
- The final MP4 is 25–35 seconds, H.264 + AAC, contains no white boundary frames,
  has audible non-silent audio, and has visible authored transition evidence in
  boundary frames/contact sheet.
