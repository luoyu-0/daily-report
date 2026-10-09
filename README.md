# AI 智讯日报

一套在本地运行的 AI 资讯工作流：自动采集、规则去重与评分、OpenAI-compatible LLM 增强、人工审核、Remotion 成片渲染。

## 快速开始

1. 复制 `.env.example` 为 `.env.local`，填写 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL`。未配置时会自动使用可追溯的规则摘要。
2. 运行环境检查：

   ```powershell
   npm run doctor
   ```

3. 采集当天候选：

   ```powershell
   npm run daily -- --date 2026-10-09
   ```

4. 启动本地审核台：

   ```powershell
   npm run review
   ```

   打开 `http://127.0.0.1:5173`，选择 5～6 条新闻，逐条核对来源并点击“保存并确认”，然后批准日报。

5. 在审核台点击“渲染 MP4”，或运行：

   ```powershell
   npm run render -- --edition <edition-id>
   ```

成片会保存到 `output/`，并附带一份编码验证 JSON。

## 背景音乐与 TTS

- 把已授权的音乐保存为 `public/assets/audio/bgm.mp3`。
- 不存在该文件时，系统会显示警告并静音导出。
- MVP 不生成 TTS，但数据结构已预留 `narrationAudio` 和 `audioDurationMs`。

## 自动调度

`scripts/run-daily.ps1` 可供 Windows Task Scheduler 调用。本项目不会自动创建系统任务；建议将脚本设为每日北京时间 07:30 执行。

## 质量与安全约束

- LLM 只接收已保存的证据，必须返回证据编号。
- 生成的数字和英文实体若无法从证据中验证，整条摘要回退为规则版。
- 未经人工逐条确认和批准，日报不能进入渲染。
- `.env.local` 、数据库和成片默认不进入 Git。

## 开发检查

```powershell
npm test
npm run build
```

