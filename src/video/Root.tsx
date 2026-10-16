import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {DailyReportVideo} from './Composition';
import {totalDurationFrames, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH} from './timeline';
import {defaultVideoConfig, videoPropsSchema, type VideoProps} from '../shared/types';

const placeholder: VideoProps = {
  hasBgm: false,
  edition: {
    id: 'preview', kind: 'github-tools', date: '2026-10-09', version: 1, status: 'approved', candidates: [], videoConfig: defaultVideoConfig,
    brand: {name: 'GitHub 工具雷达', tagline: '每天从全球热榜发现值得一试的工具', background: '#F4F8FF', primary: '#2563EB', ink: '#0F172A', paleBlue: '#DBEAFE', accent: '#38BDF8'},
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  },
};

export const RemotionRoot = () => <Composition
  id="DailyReport"
  component={DailyReportVideo}
  width={VIDEO_WIDTH}
  height={VIDEO_HEIGHT}
  fps={VIDEO_FPS}
  durationInFrames={30}
  schema={videoPropsSchema}
  defaultProps={placeholder}
  calculateMetadata={({props}) => ({durationInFrames: totalDurationFrames(props.edition)})}
/>;

registerRoot(RemotionRoot);

