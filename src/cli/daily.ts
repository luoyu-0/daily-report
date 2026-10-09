import {buildCandidates} from '../pipeline/run.js';

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const chinaDate = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
const date = arg('--date') ?? chinaDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date 必须为 YYYY-MM-DD');

console.log(`正在创建 ${date} 的资讯候选…`);
const result = await buildCandidates(date);
console.log(`已创建 ${result.edition.id}，候选 ${result.edition.candidates.length} 条。`);
if (result.warnings.length) console.warn(`警告：\n- ${result.warnings.join('\n- ')}`);
console.log('运行 npm run review 进入本地审核台。');

