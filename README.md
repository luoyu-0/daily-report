# GitHub 工具雷达

一套本地运行的 GitHub 工具发现工作流：读取全球 GitHub Trending Today，结合仓库元数据与 README 做规则识别，经人工精选和确认后，用 Remotion 生成 2～3 分钟的视频。项目不会自动安装、执行或克隆榜单中的仓库。

## 工作流

1. 读取 `https://github.com/trending?since=daily` 的全球 Today 榜前 15 名。
2. 通过 GitHub 官方 REST API 补充 Stars、语言、Topics、许可证及 README，并在本地缓存 12 小时。
3. 用规则判断项目是否更像可直接使用的工具，给出工具类型、实用性分数、风险提示和中文模板文案。
4. 在本地审核台从候选中选择 3～5 个，编辑推荐语、使用场景、适合人群和注意事项，并逐条确认。
5. 人工批准并锁定后，才允许渲染 MP4。

旧版“AI 智讯日报”数据会继续保留在数据库中，但不会进入新的工具雷达审核和渲染流程。

## 快速开始

1. 复制 `.env.example` 为 `.env.local`。LLM 和 GitHub Token 都是可选配置。

   - `GITHUB_TOKEN`：提高 GitHub REST API 限额；不填时使用匿名限额和本地缓存。
   - `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`：仅用于人工触发的中文提炼。
   - `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`：只作用于本项目的 Node.js 命令，无需在终端手动启用代理。

2. 检查运行环境：

   ```powershell
   npm run doctor
   ```

3. 采集北京时间当天榜单并打开审核台：

   ```powershell
   npm run daily

   # 只采集，不启动审核台
   npm run daily -- --no-review
   ```

   `daily` 不调用 LLM，完成后会退出并归还终端。`--date YYYY-MM-DD` 主要用于可重复测试；GitHub 官方 Trending 只提供实时 Today 榜，指定日期不是当前北京时间时会失败，不会自动沿用历史榜单。

4. 单独启动审核台：

   ```powershell
   npm run review
   ```

   审核台地址为 `http://127.0.0.1:5173`。页面展示完整候选榜单，并允许筛选、选择、编辑、确认和预览视频时间轴。

5. 审核台中可以对单个工具或已入选工具调用 LLM。每次调用前会显示确认提示；批量处理最多 5 个工具，每个工具最多发送 `LLM_EVIDENCE_MAX_CHARS` 个证据字符。模型失败或生成无证据内容时，自动保留规则版。

6. 批准后在审核台点击“渲染 MP4”，或运行：

   ```powershell
   npm run render -- --edition <edition-id>
   ```

成片保存到 `output/`，并附带编码检查 JSON。

## 数据来源与失败策略

- 主来源：GitHub 官方 Trending 全球 Today 页面。
- 备用来源：`mshibanami/GitHubTrendingRSS`，仅在它明确标注为北京时间目标日期时使用。
- 仓库详情：GitHub 官方 REST API 的 Repository 与 README 接口。
- 官方页面和备用源均不可用、日期不符或不足 5 条时，本次采集直接失败；控制台与审核台会显示原因。
- 仓库详情请求失败时仍保留榜单项，并显示风险提示，不会虚构缺失信息。

## 审核与安全约束

- 每期必须选择并确认 3～5 个工具，且填写推荐语、使用场景和适合人群。
- LLM 只能引用当前仓库的 `E1` 证据；新数字或 README 中不存在的命令会触发规则回退。
- 工具推荐仅依据公开仓库资料，不代表项目已经被本机实际运行或安全审计。
- 未经人工批准不能渲染最终视频。
- `.env.local`、数据库、GitHub 缓存、日志和成片默认不进入 Git。

## 背景音乐与 TTS

- 把已授权音乐放到 `public/assets/audio/bgm.mp3`，不存在时静音导出。
- 当前不生成 TTS；数据结构保留 `narrationAudio` 和 `audioDurationMs`，便于后续接入本地 TTS。

## 自动调度与开发检查

`scripts/run-daily.ps1` 可由 Windows Task Scheduler 调用，本项目不会自动创建系统计划任务。

```powershell
npm test
npm run build
```
