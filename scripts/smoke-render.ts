import {createEdition, newId, updateEditionStatus, upsertCandidate} from '../src/db.js';
import {renderEdition} from '../src/render.js';
import type {CandidateStory} from '../src/shared/types.js';

const edition = createEdition('2026-10-09');
const story: CandidateStory = {
  id: newId('story'), editionId: edition.id,
  titleOriginal: 'OpenAI-compatible local workflow smoke test',
  titleZh: '本地 AI 日报完成端到端渲染测试',
  summaryZh: '该条目是本地渲染冒烟测试的固定数据。它用于验证白蓝品牌视觉、中文排版、页面转场、H.264 编码和 FFprobe 成片校验，不会进入正式日报。',
  category: '研究与开源', score: 88, selected: true, confirmed: true, position: 0,
  sources: [{
    id: 'smoke-source', sourceName: '本地测试', title: '渲染冒烟测试',
    url: 'https://example.com/smoke', content: '固定的本地测试证据，不进行任何外部发布。',
    fetchedAt: new Date().toISOString(), primarySource: true,
  }],
  evidence: ['E1: 固定的本地测试证据'], keyFacts: ['验证视频渲染链路'], riskFlags: [], generationMethod: 'rule',
};
upsertCandidate(story);
updateEditionStatus(edition.id, 'approved');
console.log(await renderEdition(edition.id));

