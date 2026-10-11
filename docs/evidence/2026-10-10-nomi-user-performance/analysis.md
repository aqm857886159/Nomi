# Nomi user workflow performance analysis

Coverage is planned / implemented / executed / passed. Node regressions do not execute UI journeys. Cache cells remain separate. Frame/task quantiles pool raw observations within each cell. Loading frames are diagnostics, not active-gesture acceptance.

Schema2 reports are historical diagnostics: decoded content and production eligibility were incorrectly paired with first-feedback/interactive budgets. Those budget conclusions withdrawn; original raw statuses and numbers remain unchanged. Document-level Shift is not a target-control response.

| Report | Scale | Action | Cache | Status | Feedback p95 ms | Target response p95 ms | Decoded content p95 ms | Eligibility p95 ms | Loading frame p95 / p99 ms | Actions / frames / tasks |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| nomi-user-workflow-2026-10-11T01-45-12-349Z-0aadac1f-20f2-45d1-bb2c-95f41967f86b.json | small | project.open | cold | blocked_environment (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T01-45-12-349Z-0aadac1f-20f2-45d1-bb2c-95f41967f86b.json | small | D1 | cold | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T01-59-23-613Z-b856730c-7dd9-4cd3-9808-9e34d493d8f9.json | small | project.open | cold | invalid evidence | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T01-59-23-613Z-b856730c-7dd9-4cd3-9808-9e34d493d8f9.json | small | D1 | cold | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json | small | project.open | cold | invalid evidence | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json | small | project.open | hot | invalid evidence | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json | small | D1 | cold | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json | small | D1 | hot | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json | small | project.open | cold | invalid evidence | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json | small | project.open | hot | invalid evidence | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json | small | D1 | cold | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json | small | D1 | hot | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json | small | project.open | cold | invalid (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json | small | project.open | hot | failed_budget (historical; budget conclusions withdrawn) | — | — | 162.18000000044702 | 162.18000000044702 | 39.17500000000142 / 49.96700000000048 (unsupported p99) | 5 / 34 / 5 |
| nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json | small | D1 | cold | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json | small | D1 | hot | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json | small | project.open | cold | failed_budget (historical; budget conclusions withdrawn) | — | — | 809.5799999982119 | 809.5999999985099 | 33.3349999999994 / 100.00700000000002 | 5 / 194 / 7 |
| nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json | small | project.open | hot | failed_budget (historical; budget conclusions withdrawn) | — | — | 227.460000000149 | 227.460000000149 | 66.69999999999955 / 100.13300000000058 (unsupported p99) | 5 / 34 / 5 |
| nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json | small | D1 | cold | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json | small | D1 | hot | planned (historical; budget conclusions withdrawn) | — | — | — | — | — / — (unsupported p99) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-37-21-262Z-d8c8882c-cec4-4c5a-b77b-6870c835b24b.json | small | project.open | cold | failed_budget | 297.15999999940396 | 709.7599999994039 | 838.6400000013411 | 650.9999999992549 | 33.29999999999927 / 83.29999999999929 | 5 / 200 / 6 |
| nomi-user-workflow-2026-10-11T02-37-21-262Z-d8c8882c-cec4-4c5a-b77b-6870c835b24b.json | small | project.open | hot | inconclusive | 79.82000000029802 | 98.84000000059605 | 175.360000000149 | 79.89999999850988 | 50 / 50.06300000000023 (unsupported p99) | 5 / 38 / 4 |
| nomi-user-workflow-2026-10-11T02-45-37-723Z-b07fde97-c1cd-4178-a510-93df647735c2.json | small | project.open | cold | failed_budget | 267.3800000011921 | 677.359999999404 | 823.019999999553 | 635.5200000002981 | 33.30000000000109 / 66.60000000000036 | 5 / 206 / 5 |
| nomi-user-workflow-2026-10-11T02-45-37-723Z-b07fde97-c1cd-4178-a510-93df647735c2.json | small | project.open | hot | inconclusive | 82.27999999821186 | 100.9 | 182.239999999851 | 82.27999999821186 | 50 / 50 (unsupported p99) | 5 / 39 / 5 |
| nomi-user-workflow-2026-10-11T03-16-35-303Z-b9a1a0d4-dac9-4175-8471-145278562bc9.json | small | project.open | cold | failed_budget | 282.3 | 682.559999999404 | 763.280000000447 | 642.3200000017881 | 33.44999999925494 / 72.84000000003722 | 5 / 206 / 5 |
| nomi-user-workflow-2026-10-11T03-16-35-303Z-b9a1a0d4-dac9-4175-8471-145278562bc9.json | small | project.open | hot | inconclusive | 88.66000000089407 | 118.2800000011921 | 194.739999999851 | 88.66000000089407 | 65.68500000070779 / 74.53100000131874 (unsupported p99) | 5 / 42 / 5 |

Reason (nomi-user-workflow-2026-10-11T01-45-12-349Z-0aadac1f-20f2-45d1-bb2c-95f41967f86b.json/small/project.open/cold): Electron failed to install correctly. Please delete `node_modules/electron` and run "npx install-electron --no" manually.


Reason (nomi-user-workflow-2026-10-11T01-45-12-349Z-0aadac1f-20f2-45d1-bb2c-95f41967f86b.json/small/D1/cold): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Reason (nomi-user-workflow-2026-10-11T01-59-23-613Z-b856730c-7dd9-4cd3-9808-9e34d493d8f9.json/small/project.open/cold): teardown/correctness error: functional assertion: persisted content changed during project.open


Reason (nomi-user-workflow-2026-10-11T01-59-23-613Z-b856730c-7dd9-4cd3-9808-9e34d493d8f9.json/small/D1/cold): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Unverified (nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json/small/project.open/cold): main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames); fixed 1+5 protocol.


Unverified (nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json/small/project.open/hot): main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames); fixed 1+5 protocol.


Reason (nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json/small/D1/cold): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Reason (nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json/small/D1/hot): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Unverified (nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json/small/project.open/cold): main long-task probe; CPU action-window distribution; memory/teardown residual.


Unverified (nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json/small/project.open/hot): main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames).


Reason (nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json/small/D1/cold): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Reason (nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json/small/D1/hot): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Reason (nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json/small/project.open/cold): invalid measurement: missing/non-monotonic input or milestone


Unverified (nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json/small/project.open/hot): main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames).


Historical document-key diagnostic p95 (nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json/hot): 166.19999999925494ms; no target-control interactivity claim.


Reason (nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json/small/D1/cold): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Reason (nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json/small/D1/hot): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Unverified (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/small/project.open/cold): main long-task probe; CPU action-window distribution; memory/teardown residual.


Historical document-key diagnostic p95 (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/cold): 819.359999999404ms; no target-control interactivity claim.


Unverified (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/small/project.open/hot): main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames).


Historical document-key diagnostic p95 (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/hot): 231.35999999940395ms; no target-control interactivity claim.


Reason (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/small/D1/cold): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Reason (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/small/D1/hot): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Unverified (nomi-user-workflow-2026-10-11T02-37-21-262Z-d8c8882c-cec4-4c5a-b77b-6870c835b24b.json/small/project.open/cold): active-gesture frame metrics (project.open is a discrete click); main long-task probe; CPU action-window distribution; memory/teardown residual.


Unverified (nomi-user-workflow-2026-10-11T02-37-21-262Z-d8c8882c-cec4-4c5a-b77b-6870c835b24b.json/small/project.open/hot): active-gesture frame metrics (project.open is a discrete click); main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames).


Unverified (nomi-user-workflow-2026-10-11T02-45-37-723Z-b07fde97-c1cd-4178-a510-93df647735c2.json/small/project.open/cold): active-gesture frame metrics (project.open is a discrete click); main long-task probe; CPU action-window distribution; memory/teardown residual.


Unverified (nomi-user-workflow-2026-10-11T02-45-37-723Z-b07fde97-c1cd-4178-a510-93df647735c2.json/small/project.open/hot): active-gesture frame metrics (project.open is a discrete click); main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames).


Unverified (nomi-user-workflow-2026-10-11T03-16-35-303Z-b9a1a0d4-dac9-4175-8471-145278562bc9.json/small/project.open/cold): active-gesture frame metrics (project.open is a discrete click); main long-task probe; CPU action-window distribution; memory/teardown residual.


Unverified (nomi-user-workflow-2026-10-11T03-16-35-303Z-b9a1a0d4-dac9-4175-8471-145278562bc9.json/small/project.open/hot): active-gesture frame metrics (project.open is a discrete click); main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames).


Legacy reports: 2 — untrusted measurement schema; preserved as historical launch evidence only. Their elapsed times and percentile summaries are never treated as visible latency.

No full-product coverage, real hardware baseline or acceptance is claimed.
