# Nomi 反馈接收端

一个 Cloudflare Worker，三条 POST 路由，把 Nomi 桌面端发来的**已经脱敏过的** JSON 落进 R2，
反馈那一条再返回一个用户能引用的编号。

为什么自建而不是接 Sentry / PostHog / Aptabase：见
[docs/plan/2026-09-15-feedback-loop.md](../../docs/plan/2026-09-15-feedback-loop.md) 的「先查别人」节。
一句话——这一版开始收 Agent 轨迹了，「不收别的」从**肉眼可验**变成**只能靠承诺的一句话**，
而一句只能靠承诺的话，不能让第三方进程替我们说。

---

## 三步部署

```bash
cd infra/feedback-worker
npm install -D wrangler          # 本仓主 package.json 刻意不依赖它：这是接收端的工具链，不是 App 的
npx wrangler login
```

**第 1 步 · 建两个资源**

```bash
npx wrangler r2 bucket create nomi-feedback-intake
npx wrangler kv namespace create INTAKE_KV
```

KV 那条命令会打印一个 namespace id。把它填进 `wrangler.jsonc` 里
`kv_namespaces[0].id` 的 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`。
（桶名如果改了，`r2_buckets[0].bucket_name` 也要跟着改。）

**第 2 步 · 放令牌**

```bash
npx wrangler secret put INTAKE_TOKEN      # 粘一串长随机，比如 openssl rand -base64 36
```

**第 3 步 · 上线**

```bash
npx wrangler deploy
curl https://<你的 worker 域名>/           # 应当回 nomi-feedback-intake
```

然后在**打包 Nomi 时**注入两个环境变量，客户端才会往这里发：

```
NOMI_INTAKE_ENDPOINT=https://<你的 worker 域名>
NOMI_INTAKE_TOKEN=<第 2 步那串>
```

两个都没配 = 客户端状态是「已开启；未配置端点，只在本机记录」，一个网络请求都不发。

---

## 本地跑一遍

```bash
cp .dev.vars.example .dev.vars    # 里面填一个随便的 INTAKE_TOKEN
npx wrangler dev                  # 默认 http://localhost:8787
```

`wrangler dev` 会用本地模拟的 R2/KV，不碰线上数据。

```bash
curl -s -XPOST http://localhost:8787/v1/feedback \
  -H 'authorization: Bearer dev-token' -H 'content-type: application/json' \
  -d '{"summary":"hello"}'
# {"ok":true,"id":"NF-0915-0001","ref":"…"}
```

**本仓提交这份代码时，本机没有装 wrangler**（`which wrangler` → not found），所以
`wrangler dev` 那一段**没有真跑过**。真跑过的是路由/认证/大小/编号这四件的纯函数级
node 测试（`test/worker.node-test.mjs`，`node --test` 直接跑）和一个本机 mock 端点的
端到端走查。第一次部署的人请照上面走一遍，把 `curl` 的输出贴回 PR。

---

## 三条路由

| 路由 | 谁发 | 受「帮 Nomi 变好」开关管吗 | 返回 |
|---|---|---|---|
| `POST /v1/feedback` | 用户在失败面上点的一键反馈 | **不管**（他自己点的） | `{ok, id: "NF-MMDD-NNNN", ref}` |
| `POST /v1/events` | 白名单用量事件，攒批发 | 管 | `{ok, ref, accepted}` |
| `POST /v1/trajectories` | Agent 回合轨迹的字段白名单投影 | 管 | `{ok, ref}` |
| `GET /` | 存活探针 | — | `nomi-feedback-intake` |

全部要 `Authorization: Bearer <INTAKE_TOKEN>`。body 上限 2 MB。

落盘布局：

```
feedback/2026-09-15/<uuid>.json
events/2026-09-15/<uuid>.json
trajectories/2026-09-15/<uuid>.json
```

每个对象里是 `{schemaVersion, receivedAt, route, receipt, ref, payload}` ——
**客户端发来的原文放在 `payload` 里，服务端观察到的东西放在外层**，两者不混一层，
否则以后分不清某个字段是客户端声明的还是我们加的。

---

## 四条要诚实说清的事

**1. `INTAKE_TOKEN` 不是密钥，是发布令牌。**
它随桌面 App 一起发出去，任何人解包都能拿到。它挡的是「随手扫到这个 URL 的机器人」，
不是定向滥用。所以：这个端点**只能写，不能读、不能列、不能删**；令牌可以随时轮换
（改一次 secret，下一版 App 带新的，旧版就只是发不出去而已，不会报错给用户看）。
任何时候都不要在别处把它说成「已鉴权」。

**2. 编号 `NF-MMDD-NNNN` 的序号不是原子的。**
它来自 KV 的一次 read-modify-write。两条同时到达的反馈**可能拿到同一个显示号**。
这被刻意接受，因为编号只是「用户能念出来的把手」，不是主键——
每份反馈另外落在 `<prefix>/<日期>/<uuid>.json`，uuid 由 `crypto.randomUUID()` 生成，
**永不冲突、永不覆盖**，撞号的后果只是两份报告共用一个好记的名字。
换成原子计数器（Durable Object）要多一个部署概念 + 一条 migration，对「三步部署」不值得。

**3. 服务端刻意什么都不抹。**
密钥、路径、内容三类在**客户端**离开机器前就抹掉了
（`electron/telemetry/trajectoryProjection.mts` 的字段白名单 + `electron/logging/redact.ts` 的第二道网）。
服务端再抹一遍会制造一种「反正服务端会兜」的错觉，而那正是客户端脱敏松掉的起点。
接收端同样**不存** IP、User-Agent、Cloudflare geo —— 那是用户身份，而我们说了不收。

**4. 同一份反馈可能收到不止一次。**
客户端先把报告存在本机再发，发出去没等到回答（弱网、超时）就留着重发，而第一次可能已经落进 R2。
这里不做幂等：要做就得读一次已有的东西，而这个端点只写不读是第 1 条的前提。
重复由雷达折叠（`scripts/lib/intake-radar/aggregate.mjs`：创建时间和摘要都一样的算同一份），用户那边只是多拿过一个编号。

---

## 保留与删除

R2 没有内置的按前缀过期。想加保留期就在桶上配生命周期规则：

```bash
npx wrangler r2 bucket lifecycle add nomi-feedback-intake \
  --prefix events/ --expire-days 180
```

用户在 App 里点「删除全部」删的是**本机待发/已发摘要**，删不到这里。
这一点在设置页文案里没有承诺相反的话，别去加。
