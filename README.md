# 商户服务助手 · AI 客服对话演示

支付行业商户服务 AI 客服的会话场景演示：选一个会话场景，在手机界面里按预设问题一步步提问，右边逐轮说明 AI 为什么这样答。

- **17 个会话场景**，分为正常办理、先问清楚、系统异常、越界拦截、转人工、反例六组；每个场景是一段从开始到结束的完整多轮对话。
- **反例和正常场景成对出现**：同一个问题，答对是什么样、答错是什么样、错在哪、正确的应该是什么。
- 输入框只能从分类好的预设问题里选择；对话结束后没有后续问题。

> 对话为预设脚本，用于演示处理逻辑。正常场景的 AI 回复由 `engine/` 里一套可运行的处理规则生成（保证同样的情况说法一致），反例为人为构造。品牌「演示支付」、商户与数据均为虚构，不代表任何线上系统。

打开 `docs/index.html` 即可查看，不需要联网，不需要任何 API。

修改场景：编辑 `engine/stories.js`（场景、预设问题、逐轮说明、反例回复），然后运行 `node scripts/build.mjs`。

---

以下是背后的处理规则（技术附录）。

## 设计原则：大模型负责语言，代码负责策略

| 由代码决定 | 由大模型完成 |
|---|---|
| 商户身份（服务端从登录态注入，工具参数里没有 merchant_id） | 理解商户想得到什么结果（任务类型） |
| 账号权限（跟账号走，不跟"是不是这家店的人"走） | 把模板答复改写得更自然 |
| 对话里报的商户号只是定位线索，不是授权 | |
| 工具四种返回（ok / empty / multiple / error）各自的处理 | |
| 答复前检查、转人工条件、能不能执行 | |
| 金额、状态、时间（由系统字段填入卡片） | |

大模型改写后要过一道守卫：关键事实必须保留、不得出现原文没有的数字、不得承诺、不得索要卡号密码验证码。不通过就退回模板，后台能看到被拦下的原文。

## 每一轮的处理

1. 诉求是否明确 → 2. 前置检查（身份、会话、业务对象、账号权限）→ 3. 取证（知识库 / 业务工具 / 两者 / 直接人工）→ 4. 工具返回四种情况 → 5. 答复前检查 → 6. 四种出口：直答 / 补问补查 / 部分答复 / 带上下文交人工

会话状态和诉求状态分开记：「已答复」不等于「已解决」，「未解决」不是终点。

## 8 个问题 × 36 种情况

| 问题 | 覆盖的情况 |
|---|---|
| T+1 结算是什么意思？ | 正常；追问到个人转为查询；新旧两版知识冲突 |
| 帮我查一下昨天的交易 | 单店；多店先问哪一家；"那笔 1280"匹配到两笔；为空；超时；登录失效；身份没传到工具（模拟失效）；收银员无权限 |
| 昨天的钱为什么还没到账？ | 处理中；已出款银行未确认；退回；两处记录冲突；追问赔偿 |
| 到账为什么少了 12 元？ | 完全可解释；只能解释一部分；账务对不上 |
| 怎么更换结算卡？ | 引导；"你帮我换了"；改联系电话（确认后提交）；提交超时先查状态 |
| 账户冻结 | 是什么意思；是不是；为什么；什么时候解冻；帮我解冻；赔不赔 |
| 查商户号 xxx 的交易 | 在授权范围内；不属于当前账号；服务商代问 |
| 我要找人工 | 带上下文转接；点"未解决"；没有客服在线；客服接入后 AI 停止回复 |

每一格都写明"应当怎样处理"（`engine/scenarios.js`），规则模式必须 36/36 通过；大模型模式每格跑 3 次，统计 pass^3。

## 运行

需要 Node.js 18 以上，没有任何第三方依赖。

```bash
node scripts/test.mjs      # 规则模式全量回归，36 个场景
node scripts/build.mjs     # 生成会话场景演示 docs/index.html
node scripts/build-legacy.mjs  # 生成技术附录页 docs/legacy/agent-trace.html（每轮决策轨迹）
```

可选：用真实大模型录制（当前演示不需要）：

```bash
DASHSCOPE_API_KEY=你的key node scripts/record.mjs     # 通义千问 qwen-plus
DEEPSEEK_API_KEY=你的key  node scripts/record.mjs     # DeepSeek
RUNS=3 ONLY=2b,3e LLM_MODEL=qwen-max ...              # 可选参数
node scripts/build.mjs
```

录制回放的是第一次运行的原样结果，不挑最好的一次。API Key 只在本机使用，不写入任何文件。

## MCP

模拟业务系统的工具也以 MCP（stdio）暴露，可以接到任意支持 MCP 的客户端：

```bash
MCP_ACCOUNT=finance MCP_STORE=滨江 node mcp-server.mjs
```

工具：`get_txn_summary` `list_txns` `get_settlement` `get_settlement_breakdown` `get_account_status` `update_merchant_info` `get_change_status` `search_knowledge`。工具参数里没有商户号，身份来自服务端会话。

## 目录

```
engine/
  data.js        模拟业务数据（全部虚构）
  tools.js       业务工具层，返回 ok / empty / multiple / error
  understand.js  规则版诉求理解
  llm.js         大模型：诉求理解 + 答复改写（OpenAI 兼容接口）
  guard.js       答复守卫
  agent.js       每一轮的策略：前置检查 → 取证 → 答复前检查 → 出口
  scenarios.js   8 个问题 × 36 种情况及预期
  runner.js      多轮运行与判定
scripts/         test / record / build
web/index.html   App + 运营后台（回放录制）
mcp-server.mjs   MCP 服务
docs/            构建产物（GitHub Pages）
```

## License

MIT
