# Issue tracker: GitHub

Issues and specs for this repository live in GitHub Issues:
https://github.com/LCJD99/BuildYourself

Use the `gh` CLI for all operations.

## Language

所有 issue 的标题和正文必须使用中文。创建或编辑 issue 时，使用中文描述背景、目标、实施要求和验收标准；必要的代码、命令、专有名称和技术术语可以保留原文。Issue 评论也应使用中文。

## Operations

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --json number,title,body,labels,comments`
- List: `gh issue list --state open`
- Comment: `gh issue comment <number> --body "..."`
- Add or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: post a Chinese explanation, then run `gh issue close <number>`.
- Use GitHub sub-issues and native issue dependencies when available. Otherwise, record the parent and blockers in the issue body.

Before creating an issue, verify the target with `gh repo view --json nameWithOwner`. File issues only in the user's own repo.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill instructions

When a skill says "publish to the issue tracker", create a GitHub issue. When it says "fetch the relevant ticket", read the GitHub issue.
