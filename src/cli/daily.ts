import {buildCandidates} from '../pipeline/run.js';
import {currentChinaDate} from '../shared/date.js';

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const date = arg('--date') ?? currentChinaDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date 必须为 YYYY-MM-DD');

console.log(`正在创建 ${date} 的资讯候选…`);
try {
  const result = await buildCandidates(date);
  console.log(`已创建 ${result.edition.id}，候选 ${result.edition.candidates.length} 条。`);
  if (result.warnings.length) console.warn(`警告：\n- ${result.warnings.join('\n- ')}`);
  if (process.argv.includes('--no-review')) {
    console.log('采集完成；已按 --no-review 跳过审核台启动。');
  } else {
    console.log('采集完成，正在启动本地审核台…');
    await import('./review.js');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`日报创建失败：${message}`);
  process.exitCode = 1;
  if (!process.argv.includes('--no-review')) {
    process.env.REVIEW_STARTUP_ERROR = message;
    console.log('正在打开审核台显示失败原因…');
    await import('./review.js');
  }
}

