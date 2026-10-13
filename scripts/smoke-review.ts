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
  let lockedRepos = [{date: '2026-10-11', repo: 'example/locked-tool'}];
  await page.route('**/api/repo-locks', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({repos: lockedRepos}),
  }));
  await page.route('**/api/repo-locks/delete', (route) => {
    const body = route.request().postDataJSON() as {date: string; repo: string};
    if (body.date !== '2026-10-11' || body.repo !== 'example/locked-tool') throw new Error('删除锁定记录请求缺少历史日期或仓库');
    lockedRepos = [];
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({repos: []})});
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(address, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /审核台/}).waitFor();
  const radarCount = await page.locator('.github-grid article').count();
  if (radarCount !== edition.candidates.length) throw new Error('概览页未展示完整的今日可选仓库');
  await page.getByRole('button', {name: '预览成片'}).click();
  await page.locator('.preview-panel').waitFor();
  await page.getByRole('navigation', {name: '审核台导航'}).getByRole('button', {name: /锁定记录/}).click();
  await page.locator('.locked-repos').getByRole('link', {name: 'example/locked-tool'}).waitFor();
  await page.locator('.locked-repos').getByRole('button', {name: '删除锁定记录'}).click();
  await page.locator('.locked-repos').getByText('暂无锁定记录').waitFor();
  await page.getByRole('navigation', {name: '审核台导航'}).getByRole('button', {name: '仓库候选'}).click();
  const cards = page.locator('.editor-card');
  const cardCount = await cards.count();
  if (cardCount < 1) throw new Error(`审核卡片不足：${cardCount}`);
  if (await page.locator('.github-panel').count()) throw new Error('仓库候选页仍显示今日可选仓库卡片');
  if (radarCount !== cardCount) throw new Error(`概览热榜 ${radarCount} 条与审核候选 ${cardCount} 条不一致`);
  const navigator = page.getByLabel('候选仓库快捷导航');
  await page.setViewportSize({width: 1600, height: 720});
  await navigator.getByRole('button', {name: '展开仓库导航'}).click();
  if (await navigator.getByRole('button', {name: '收起仓库导航'}).getAttribute('aria-expanded') !== 'true') throw new Error('仓库导航未展开');
  if (await navigator.locator('.candidate-nav-list button').count() !== cardCount) throw new Error('快捷导航未列出全部候选仓库');
  const listFits = await navigator.locator('.candidate-nav-list').evaluate((list) => {
    const bounds = list.getBoundingClientRect();
    return list.scrollHeight <= list.clientHeight && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
  });
  if (!listFits) throw new Error('15 条候选未能在导航栏中一次展示完');
  const lastCardId = await cards.last().getAttribute('id');
  await navigator.locator('.candidate-nav-list button').last().click();
  if (await page.evaluate(() => document.activeElement?.id) !== lastCardId) throw new Error('快捷导航未定位到对应仓库卡片');
  if (await navigator.getByRole('button', {name: '展开仓库导航'}).getAttribute('aria-expanded') !== 'false') throw new Error('跳转后仓库导航未收起');
  await navigator.getByRole('button', {name: '展开仓库导航'}).click();
  await page.locator('.industry-title').click();
  if (await navigator.getByRole('button', {name: '展开仓库导航'}).getAttribute('aria-expanded') !== 'false') throw new Error('点击导航栏外部后未收起');
  await page.setViewportSize({width: 1600, height: 1000});
  await page.getByRole('navigation', {name: '审核台导航'}).getByRole('button', {name: '成片渲染'}).click();
  const previewText = await page.locator('.preview-panel').textContent();
  const videoText = await page.locator('.video-frame').textContent();
  if (!previewText?.includes('完整成片预览')) throw new Error('未找到 Remotion 预览区域');
  if (!videoText?.includes('GitHub 工具雷达')) throw new Error('Remotion 预览组件未渲染品牌片头');
  const pageText = await page.locator('body').textContent();
  if (pageText?.includes('README 快速开始') || pageText?.includes('注意事项（每行一项）')) throw new Error('审核台仍显示安装命令或注意事项编辑区');
  const renderButton = page.getByRole('button', {name: '渲染成片'});
  await renderButton.click();
  const confirmation = page.getByRole('dialog', {name: '确认渲染成片'});
  const confirmButton = confirmation.getByRole('button', {name: /秒后可确认|确认并渲染/});
  if (!await confirmButton.isDisabled()) throw new Error('渲染确认弹窗未等待三秒');
  await page.waitForTimeout(3200);
  if (await confirmation.getByRole('button', {name: '确认并渲染'}).isDisabled()) throw new Error('三秒后仍不能确认渲染');
  await confirmation.getByRole('button', {name: '返回审核'}).click();
  await page.getByRole('navigation', {name: '审核台导航'}).getByRole('button', {name: '仓库候选'}).click();
  const firstCard = cards.first();
  if (await firstCard.getByRole('button', {name: '保存', exact: true}).count()) throw new Error('仍存在保存按钮');
  if (await firstCard.getByRole('button', {name: '更新入选'}).count()) throw new Error('仍存在更新入选按钮');
  if (await firstCard.getByRole('button', {name: '取消入选'}).count() && !await firstCard.getByRole('button', {name: '取消入选'}).evaluate((button) => getComputedStyle(button).color === 'rgb(185, 28, 28)')) throw new Error('取消入选按钮未使用红色警示样式');
  let regenerateRequests = 0;
  await page.route('**/api/editions/*/candidates/*/regenerate', async (route) => {
    regenerateRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({status: 500, contentType: 'application/json', body: JSON.stringify({error: '测试请求已拦截'})});
  });
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
  const staleServicePage = await browser.newPage({viewport: {width: 1200, height: 800}});
  await staleServicePage.route('**/api/health', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ok: true, app: 'github-tool-radar', apiVersion: 3}),
  }));
  await staleServicePage.goto(address, {waitUntil: 'networkidle'});
  await staleServicePage.getByText(/审核服务版本过旧/).waitFor({timeout: 2_000});
  console.log(JSON.stringify({ok: true, cardCount, radarCount, preview: '品牌片头已渲染', duplicateLlmRequests: regenerateRequests, autosaved: true, delayedConfirmation: true, selectedPatch, staleApi: '已显示兼容错误', staleService: '已提示重启'}, null, 2));
} finally {
  await browser.close();
  await app.close();
}
