# Nomi user workflow performance analysis

Coverage is planned / implemented / executed / passed. Node regressions do not execute UI journeys. Each cache cell remains separate; quantiles pool raw frame/task distributions within that cell only.

| Report | Scale | Action | Cache | Status | Visible p95 ms | Ready p95 ms | Frame p95 ms | Frame p99 ms | Actions / frames / tasks |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| nomi-user-workflow-2026-10-11T01-45-12-349Z-0aadac1f-20f2-45d1-bb2c-95f41967f86b.json | small | project.open | cold | blocked_environment | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T01-45-12-349Z-0aadac1f-20f2-45d1-bb2c-95f41967f86b.json | small | D1 | cold | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T01-59-23-613Z-b856730c-7dd9-4cd3-9808-9e34d493d8f9.json | small | project.open | cold | invalid evidence | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T01-59-23-613Z-b856730c-7dd9-4cd3-9808-9e34d493d8f9.json | small | D1 | cold | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json | small | project.open | cold | invalid evidence | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json | small | project.open | hot | invalid evidence | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json | small | D1 | cold | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-02-37-609Z-9396c3e5-82ac-438a-a995-06ca965ebd30.json | small | D1 | hot | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json | small | project.open | cold | invalid evidence | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json | small | project.open | hot | invalid evidence | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json | small | D1 | cold | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-03-32-096Z-ec61a1db-35ca-4985-ba2a-260b75afe8d8.json | small | D1 | hot | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json | small | project.open | cold | invalid | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json | small | project.open | hot | failed_budget | 162.18000000044702 | 162.18000000044702 | 39.17500000000142 | 49.96700000000048 (unsupported) | 5 / 34 / 5 |
| nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json | small | D1 | cold | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json | small | D1 | hot | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json | small | project.open | cold | failed_budget | 809.5799999982119 | 809.5999999985099 | 33.3349999999994 | 100.00700000000002 | 5 / 194 / 7 |
| nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json | small | project.open | hot | failed_budget | 227.460000000149 | 227.460000000149 | 66.69999999999955 | 100.13300000000058 (unsupported) | 5 / 34 / 5 |
| nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json | small | D1 | cold | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |
| nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json | small | D1 | hot | planned | — | — | — | — (unsupported) | 0 / 0 / 0 |

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


Reason (nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json/small/D1/cold): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Reason (nomi-user-workflow-2026-10-11T02-07-19-848Z-79c42362-31bc-4b00-800b-532d3b5b74de.json/small/D1/hot): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Unverified (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/small/project.open/cold): main long-task probe; CPU action-window distribution; memory/teardown residual.


Unverified (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/small/project.open/hot): main long-task probe; CPU action-window distribution; memory/teardown residual; p99 sample support (<100 frames).


Reason (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/small/D1/cold): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Reason (nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json/small/D1/hot): Full journey remains planned; see entry-inventory.md. Partial branches were removed.


Legacy reports: 2 — untrusted measurement schema; preserved as historical launch evidence only. Their elapsed times and percentile summaries are never treated as visible latency.

No production optimization, full-product coverage, real hardware baseline or acceptance is claimed.
