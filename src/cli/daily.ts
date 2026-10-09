import {buildCandidates} from '../pipeline/run.js';
import {currentChinaDate} from '../shared/date.js';
import {launchReviewInBackground} from '../shared/review-launcher.js';

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const date = arg('--date') ?? currentChinaDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date 必须为 YYYY-MM-DD');

console.log(`正在创建 ${date} 的资讯候选…`);
const startedAt = Date.now();
let progress = {completed: 0, total: 0};
const heartbeat = setInterval(() => {
  if (!progress.total) return;
  console.log(`[进度] 已完成 ${progress.completed}/${progress.total} 条，耗时 ${Math.round((Date.now() - startedAt) / 1000)} 秒…`);
}, 15_000);
try {
  const result = await buildCandidates(date, undefined, (next) => {
    progress = next;
    if (next.completed === 0) {
      console.log(`已完成采集，开始并发提炼 ${next.total} 条候选…`);
    } else {
      console.log(`[${next.completed}/${next.total}] ${next.method === 'llm' ? 'LLM' : '规则回退'}：${next.title}`);
    }
  });
  console.log(`已创建 ${result.edition.id}，候选 ${result.edition.candidates.length} 条。`);
  if (result.warnings.length) console.warn(`警告：\n- ${result.warnings.join('\n- ')}`);
  if (process.argv.includes('--no-review')) {
    console.log('采集完成；已按 --no-review 跳过审核台启动。');
  } else {
    console.log('采集完成，正在后台启动本地审核台…');
    const review = await launchReviewInBackground();
    console.log(`审核台已${review.started ? '启动' : '在运行'}：${review.url}`);
    console.log('daily 命令已结束，可以继续使用当前终端。');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`日报创建失败：${message}`);
  process.exitCode = 1;
  if (!process.argv.includes('--no-review')) {
    console.log('正在打开审核台显示失败原因…');
    const review = await launchReviewInBackground(message);
    console.log(`审核台已${review.started ? '启动' : '在运行'}：${review.url}`);
  }
} finally {
  clearInterval(heartbeat);
}

