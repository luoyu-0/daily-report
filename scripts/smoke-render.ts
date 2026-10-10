import {createEdition, newId, updateEditionStatus, upsertCandidate} from '../src/db.js';
import {renderEdition} from '../src/render.js';
import type {ToolCandidate} from '../src/shared/types.js';

const edition = createEdition('2026-10-09');
const story: ToolCandidate = {
  id: newId('tool'), editionId: edition.id, repo: 'example/tool-radar-smoke', url: 'https://github.com/example/tool-radar-smoke',
  rank: 1, starsToday: 100, totalStars: 1000, forks: 50, language: 'TypeScript', topics: ['developer-tools'],
  license: 'MIT', archived: false, toolType: '开发工具', oneLinePitchZh: '用于验证 GitHub 工具雷达视频渲染链路的固定测试项目。',
  useCases: ['验证中文排版与页面转场'], targetUsers: ['开发者'], quickStart: 'npm install tool-radar-smoke',
  prerequisites: ['Node.js'], caveats: ['仅用于本地冒烟测试'], utilityScore: 88, toolLikely: true,
  selected: true, confirmed: true, position: 0,
  sources: [{
    id: 'smoke-source', sourceName: 'GitHub', title: 'example/tool-radar-smoke',
    url: 'https://github.com/example/tool-radar-smoke', content: '固定的本地测试证据。npm install tool-radar-smoke',
    fetchedAt: new Date().toISOString(), primarySource: true,
  }],
  evidence: ['E1: 固定的本地测试证据'], riskFlags: [], generationMethod: 'rule',
};
upsertCandidate(story);
updateEditionStatus(edition.id, 'approved');
console.log(await renderEdition(edition.id));

