import {getLatestEdition} from '../db.js';
import {renderEdition} from '../render.js';

const index = process.argv.indexOf('--edition');
const editionId = index >= 0 ? process.argv[index + 1] : getLatestEdition()?.id;
if (!editionId) throw new Error('请使用 --edition <id> 指定日报');
console.log(`正在渲染 ${editionId}…`);
console.log(`已输出：${await renderEdition(editionId)}`);

