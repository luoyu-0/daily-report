import {chromium} from 'playwright';
import {createApp} from '../src/server.js';

const app = await createApp(true);
const address = await app.listen({host: '127.0.0.1', port: 0});
const browser = await chromium.launch({headless: true});

try {
  const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
  await page.goto(address, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /审核台/}).waitFor();
  const cards = page.locator('.editor-card');
  const cardCount = await cards.count();
  const radarCount = await page.locator('.github-grid article').count();
  const previewText = await page.locator('.preview-panel').textContent();
  const videoText = await page.locator('.video-frame').textContent();
  if (cardCount < 5) throw new Error(`审核卡片不足：${cardCount}`);
  if (radarCount !== cardCount) throw new Error(`热榜 ${radarCount} 条与候选 ${cardCount} 条不一致`);
  if (!previewText?.includes('完整成片预览')) throw new Error('未找到 Remotion 预览区域');
  if (!videoText?.includes('GitHub 工具雷达')) throw new Error('Remotion 预览组件未渲染品牌片头');
  console.log(JSON.stringify({ok: true, cardCount, radarCount, preview: '品牌片头已渲染'}, null, 2));
} finally {
  await browser.close();
  await app.close();
}
