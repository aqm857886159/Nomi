# Real-film evaluation assets

The generated MP4 and its project-local `.nomi` run are intentionally ignored by
Git because media binaries do not belong in the source commit. Rebuild the exact
acceptance asset from the repository source with:

```bash
node scripts/benchmarks/build-agentic-draft-film.mjs
```

The builder uses the checked-in launch film and subtitle source, trims both to 30
seconds, muxes H.264/AAC/`mov_text`, and writes the script, approved storyboard,
timeline contract and Run snapshot under `artifacts/`.

Do not use this deterministic asset as evidence of fresh provider-generated
character consistency. It is the project persistence, subtitle, transition metadata
and export-contract fixture; provider quality requires a separate credentialed run.
