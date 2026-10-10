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

  const compatibilityPage = await browser.newPage({viewport: {width: 1200, height: 800}});
  await compatibilityPage.route('**/api/editions/latest', (route) => route.fulfill({
    status: 404, contentType: 'application/json', body: JSON.stringify({error: '暂无工具雷达日报'}),
  }));
  await compatibilityPage.route('**/api/editions', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({edition: {
      id: 'legacy', kind: 'ai-news', date: '2026-10-10', version: 1, status: 'draft', candidates: [],
      brand: {name: 'AI 智讯日报', tagline: '旧版', background: '#fff', primary: '#00f', ink: '#000', paleBlue: '#eef', accent: '#0ff'},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }}),
  }));
  await compatibilityPage.goto(address, {waitUntil: 'networkidle'});
  await compatibilityPage.getByRole('button', {name: '创建今日工具雷达'}).click();
  await compatibilityPage.getByText(/审核服务版本不兼容/).waitFor({timeout: 2_000});
  console.log(JSON.stringify({ok: true, cardCount, radarCount, preview: '品牌片头已渲染', staleApi: '已显示兼容错误'}, null, 2));
} finally {
  await browser.close();
  await app.close();
}
