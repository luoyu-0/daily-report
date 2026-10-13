# GitHub 工具雷达

一套本地运行的 GitHub 工具发现工作流：读取全球 GitHub Trending Today，结合仓库元数据与 README 做规则识别，经人工审核和二次确认后，用 Remotion 生成视频。项目不会自动安装、执行或克隆榜单中的仓库。

## 工作流

1. 读取 `https://github.com/trending?since=daily` 的全球 Today 榜，跳过往期已入选且成功渲染成片的仓库。若官方全球榜不足 15 个可选仓库，再从 GitHub 同日语言分榜补足；审核台会标明补充项来源，不把它们冒充为全球榜原始名次。未入选或未成片的历史仓库不跳过。若同日各榜合计仍不足 15 个，则如实提示，不使用旧榜单。
2. 对同日已采集的仓库复用项目本地资料及审核文案；仅对新仓库通过 GitHub 官方 REST API 补充 Stars、语言占比、Topics、许可证及 README。
3. 用规则判断项目是否更像可直接使用的工具，给出工具类型、实用性分数、风险提示和中文模板文案。
4. 新日报默认入选榜单前 10 个候选；在本地审核台可调整入选项，编辑推荐语、使用场景和适合人群，修改会自动保存。
5. 点击“渲染成片”后须在弹窗中等待 3 秒并再次确认，才会批准并启动 MP4 渲染；成功成片时自动锁定当期入选仓库。审核台的“已锁定仓库”入口可查看往期记录；当天记录可逐条重置，再重新选择。项目不负责上传，也不会把取消确认或渲染失败当作已成片。

旧版“AI 智讯日报”数据会继续保留在数据库中，但不会进入新的工具雷达审核和渲染流程。

## 快速开始

1. 复制 `.env.example` 为 `.env.local`。LLM 和 GitHub Token 都是可选配置。

   - `GITHUB_TOKEN`：使用自己的 GitHub 个人访问令牌（PAT）访问公开仓库 API，避免共享 IP 的匿名速率限额；不填时使用匿名限额和本地缓存。
   - `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`：仅用于人工触发的中文提炼。
   - `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`：只作用于本项目的 Node.js 命令，无需在终端手动启用代理。

### GitHub 账户配置与隐私

1. 在 GitHub 的[个人访问令牌设置页](https://github.com/settings/personal-access-tokens/new)创建 **fine-grained personal access token**，设置到期时间，仓库权限仅授予公开仓库读取所需的最小范围；读取 README 所需权限为 **Contents: Read-only**。不要授予写入权限，也不要在项目中填写 GitHub 密码。
2. 在本机的 `.env.local` 填入 `GITHUB_TOKEN=你的令牌`，不要把令牌粘贴到聊天、截图或提交记录里。运行 `npm run doctor`，看到“GitHub API 身份验证：令牌已生效”及剩余额度后，再运行 `npm run daily`。修改令牌后，已运行的审核服务需重启才会读取新配置。

令牌只由本地 Node.js 进程读取，并通过 HTTPS 作为请求头发送给 **GitHub 官方 `api.github.com`**，用于仓库元数据与 README 请求；不会作为日报内容、LLM 提示词、浏览器响应或日志保存/发送。`.env.local` 已被 Git 忽略。这里的“不会上传隐私信息”不包括认证所必需的令牌发送给 GitHub 本身；设备上的其他程序、备份或误分享文件仍可能造成泄露，请妥善保管并定期轮换令牌。[GitHub 速率限制说明](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[令牌权限说明](https://docs.github.com/en/rest/repos/contents)。

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

   `daily` 不调用 LLM，完成后会退出并归还终端。同日重跑会保留已优化文案，但新日报会重新默认入选前 10 项；已存在的日报和人工修改不会被覆盖。若历史过滤后没有可选仓库，会提示无法渲染。`--date YYYY-MM-DD` 主要用于可重复测试；GitHub 官方 Trending 只提供实时 Today 榜，指定日期不是当前北京时间时会失败，不会自动沿用历史榜单。

4. 单独启动审核台：

   ```powershell
   npm run review
   ```

   审核台地址为 `http://127.0.0.1:5173`。页面展示过滤后的今日新仓库候选，并允许筛选、入选或取消入选、自动保存编辑和预览视频时间轴。

5. 审核台可对单个候选调用 LLM，也可通过“LLM一键优化”处理所有尚未优化的候选（包含未入选项）；调用前会显示数量和预计证据字符数并要求确认。系统从 README 中优先抽取 Overview、Features、Use cases 等核心章节，并跳过 Installation、Quick Start 等安装内容，每个工具最多发送 `LLM_EVIDENCE_MAX_CHARS` 个证据字符。模型失败或生成无证据内容时，自动保留规则版。

6. 在审核台点击“渲染成片”，等待弹窗倒计时后再次确认。已获批准的日报也可用命令重新渲染：

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

## 本地存储、缓存与重复调用

- 所有数据库、缓存与服务日志默认保存在项目根目录的 `data/`；`DATA_DIR` 只能指向该目录或其子目录，不会写到用户目录等项目外位置。
- `data/github-profile-cache.json` 缓存新仓库的元数据和 README，默认有效期 12 小时，可用 `GITHUB_CACHE_HOURS` 调整。
- `data/daily-report.db` 保存每日候选、人工编辑、确认状态、审核版本、任务日志和 LLM 优化结果；`data/logs/` 保存服务日志。
- 以前日期收录过的仓库不再进入今日候选，也不重新请求详情。同日仓库直接复用数据库中已保存的文案、证据与 LLM 优化结果，不再次请求详情；新的日报版本会重置确认状态。
- 同一日报中，已经标记为 `llm` 的候选不会再次参与“LLM一键优化”。
- LLM 结果也存于 SQLite 缓存。缓存键包含仓库、仓库内容证据、模型和提示词版本；证据、模型或提炼规则变化后会重新调用，不会错误沿用旧概述。
- API key 不写入上述缓存、数据库正文或日志。

## 审核与安全约束

- 每期须入选 1～10 个工具，且填写推荐语、使用场景和适合人群；视频先总览热榜，再逐个介绍入选工具，不重复展示末尾汇总页。
- LLM 只能引用当前仓库的 `E1` 证据；新数字或 README 中不存在的命令会触发规则回退。
- 工具推荐仅依据公开仓库资料，不代表项目已经被本机实际运行或安全审计。
- 未经审核台二次确认或已有批准状态，不能渲染最终视频。
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
