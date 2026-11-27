// Domain model: the feature × environment matrix that every FlagLens view reads.
// Pure (no VS Code imports) so it can be unit-tested.

import { experimentFeatureId, type ApiEnvironment, type ApiExperiment, type ApiFeature, type ApiFeatureState, type ApiTag, type FeatureType, type FlagValue, type LifecycleStage } from '../api/types';

export interface FsEnvironment {
  id: number;
  name: string;
  apiKey: string;
  /** v2 feature versioning: changes to the default are published as a new version. */
  v2Versioning: boolean;
  /** Matches flaglens.protectedEnvironments: writes need a typed confirmation. */
  protected: boolean;
}

export interface FsVariant {
  id: number;
  key: string | null;
  value: FlagValue;
  /** Default weight (percentage) defined on the feature. */
  weight: number;
}

export interface FsTag {
  id: number;
  label: string;
  color: string;
  permanent: boolean;
}

export interface FsFeature {
  id: number;
  name: string;
  type: FeatureType;
  description: string;
  tags: FsTag[];
  isArchived: boolean;
  variants: FsVariant[];
  createdAt: string;
  segmentOverrides: number;
  identityOverrides: number | null;
  /** Flagsmith's lifecycle stage in the active environment (Flagsmith derives it from code references and changes). */
  lifecycle: LifecycleStage | null;
  /** Code references Flagsmith has for this flag, summed over repositories. */
  codeReferences: number;
  owners: string[];
}

export interface FsState {
  featureStateId: number;
  enabled: boolean;
  value: FlagValue;
  updatedAt: string;
  /** Per-environment variant weights (percentage) keyed by variant id. */
  variantWeights: Map<number, number>;
}

export interface FsExperimentRef {
  id: number;
  name: string;
  status: ApiExperiment['status'];
  envId: number;
}

export interface FlagRow {
  feature: FsFeature;
  /** Keyed by environment id. A missing entry means the environment has no default state for this flag. */
  states: Map<number, FsState>;
  /** Running experiments lock the flag in that environment. */
  experiments: FsExperimentRef[];
}

export function toEnvironment(env: ApiEnvironment, protectedPattern: RegExp | undefined): FsEnvironment {
  return {
    id: env.id,
    name: env.name,
    apiKey: env.api_key,
    v2Versioning: env.use_v2_feature_versioning,
    protected: protectedPattern ? protectedPattern.test(env.name) : false,
  };
}

/** Compiles the protected-environment setting; an invalid regex falls back to the default instead of throwing. */
export function compileProtectedPattern(pattern: string): RegExp | undefined {
  if (!pattern.trim()) return undefined;
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return /prod|live|main/i;
  }
}

function variantValue(o: ApiFeature['multivariate_options'][number]): FlagValue {
  if (o.type === 'int') return o.integer_value;
  if (o.type === 'bool') return o.boolean_value;
  return o.string_value;
}

/**
 * Joins the project's features with each environment's feature states.
 * Only environment defaults are used (no segment, no identity); overrides are counted on the feature instead.
 */
export function buildRows(
  features: ApiFeature[],
  tags: ApiTag[],
  statesByEnv: Map<number, ApiFeatureState[]>,
  experimentsByEnv: Map<number, ApiExperiment[]> = new Map(),
): Map<string, FlagRow> {
  const tagById = new Map(tags.map((t) => [t.id, { id: t.id, label: t.label, color: t.color, permanent: t.is_permanent }]));
  const rows = new Map<string, FlagRow>();
  const byId = new Map<number, FlagRow>();

  for (const f of features) {
    const row: FlagRow = {
      feature: {
        id: f.id,
        name: f.name,
        type: f.type,
        description: f.description ?? '',
        tags: f.tags.map((id) => tagById.get(id)).filter((t): t is FsTag => t !== undefined),
        isArchived: f.is_archived,
        variants: f.multivariate_options.map((o) => ({
          id: o.id,
          key: o.key,
          value: variantValue(o),
          weight: o.default_percentage_allocation,
        })),
        createdAt: f.created_date,
        segmentOverrides: f.num_segment_overrides ?? 0,
        identityOverrides: f.num_identity_overrides,
        lifecycle: f.lifecycle_stage ?? null,
        codeReferences: (f.code_references_counts ?? []).reduce((n, r) => n + r.count, 0),
        owners: (f.owners ?? []).map((o) => [o.first_name, o.last_name].filter(Boolean).join(' ') || o.email || `user ${o.id}`),
      },
      states: new Map(),
      experiments: [],
    };
    rows.set(f.name, row);
    byId.set(f.id, row);
  }

  for (const [envId, states] of statesByEnv) {
    for (const s of states) {
      if (s.feature_segment !== null || s.identity !== null) continue;
      const row = byId.get(s.feature);
      if (!row) continue;
      row.states.set(envId, {
        featureStateId: s.id,
        enabled: s.enabled,
        value: s.feature_state_value,
        updatedAt: s.updated_at,
        variantWeights: new Map(
          (s.multivariate_feature_state_values ?? []).map((v) => [v.multivariate_feature_option, v.percentage_allocation]),
        ),
      });
    }
  }

  for (const [envId, experiments] of experimentsByEnv) {
    for (const x of experiments) {
      const row = byId.get(experimentFeatureId(x));
      if (row) row.experiments.push({ id: x.id, name: x.name, status: x.status, envId });
    }
  }
  return rows;
}

/** A change signature per row, used to fire change events only when something visible changed. */
export function rowSignature(row: FlagRow): string {
  const states = [...row.states.entries()]
    .sort(([a], [b]) => a - b)
    .map(([env, s]) => `${env}:${s.featureStateId}:${s.enabled ? 1 : 0}:${JSON.stringify(s.value)}:${s.updatedAt}:${[...s.variantWeights.values()].join('/')}`)
    .join('|');
  const f = row.feature;
  const x = row.experiments.map((e) => `${e.id}:${e.status}`).join(',');
  return `${f.id}:${f.isArchived ? 1 : 0}:${f.tags.map((t) => t.id).join(',')}:${f.segmentOverrides}:${f.description}|${states}|${x}`;
}

/**
 * Whether a flag can be changed in an environment, and if not, why. `what` is the environment default (published as
 * a new version in v2-versioned environments) or its segment overrides (dashboard only in those environments).
 */
export function writeBlockReason(row: FlagRow, env: FsEnvironment, what: 'default' | 'segments' = 'default'): string | undefined {
  if (env.v2Versioning && what === 'segments') return `${env.name} uses feature versioning (v2): change its segment overrides in the Flagsmith dashboard.`;
  if (row.experiments.some((x) => x.envId === env.id && x.status === 'running')) {
    return `${row.feature.name} is locked by a running experiment in ${env.name}.`;
  }
  if (!row.states.has(env.id)) return `${row.feature.name} has no state in ${env.name}.`;
  return undefined;
}

/** Renders a flag value for compact UI text. */
export function formatValue(value: FlagValue, max = 32): string {
  if (value === null || value === undefined || value === '') return '';
  const text = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
