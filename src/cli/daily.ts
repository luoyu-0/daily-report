import {buildCandidates, type DailyProgress} from '../pipeline/run.js';
import {currentChinaDate} from '../shared/date.js';
import {launchReviewInBackground} from '../shared/review-launcher.js';

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const date = arg('--date') ?? currentChinaDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date 必须为 YYYY-MM-DD');

console.log(`正在读取 ${date} 的全球 GitHub Trending Today…`);
let previousPhase = '';
const showProgress = ({phase, completed, total}: DailyProgress) => {
  const label = phase === 'trending' ? '获取今日榜单' : phase === 'profiles' ? '获取仓库详情' : '整理候选';
  const filled = Math.round(completed / total * 20);
  const line = `${label} [${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${completed}/${total}`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\r\x1b[2K${line}`);
    if (completed === total) process.stdout.write('\n');
  } else if (completed === 0 || completed === total || phase !== previousPhase) {
    console.log(line);
  }
  previousPhase = phase;
};
let collectionError = '';
try {
  const result = await buildCandidates(date, undefined, showProgress);
  console.log(`已创建 ${result.edition.id}，工具候选 ${result.edition.candidates.length} 条。`);
  console.log('本次仅执行规则识别，尚未调用 LLM；可在审核台选定 3～5 个工具后按需优化。');
  if (result.warnings.length) console.warn(`警告：\n- ${result.warnings.join('\n- ')}`);
  if (process.argv.includes('--no-review')) {
    console.log('采集完成；已按 --no-review 跳过审核台启动。');
  } else {
    console.log('采集完成，正在后台启动本地审核台…');
    try {
      const review = await launchReviewInBackground();
      console.log(`审核台已${review.started ? '启动' : '在运行'}：${review.url}`);
      console.log('daily 命令已结束，可以继续使用当前终端。');
    } catch (error) {
      console.error(`候选已保存，但审核台启动失败：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
} catch (error) {
  if (process.stdout.isTTY) process.stdout.write('\n');
  collectionError = error instanceof Error ? error.message : String(error);
  console.error(`工具雷达创建失败：${collectionError}`);
  process.exitCode = 1;
  if (!process.argv.includes('--no-review')) {
    console.log('正在打开审核台显示失败原因…');
    try {
      const review = await launchReviewInBackground(collectionError);
      console.log(`审核台已${review.started ? '启动' : '在运行'}：${review.url}`);
    } catch (launchError) {
      console.error(`审核台启动失败：${launchError instanceof Error ? launchError.message : String(launchError)}`);
    }
  }
}

