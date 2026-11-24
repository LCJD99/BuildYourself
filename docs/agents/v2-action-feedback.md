# v0.2 计划内行动反馈 Agent 与接口

计划内反馈只接受当前至少出现在一份已确认每周规划中的行动。`POST /api/v2/action-feedback` 接受 `actionId`、自然语言 `message`、唯一 `idempotencyKey` 和可选 `performedOn`。反馈会调用 PI Agent，返回持久化的完成度、置信度、简短回复和本次新增的属性贡献。`GET /api/v2/action-feedback/{id}`、`GET /api/v2/actions/{id}` 和 `GET /api/v2/goals/{id}/attributes/{attributeId}/contributions` 可重新读取结果及其追溯关系。

服务端只接受行动当前关联的已启用目标属性。重复提交相同重试标识和内容会复用已保存结果；相同标识配不同内容返回 `409`。事务会在写入前再次检查幂等标识、行动版本和属性关联，防止并发重试重复增加属性进度。行动已不在生效规划中时，提交被拒绝。

Agent 返回 `completion`、`confidence`、简短 `reply` 和属性累计贡献基数。当前实现暂按 0–1 的比率处理完成度、置信度和属性贡献基数，并以三者乘积作为该行动对该属性的累计目标值；服务端只入账超过该行动该属性既有累计值的增量。该可解释规则用于兑现部分完成和跨周不重复入账的业务边界，不表示 v0.2 已最终确定量表、权重或贡献公式。没有新增贡献时仍保存本次反馈和评估；贡献表保存行动、目标、属性、反馈、评估和实际增量之间的关系，目标属性进度是这些增量的累计值。

行动评估使用已配置的 PI CLI：`BUILDYOURSELF_PI_BIN` 和可选 `BUILDYOURSELF_AGENT_MODEL`。测试中的可控 Agent 只验证 HTTP 持久化边界，不代表真实模型效果。真实 PI 接口烟测通过设置 `RUN_PI_AGENT_SMOKE=1` 显式运行，常规测试默认跳过。
