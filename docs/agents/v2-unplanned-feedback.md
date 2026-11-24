# v2 计划外反馈接口

`POST /api/v2/unplanned-feedback` 接收 `{ message, performedOn, idempotencyKey }`。`performedOn` 是用户报告的实际发生日期，格式为 `YYYY-MM-DD`。服务端调用 PI Agent 评估内容及对已启用目标属性的收益。

有属性贡献时，反馈以 `kind: "action"` 保存为计划外行动，保留原始反馈、评估、目标/属性关联和贡献；它会按 `performedOn` 出现在月历及日详情中，来源为 `unplanned`。没有属性贡献时以 `kind: "misc"` 保存为杂项，不改变属性进度，可通过 `GET /api/v2/unplanned-feedback` 回读。

两类结果均可通过 `GET /api/v2/action-feedback/{feedbackId}` 回读原始反馈和评估。相同幂等键与请求内容重试会返回已保存结果；同一幂等键用于不同内容会返回冲突。

属性贡献沿用计划内行动接口的暂定累计计算规则，贡献公式仍是待讨论事项，不代表最终产品规则。
