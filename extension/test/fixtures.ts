import type { ApiFeature, ApiFeatureState, ApiTag } from '../src/api/types';
import type { FlagRow, FsEnvironment } from '../src/core/model';

export const ENVS: FsEnvironment[] = [
  { id: 1, name: 'Development', apiKey: 'devKey', v2Versioning: false, protected: false },
  { id: 2, name: 'Staging', apiKey: 'stgKey', v2Versioning: false, protected: false },
  { id: 3, name: 'Production', apiKey: 'prdKey', v2Versioning: false, protected: true },
];

export function apiFeature(id: number, name: string, extra: Partial<ApiFeature> = {}): ApiFeature {
  return {
    id,
    name,
    type: 'STANDARD',
    description: null,
    initial_value: null,
    default_enabled: false,
    created_date: '2026-01-01T00:00:00Z',
    tags: [],
    multivariate_options: [],
    is_archived: false,
    num_segment_overrides: 0,
    num_identity_overrides: null,
    last_modified_in_any_environment: null,
    ...extra,
  };
}

export function apiState(id: number, feature: number, environment: number, extra: Partial<ApiFeatureState> = {}): ApiFeatureState {
  return {
    id,
    feature,
    environment,
    enabled: true,
    feature_state_value: null,
    feature_segment: null,
    identity: null,
    updated_at: '2026-01-01T00:00:00Z',
    multivariate_feature_state_values: [],
    ...extra,
  };
}

export const TAGS: ApiTag[] = [
  { id: 1, label: 'kill-switch', color: '#f00', is_permanent: false },
  { id: 2, label: 'ops', color: '#0f0', is_permanent: true },
];

/** Builds a FlagRow by hand: states is [enabled, value, updatedAt?] per environment id. */
export function row(
  name: string,
  states: Record<number, [boolean, string | number | boolean | null, string?]>,
  extra: Partial<FlagRow['feature']> = {},
): FlagRow {
  return {
    feature: {
      id: 1,
      name,
      type: 'STANDARD',
      description: '',
      tags: [],
      isArchived: false,
      variants: [],
      createdAt: '2026-01-01T00:00:00Z',
      segmentOverrides: 0,
      identityOverrides: null,
      ...extra,
    },
    states: new Map(
      Object.entries(states).map(([env, [enabled, value, updatedAt]], i) => [
        Number(env),
        { featureStateId: 100 + i, enabled, value, updatedAt: updatedAt ?? '2026-01-01T00:00:00Z', variantWeights: new Map() },
      ]),
    ),
    experiments: [],
  };
}
