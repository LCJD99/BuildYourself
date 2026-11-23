# v0.2 目标澄清 Agent 服务

`POST /api/v2/goal-drafts` 和 `POST /api/v2/goal-drafts/{id}/messages` 在保存目标草稿前通过 Node.js `execFile` 调用本机 PI CLI。应用复用 PI 已配置的 provider 和认证；可通过 `BUILDYOURSELF_PI_BIN` 指定命令路径，通过 `BUILDYOURSELF_AGENT_MODEL` 选择模型。Next.js 服务进程必须能访问 PI CLI，并使用已完成认证的 PI 配置目录。

应用通过无工具、无扩展、无 MCP、无会话的非交互 PI 调用发送 JSON 上下文：

```json
{
  "task": "clarify_goal",
  "latestMessage": "希望三个月后能做英文项目介绍。",
  "conversation": [{ "role": "user", "message": "我想学英语" }],
  "currentDraft": null
}
```

继续澄清时，`transcript` 包含此前的用户消息与 Agent 回复，`currentDraft` 包含当前草稿及其 `id`、`revision`。Agent 返回如下 JSON；`draft` 中的字段可以逐步补充，`clarifyingQuestions` 是用户仍需回答的问题：

```json
{
  "reply": "你希望通过什么可观察的结果判断目标达成？",
  "draft": {
    "title": "提升英语表达能力",
    "description": "能够完成英文项目介绍并回答常见问题。",
    "constraints": { "status": "needs_clarification", "items": [] },
    "attributes": [{ "name": "口语表达", "description": "表达的清晰度" }],
    "clarifyingQuestions": ["你希望达到什么可观察的结果？"]
  }
}
```

PI 命令缺失、模型超时或返回无效内容时，业务 API 返回可诊断错误且不保存该轮草稿。模型必须只返回一个 JSON 对象；应用验证其字段后才持久化。PI 只收到保存的自然语言对话和草稿，不提供工具，也不会写入 PI 会话文件。浏览器提交的 `agentDraft` 字段不会被采纳。

仓库现有 `pi/goal.js` 仍是调用 `/api/goal-plans` 的旧目标规划工具，不会直接编排 v0.2 草稿路由。v0.2 API 自己通过 PI CLI 调用已配置模型，并把每轮对话作为上下文传入；它不复用正在运行的 TUI 会话。目标确认响应中的 `weeklyPlanGeneration.status` 当前为 `not_implemented`；首周规划接入前不会生成。Node 子进程调用 PI 时必须结束 stdin，否则 PI 的 `--print` 会等待输入结束。

自动化测试默认用可控命令替身。需要验证真实 PI 多轮 HTTP 流程时，在已认证的 PI 环境运行：

```sh
RUN_PI_AGENT_SMOKE=1 BUILDYOURSELF_AGENT_MODEL=magpie/auto/auto npm test -- tests/goal-drafts-live-smoke.test.ts
```

该烟测通过初始草稿和后续消息两个 v2 路由调用真实 PI 模型；模型命令和模型名也可分别用 `BUILDYOURSELF_PI_BIN`、`BUILDYOURSELF_AGENT_MODEL` 替换。
