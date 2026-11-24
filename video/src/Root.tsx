import React from 'react';
import { Composition } from 'remotion';
import { DURATION, FlagLensDemo } from './Video';
import { FPS, H, W } from './theme';

export const Root: React.FC = () => (
  <Composition id="FlagLensDemo" component={FlagLensDemo} durationInFrames={DURATION} fps={FPS} width={W} height={H} />
);
