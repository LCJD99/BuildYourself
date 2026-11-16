# BuildYourself 领域词汇表 (Domain Glossary)

BuildYourself 帮助用户管理长期目标，通过行动、属性进度和周期复盘追踪成长。

## 目标与规划 (Goals & Planning)

**长期目标 (Long-term Goal)**:
用户期望长期实现的目标，具有明确约束和用于评价成长的属性。
_Avoid_: 愿望 (Wish), 琐事 (Chore)

**目标属性 (Goal Attribute)**:
长期目标的一个评估维度，具有由相关行动贡献的进度。一个属性可以关联多项行动，一项行动也可以贡献多个属性。

**目标草稿 (Goal Draft)**:
由系统协助梳理、尚未通过完整性检查或用户尚未正式确认开启的目标雏形。
_Avoid_: 临时目标 (Temporary Goal), 半成品目标 (Incomplete Goal)

**摸底行动 (Baseline Action)**:
在起点水平未知时，为了测出当前真实水平而特意安排的第一次测试或摸底练习。
_Avoid_: 基线行动 (Baseline Action), 预备任务 (Prep Task), 测验 (Quiz)

## 任务与执行 (Tasks & Execution)

**行动 (Action)**:
用户为推进一个或多个长期目标而做的具体事情，包括计划内行动和计划外行动。同一行动可以关联多个长期目标。
_Avoid_: 任务 (Task), 事项 (Item)

**计划内行动 (Planned Action)**:
由 Agent 在每周规划中提出的行动。

**计划外行动 (Unplanned Action)**:
用户在周规划之外完成并告知 Agent 的事情；经评估对目标属性有收益时产生属性贡献，否则归入杂项。

**杂项 (Miscellaneous)**:
用户告知 Agent 的计划外事情中，经评估对目标属性没有收益的记录。

## 时间与安排 (Time & Scheduling)

**每周规划 (Weekly Plan)**:
针对一周提出的行动安排。本周未完成的行动本身延续到下周，与下周其他行动同等对待。

**每日安排 (Daily Plan)**:
某一天需要完成的行动集合，可以来自多个长期目标，不指定具体执行时刻。
_Avoid_: 日程表 (Calendar)

## 记录与评价 (Records & Evaluation)

**原始反馈 (Raw Feedback)**:
用户向 Agent 描述自己完成情况或额外所做事情的自然语言内容。

**行动评估 (Action Assessment)**:
Agent 对行动的完成度和置信度作出的评估，两者共同影响该行动对相关目标属性的贡献。置信度表示 Agent 对评估结果的把握程度，与用户描述或材料的明确程度有关。

**属性贡献 (Attribute Contribution)**:
一项行动经评估对某个目标属性进度产生的贡献。

## 关联与复盘 (Relations & Reviews)

**目标关联 (Goal Relation)**:
两个目标或行动之间的相互影响关系（如先后依赖、时间冲突、体能冲突、一举两得的协同行动）。
_Avoid_: 目标关系 (Goal Relation), 链接 (Link), 标签 (Tag)

**建议关联 (Candidate Relation)**:
由系统分析推荐、带有依据但必须等你确认后才生效的目标间关联。
_Avoid_: 候选关系 (Candidate Relation), 预测关联 (Predicted Relation)

**周复盘 (Weekly Review)**:
总结本周工作、收集用户对本周及下周规划的意见，并形成待确认下周规划的过程。

**个人执行图谱 (Personal Execution Graph)**:
记录长期目标、行动、属性进度、安排与复盘的领域信息集合。
_Avoid_: 个人执行知识图谱 (Knowledge Graph), 数据库 (Database), 状态树 (State Tree)
