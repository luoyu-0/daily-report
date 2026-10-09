import {buildCandidates} from '../pipeline/run.js';
import {currentChinaDate} from '../shared/date.js';

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const date = arg('--date') ?? currentChinaDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date 必须为 YYYY-MM-DD');

console.log(`正在创建 ${date} 的资讯候选…`);
const result = await buildCandidates(date);
console.log(`已创建 ${result.edition.id}，候选 ${result.edition.candidates.length} 条。`);
if (result.warnings.length) console.warn(`警告：\n- ${result.warnings.join('\n- ')}`);
if (process.argv.includes('--no-review')) {
  console.log('采集完成；已按 --no-review 跳过审核台启动。');
} else {
  console.log('采集完成，正在启动本地审核台…');
  await import('./review.js');
}

