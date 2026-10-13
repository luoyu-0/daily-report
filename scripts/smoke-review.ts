import {chromium} from 'playwright';
import {createApp} from '../src/server.js';

const app = await createApp(true);
const address = await app.listen({host: '127.0.0.1', port: 0});
const browser = await chromium.launch({headless: true});

try {
  const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
  const edition = await (await page.request.get(`${address}/api/editions/latest`)).json();
  edition.status = 'draft';
  await page.route('**/api/editions/latest', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(edition),
  }));
  await page.route('**/api/repo-locks', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({repos: [{date: '2026-10-11', repo: 'example/locked-tool'}]}),
  }));
  await page.goto(address, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /审核台/}).waitFor();
  await page.getByRole('button', {name: '已锁定仓库（1）'}).click();
  await page.getByRole('region', {name: '以往锁定仓库'}).getByRole('link', {name: 'example/locked-tool'}).waitFor();
  const cards = page.locator('.editor-card');
  const cardCount = await cards.count();
  const radarCount = await page.locator('.github-grid article').count();
  const previewText = await page.locator('.preview-panel').textContent();
  const videoText = await page.locator('.video-frame').textContent();
  if (cardCount < 1) throw new Error(`审核卡片不足：${cardCount}`);
  if (radarCount !== cardCount) throw new Error(`热榜 ${radarCount} 条与候选 ${cardCount} 条不一致`);
  if (!previewText?.includes('完整成片预览')) throw new Error('未找到 Remotion 预览区域');
  if (!videoText?.includes('GitHub 工具雷达')) throw new Error('Remotion 预览组件未渲染品牌片头');
  const pageText = await page.locator('body').textContent();
  if (pageText?.includes('README 快速开始') || pageText?.includes('注意事项（每行一项）')) throw new Error('审核台仍显示安装命令或注意事项编辑区');
  const firstCard = cards.first();
  if (await firstCard.getByRole('button', {name: '保存', exact: true}).count()) throw new Error('仍存在保存按钮');
  if (await firstCard.getByRole('button', {name: '更新入选'}).count()) throw new Error('仍存在更新入选按钮');
  const renderButton = page.getByRole('button', {name: '渲染成片'});
  await renderButton.click();
  const confirmation = page.getByRole('dialog', {name: '确认渲染成片'});
  const confirmButton = confirmation.getByRole('button', {name: /秒后可确认|确认并渲染/});
  if (!await confirmButton.isDisabled()) throw new Error('渲染确认弹窗未等待三秒');
  await page.waitForTimeout(3200);
  if (await confirmation.getByRole('button', {name: '确认并渲染'}).isDisabled()) throw new Error('三秒后仍不能确认渲染');
  await confirmation.getByRole('button', {name: '返回审核'}).click();
  let regenerateRequests = 0;
  await page.route('**/api/editions/*/candidates/*/regenerate', async (route) => {
    regenerateRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({error: '测试请求已拦截'})});
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('.editor-card button');
    button?.click();
    button?.click();
  });
  await page.getByRole('progressbar', {name: /优化进度/}).waitFor();
  await page.waitForTimeout(750);
  if (regenerateRequests !== 1) throw new Error(`同一工具重复触发 LLM 请求 ${regenerateRequests} 次`);
  const patches: Array<Record<string, unknown>> = [];
  await page.route('**/api/editions/*/candidates/*', async (route) => {
    const patch = route.request().postDataJSON() as Record<string, unknown>;
    patches.push(patch);
    const candidateId = route.request().url().split('/').at(-1);
    edition.candidates = edition.candidates.map((item: {id: string}) => item.id === candidateId ? {...item, ...patch} : item);
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(edition)});
  });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/candidates/')),
    firstCard.locator('.edit-pane input').fill('本地自动保存验证文案'),
  ]);
  if (patches.at(-1)?.oneLinePitchZh !== '本地自动保存验证文案') throw new Error('编辑文案后未自动保存');
  if (await firstCard.getByRole('button', {name: '取消入选'}).count()) {
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/candidates/')),
      firstCard.getByRole('button', {name: '取消入选'}).click(),
    ]);
  }
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes('/candidates/')),
    firstCard.getByRole('button', {name: '入选', exact: true}).click(),
  ]);
  await firstCard.getByRole('button', {name: '取消入选'}).waitFor();
  const selectedPatch = patches.at(-1);
  if (selectedPatch?.selected !== true || selectedPatch?.confirmed !== true) throw new Error('入选未同时保存并确认工具');
  if (await firstCard.getByRole('button', {name: '入选', exact: true}).count()) throw new Error('已入选卡片仍显示入选按钮');

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
  console.log(JSON.stringify({ok: true, cardCount, radarCount, preview: '品牌片头已渲染', duplicateLlmRequests: regenerateRequests, autosaved: true, delayedConfirmation: true, selectedPatch, staleApi: '已显示兼容错误'}, null, 2));
} finally {
  await browser.close();
  await app.close();
}
