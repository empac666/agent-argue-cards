# Agent Argue 机制说明（中文）

## Agent 配置

`GET /api/agents` 会列出 AGY、Grok、OpenAI compatible、Anthropic、Gemini、Ollama，并注明当前环境是否配置。CLI 文件存在只证明命令可启动，登录状态会在实际调用时验证。

| Agent | 环境变量 |
| --- | --- |
| AGY | `AGY_BIN`（可选） |
| Grok | `GROK_BIN`（可选） |
| OpenAI compatible | `OPENAI_BASE_URL`（包含 `/v1`）、`OPENAI_MODEL`、可选 `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL` |
| Gemini | `GEMINI_API_KEY`、`GEMINI_MODEL` |
| Ollama | `OLLAMA_MODEL`、可选 `OLLAMA_BASE_URL` |

API 密钥只从服务端环境变量读取，页面和保存的辩论记录不包含密钥。上述四个 HTTP 适配器的请求格式已用本地模拟响应测试；真实服务还取决于用户的模型、配额、网络和权限。

其他能接收命令行参数或 prompt 文件、并在标准输出返回文本的 Agent，可通过 `ARGUE_CLI_AGENTS` 增加。该变量是 JSON 数组，每项包含 `id`、`name`、绝对路径 `command` 和字符串数组 `args`。参数中必须有 `{prompt}` 或 `{promptFile}` 占位符。例如：`[{"id":"myagent","name":"My Agent","command":"C:\\Tools\\myagent.exe","args":["--prompt-file","{promptFile}"]}]`。进程不经过 shell，在独立临时目录运行，沿用 150 秒默认超时（`ARGUE_AGENT_TIMEOUT_MS` 可调）和 120 KB 输出上限。此入口是接入协议，不意味着任何具体第三方 Agent 已通过实测。

## 辩论机制

新建辩论默认使用「真辩论」规则（`mode: "argue"`）。规则来自 AGY 与 Grok 的三轮设计讨论（初稿批评 → 交叉评审 → 对合并方案红队），由主持人合并：

1. **开局立场由代码分配**，不额外调用模型：用户在 API 里给的 `stances` 优先；否则从「A 还是 B」「A vs B」类辩题解析出两个选项，分给前两位辩手（第三位起为「条件派」）；解析不出时用通用张力模板（主张方 / 质疑方 / 条件派）。立场是开局义务，不是终身锁定：可以改变，但必须写明被对方哪条主张说服。
2. **第 1 轮盲立论**：每位辩手看不到对方本轮发言，只为自己的立场立论并给方案，避免第二位直接附和第一位。
3. **强制交锋期**（`minCycles`，默认 2）：第 1–2 轮不接受 AGREE；写了也只记一条「不计入」的规则消息。第 2 轮起，平台把对方上一条发言的 `claim`（一句核心主张）直接写进 prompt，要求逐条反驳，由代码指定反驳对象，辩手没法挑软柿子。发言 prompt 里已删掉原先的「尽量提出可达成共识的方案」「如果当前提案合理，可原样复用」。
4. **表态并入发言**：每次发言输出 `{claim, rebuttal, concessions, argument, vote, version, proposal}`。作者不对自己的提案投票；AGREE 必须指向当前版本号，附带的改稿一律丢弃；OBJECT 附修订方案，同时生成新版本号（SHA-256 前 16 位）并清空旧同意。每轮调用次数等于辩手人数，原来是两倍。
5. **独立裁判**：只有「非作者辩手全员 AGREE」的候选出现时才调用。裁判不能兼任辩手，默认是 `agy-claude`（通过 AGY 调用 `claude-sonnet-4-6`，与 Gemini/Grok 辩手异构，可用 `AGY_JUDGE_MODEL` 更换），不打分，不评胜负。判 CONSENSUS 要同时满足四条：交锋是真的；立场变化有据；核心分歧有具体落地（条件、阈值、分工），不能只说「兼顾两者」；方案可执行。它还必须至少给出 1 条逐字出自辩手记录的引文，由代码核验。输出不合格就重试一次，仍不合格按 CONTINUE 处理，不放行。CONTINUE 时，裁判指出的未解决点会写进下一位辩手的 prompt。
6. **防僵局**：`maxCycles` 为硬上限，argue 模式下必须大于 `minCycles`，页面默认 6。裁判累计否决 2 次即结束。最后一轮要求不得引入新议题：要么接受并写明让步，要么列出不能接受的分歧。结束时标为 `unresolved`（`outcome.kind` 为 `cycle-cap` 或 `judge-veto-cap`），并保留末案与未解决分歧。保留分歧是合法结果。点「继续」加 2 轮，并重置否决计数。
7. 暂停后等待当前调用返回再停。失败保留错误；进程重启时若有未完成调用，会标记交付状态不明，避免把未知状态当成成功。

旧记录没有 `mode` 字段，继续按原规则（`classic`）运行：每轮依次发言，全员对同一版本 AGREE 即结束。API 显式传 `"mode":"classic"` 也可以使用旧规则。

API 示例：`POST /api/rounds {"topic":"…","agents":["agy","grok"],"maxCycles":6,"judge":"agy-claude","minCycles":2,"stances":["立场一","立场二"]}`，其中 `judge`、`minCycles`、`stances` 都可省略。单次 Agent 调用默认 150 秒超时，Grok 深度推理较慢时可以设 `ARGUE_AGENT_TIMEOUT_MS=360000`。

当前是单机原型。观众票没有账号和防刷机制，不代表真实人类群体投票。共识是 Agent 的明确表态，不代表方案在现实中已验证。暂未直接接入 herdr；后续可利用其持久终端、`agent prompt`、`agent wait`、`agent read` 给 Claude Code、Codex、Cursor 等 CLI Agent 做会话式桥接。herdr 文档也提醒超时不等于发送失败，重试前必须先检查状态：[herdr](https://github.com/herdrdev/herdr)、[Agent automation](https://herdr.dev/docs/agent-automation/)。

## 群聊站队卡（mode: card）

to-C 方向的最小可用版：两位 AI 就一个日历家常题（春节回不回家、房租怎么分、彩礼给不给）各执一词，固定三拍后**一定**产出一张卡，发到亲友群让围观者站队。不判输赢、不打分、不给调解方案。

- 流程：第 1 拍盲立论（看不到对方）→ 第 2 拍点名反驳对方的核心主张 → 第 3 拍写明承认了对方什么、以及一句底线。共 6 次辩手调用 + 1 次终场编辑（默认 AGY·Claude Sonnet 4.6）。AGREE、提案版本、裁判共识在此模式下全部不参与。
- 让步核验：编辑必须为每条让步给出两段逐字原文——对方提出论点的原文（如 `A1`）和本方承认的原文（如 `B3`）。代码按发言编号、单个字段做精确子串核验（只压缩空白，不删标点），并核对说话者与先后顺序；自己引自己、归错人、改标点、编造、跨段拼接一律剔除。没有通过的写「未发现可核验的明确让步」，不凑数。
- 诚实兜底：编辑失败、辩手调用失败或超出整场预算（`ARGUE_CARD_BUDGET_MS`，默认 20 分钟）时仍然出卡，标 `complete:false` 并列出原因；未决点未确认时只展示双方最后主张，不冒充提炼结果。成卡后不能续轮。
- 分享页：`/card/<id>`，在控制台点「发布分享页」后才能访问。站队选项「站 A / 站 B / 信息不足」，按匿名 Cookie 按卡去重并持久化，站队后才显示分布；这只是匿名参与记录，不代表独立人数。
- 对外分享：控制台服务（`server.mjs`）只允许本机直连，不再支持 `ARGUE_SHARE_HOSTS`。公开分享用独立的只读服务 `share-server.mjs` 或导出的静态页/长图，见下文「导出与分享」。
- API：`POST /api/rounds {"mode":"card","topic":"春节回不回家过年？","agents":["agy","agy-gptoss"],"maxCycles":3,"facts":"共享背景","stances":["A 方立场","B 方立场"]}` → `POST /api/rounds/<id>/start` → 完成后 `POST /api/rounds/<id>/publish {}`。

## 导出与分享（feat/share-export）

一份「已审核卡片数据」生成所有发布物，生成端（本机 CLI 登录态）永远不暴露到公网：

1. 在控制台审完卡片点「发布分享页」，然后：
   - 控制台按钮：**导出微信长图**（1080px 宽 PNG，底部大字「回 A / B / 信息不足 + 一句理由」）、**导出静态页**、**导出卡片数据**；
   - 或命令行：`npm run export:snapshot -- <roundId>` → 写入 `cards/<id>.json`（白名单字段：不含站队 Cookie 哈希、票数、耗时、被剔除的让步、本机路径），这是唯一要提交、要人工复核的数据。
2. `npm run export:image -- cards/<id>.json [--lang en]` → `exports/<短号>-zh-long.png`（微信群主路径：直接发图）。
3. `npm run export:site -- --out _site` → `_site/index.html`、`_site/cards/<id>.html`（数据内嵌、零后端调用，含 OG/Twitter 元信息）、`_site/og/<id>.png`（1200×630）。
   - `cards/<id>.json` 里的 `translations.en` 是人工译文（只覆盖展示文字，逐字引文保留原文，不计入版本哈希，但必须写 `sourceVersion` 绑定原文版本，且有自己的 `version`（译文内容哈希）；人工改完译文后运行 `node scripts/export-cards.mjs stamp cards/<id>.json` 盖章，改了没盖章的译文校验不过。原文一改旧译文即失效：只忽略这份译文并警告，原文卡片照常发布）。卡片 JSON 按白名单逐字段校验，未知字段一律拒绝。有译文就额外生成 `<id>.en.html`。
   - 静态页带 meta CSP（无站队时禁止一切脚本）；`site` 先在临时目录完整生成再整体替换输出目录，撤下的卡不会残留。长图超过 16000px 直接报错，不静默裁切；截图默认开 Chrome 沙箱（容器/CI 需 `ARGUE_CHROME_NO_SANDBOX=1`），同时最多 2 个 Chrome（`ARGUE_SCREENSHOT_CONCURRENCY`）。
   - `site.config.json`：`baseUrl`（生成绝对 og:url/og:image）、`giscus`（默认 `enabled:false`；填好 repo/repoId/category/categoryId 并开启后才嵌入，需要公开仓库 + Discussions）。
4. `.github/workflows/pages.yml` 是**草稿**：只能手动触发（还要输入 `deploy` 确认），从已提交的 `cards/` 构建并部署 Pages，CI 不调用任何模型、不需要任何密钥。Pages 目前未开启。
5. 需要可计数的网页站队时，运行独立只读服务 `share-server.mjs`。按主持人裁定，推荐把它部署在**另一台机器**（如香港轻量服务器），本机只单向推送审核过的 `cards/*.json` 与 `_site/og/*.png`（如 `rsync`），生成端不对外：`node share-server.mjs --cards cards --og og --host 127.0.0.1 --port 4322` 再由该机的反代暴露。临时在本机用隧道试的话，只能挂 4322、绝不能挂 4321。它只提供 `/`、`/card/:id`、`/og/*.png`、`/api/cards/:id/side`，不导入任何生成/调度代码；站队票存 `.data/share-votes.json`（写盘失败会重试并对新票返回 503），有 Origin 校验、每 IP/全局写入限流、Host 白名单（`ARGUE_SHARE_HOSTS`）。`ARGUE_TRUSTED_PROXIES=127.0.0.1` 时只采信来自该对端的**一个**转发头的最右一跳（默认 `X-Forwarded-For`；走 Cloudflare 时设 `ARGUE_TRUSTED_PROXY_HEADER=cf-connecting-ip`；代理必须覆盖该头），并按 `X-Forwarded-Proto=https` 加 Secure Cookie；`ARGUE_PUBLIC_BASE_URL` 生成 og:url/canonical。

### 控制台的本机信任（安全修复）

以前控制台只看 `Host` 头判断「本机」，本机上的 nginx/cloudflared/`ssh -R` 只要把 Host 改写成 `localhost:4321` 就能把生成 API 暴露到公网。现在三条同时满足才放行：TCP 对端是回环地址、Host 是 `127.0.0.1/localhost:端口`、没有任何代理/隧道转发头（`X-Forwarded-For`、`Forwarded`、`CF-Connecting-IP`、`Via` 等）。第三条只是兜底——**不要把 4321 挂到任何代理或隧道后面**，公开只用 `share-server.mjs` 或静态文件。

## 演示模式

`npm run demo`（= `node server.mjs --demo`）：不需要任何 API Key 或 CLI。打开 http://127.0.0.1:4321 即可看到两局预录的**真实**模型辩论与站队卡（`demo/rounds.json`，已清空站队记录），可以发布、导出长图/静态页；新开的站队卡由「预设台词」演示辩手完成——流程、逐字核验和出卡与真实一致，但台词是固定模板，不是模型生成；这类卡的页面、长图和 OG 图上都会醒目标注「演示卡：预设台词」。演示数据每次启动复制到临时目录，不会改动仓库文件。
