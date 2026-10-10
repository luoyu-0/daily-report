# 问题跟踪器：本地 Markdown

本仓库的问题与规格以 Markdown 文件形式保存在 `.scratch/` 中。

## 约定

- 每个功能使用独立目录：`.scratch/<feature-slug>/`
- 功能规格保存为 `.scratch/<feature-slug>/spec.md`
- 每张实施工单保存为独立文件：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- 工单从 `01` 开始编号，不使用单个合并工单文件
- 在工单顶部附近使用 `Status:` 记录 triage 状态
- 评论和讨论历史追加到文件底部的 `## Comments` 章节

## 发布到问题跟踪器

当技能要求“发布到问题跟踪器”时，在 `.scratch/<feature-slug>/` 下创建相应文件和目录。

## 获取相关工单

读取用户提供的工单路径或编号所对应的文件。

## Wayfinding 操作

用于 `wayfinder` 技能。每项工作使用一个 map 文件，并为每张工单建立一个子文件。

- Map：`.scratch/<effort>/map.md`
- 子工单：`.scratch/<effort>/issues/NN-<slug>.md`
- `Type:` 可为 `research`、`prototype`、`grilling` 或 `task`
- `Status:` 可为 `claimed` 或 `resolved`
- `Blocked by: NN, NN` 记录依赖工单
- 未被领取、未受阻且未完成的最小编号工单构成当前 frontier
- 开始处理前，将状态更新为 `claimed` 并保存
- 完成后，在 `## Answer` 下追加结论，将状态更新为 `resolved`，再把结论摘要和链接写入 `map.md`
