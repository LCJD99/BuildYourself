# v0.2 目标澄清 Agent 服务

`POST /api/v2/goal-drafts` 和 `POST /api/v2/goal-drafts/{id}/messages` 在保存目标草稿前调用服务端 Agent。应用通过 `BUILDYOURSELF_AGENT_URL` 指定 Agent HTTP 端点；可选的 `BUILDYOURSELF_AGENT_TOKEN` 会以 Bearer token 发送。

应用以 JSON POST 请求调用该端点：

```json
{
  "task": "clarify_goal",
  "message": "希望三个月后能做英文项目介绍。",
  "transcript": [{ "role": "user", "message": "我想学英语" }],
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

端点不可用、超时或返回无效内容时，业务 API 返回错误且不保存该轮草稿。`BUILDYOURSELF_AGENT_URL` 未设置时返回 `503`。应用验证返回字段后才持久化；浏览器提交的 `agentDraft` 字段不会被采纳。

仓库现有 `pi/goal.js` 是 PI 运行时中的旧目标规划工具，它调用 `/api/goal-plans`，并不是这个服务端 HTTP 协议的实现。当前仓库没有提供兼容的 v0.2 Agent 服务或 bridge；启用 v0.2 澄清流程前需要配置实现上述请求/响应契约的服务。API 测试以受控 Agent 结果验证持久化和确认边界，不能替代真实 Agent 联调。
