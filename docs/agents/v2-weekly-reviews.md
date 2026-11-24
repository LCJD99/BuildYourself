# v2 周复盘接口

周复盘只针对已确认的每周规划。`POST /api/v2/weekly-reviews` 接收星期一日期、`weekFeedback` 与 `nextWeekFeedback`，分别保存原始意见，并由 PI Agent 总结本周、提出下周行动草稿。系统从本周已确认的规划与行动反馈读取上下文；完成度为 `null` 或小于 1 的行动会沿用原行动 ID 安排到下周。

草稿写入 `v2_weekly_plans` 的版本表，保持其与首周规划、月历和每日安排使用同一权威数据。`GET /api/v2/weekly-reviews/{weekStart}` 可在新请求中读取总结、两类意见和下周规划的草稿/生效版本。`POST /messages` 使用当前 revision 做自然语言调整，`POST /confirm` 必须指定当前 revision；并发规划修改时保存返回 409，不覆盖更新版本。确认下周规划前，本周的已确认版本仍可回看。

跨周贡献使用行动反馈 API 的累计贡献记录，延续行动继续反馈时只计入超出已记录累计值的部分。计算口径仍为规格中的暂定方案，不在此固化新的贡献公式。
