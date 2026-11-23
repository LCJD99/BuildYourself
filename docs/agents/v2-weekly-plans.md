# v0.2 首周规划 Agent 与接口

启用目标时，`POST /api/v2/goal-drafts/{id}/confirm` 会保存目标后，通过已配置的 PI CLI 生成当前周规划草稿。规划失败不会撤销目标启用；确认响应包含 `weeklyPlanGeneration.status = failed` 和错误说明。可用 `GET /api/v2/goals/{id}/weekly-plans?weekStart=YYYY-MM-DD` 回读状态，并通过 `POST` 同一路径使用同一目标 ID 重试。日期必须是星期一。

规划 Agent 获得当前周一到周日、所有已启用目标及属性、现有规划（若有）和用户调整意见。生成时，服务端计算现有规划尚未覆盖的目标及其属性，并以 `requiredGoalIds` 和完整 `requiredGoals` 记录显式传给 Agent。模型必须为其中每个目标至少新增或修改一项行动，且将该目标及其自身属性关联到行动；本次新增目标也会作为 `focusGoalId` 传入。缺少任一目标及属性覆盖时，生成标记为失败，可在目标仍启用的情况下重试。返回的行动必须明确标注 `operation: add|update`，关联有效目标 ID 和属于这些目标的属性 ID，且日期在当前周。单项行动的一个记录可关联多个目标和多个属性；服务端为新增行动分配稳定 ID。用户调整时模型可只返回新增或改动的行动，服务端会保留未提及的旧行动。修改已有行动必须使用 `update` 并携带输入中的准确 ID；新增同名行动使用 `add` 并由服务端分配新 ID。`add` 可带模型生成的临时文本 ID，但不得复用当前规划内的 ID；只有 `id` 字段有效，未知 alias 字段会被拒绝。这样无需按标题猜测身份。每个规划版本保存用户原始调整意见及 Agent 回复。模型输出格式错误或关联无效时拒绝整轮，不覆盖已保存版本。

读取规划：`GET /api/v2/weekly-plans/{id}` 返回最新版本、当前生效版本和完整版本历史。自然语言调整：`POST /api/v2/weekly-plans/{id}/messages`，正文包括 `revision` 和 `message`。确认版本：`POST /api/v2/weekly-plans/{id}/confirm`，正文包括 `revision`。调整和确认都要求当前版本号；外部 Agent 等待期间如已有新版本，旧结果会被拒绝。若本周已有已确认规划，新草稿在确认前不改变生效版本。

PI 使用和目标草稿 Agent 相同的本机认证及环境变量：`BUILDYOURSELF_PI_BIN`、`BUILDYOURSELF_AGENT_MODEL`。CLI 以无会话、无工具、无扩展、无 MCP、无上下文文件和无提示模板的非交互方式调用；必须关闭 stdin 以便 PI 读取到 EOF。真实模型测试通过以下命令显式开启，普通测试不会访问外部模型：

```sh
RUN_PI_AGENT_SMOKE=1 BUILDYOURSELF_AGENT_MODEL=magpie/auto/auto npm test -- tests/weekly-plans-live-smoke.test.ts
```
