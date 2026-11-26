import React from 'react';
import { Composition } from 'remotion';
import { DURATION, FlagLensDemo } from './Video';
import { FPS, H, W } from './theme';
import { Thumbnail } from './Thumbnail';

export const Root: React.FC = () => (
  <>
    <Composition id="FlagLensDemo" component={FlagLensDemo} durationInFrames={DURATION} fps={FPS} width={W} height={H} />
    <Composition id="Thumbnail" component={Thumbnail} durationInFrames={1} fps={FPS} width={1280} height={720} />
  </>
);
