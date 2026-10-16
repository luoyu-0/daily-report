import type {ComponentType} from 'react';
import type {DiscoveryEdition} from '../../shared/types';
import type {TimelineSegment} from '../timeline';
import {BlueGridTemplate} from './blue-grid';
import {DarkSignalTemplate} from './dark-signal';

export type TemplateViewProps = {edition: DiscoveryEdition; timeline: TimelineSegment[]};
export type VideoTemplate = {id: string; name: string; description: string; render: ComponentType<TemplateViewProps>};

// 新风格只需实现 TemplateViewProps 并加入此表，预览与正式渲染会共用同一注册表。
export const videoTemplates: VideoTemplate[] = [
  {id: 'blue-grid', name: '白蓝信息卡', description: '当前默认风格', render: BlueGridTemplate},
  {id: 'dark-signal', name: '深蓝信号', description: '深色高对比展示', render: DarkSignalTemplate},
];

if (new Set(videoTemplates.map((template) => template.id)).size !== videoTemplates.length) {
  throw new Error('视频模板 ID 不可重复');
}

export function getVideoTemplate(id: string): VideoTemplate {
  const template = videoTemplates.find((item) => item.id === id);
  if (!template) throw new Error(`视频模板不存在：${id}`);
  return template;
}
