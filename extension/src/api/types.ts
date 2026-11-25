// Raw response shapes of the Flagsmith Management API (/api/v1), as observed on a self-hosted 2.295.2 instance.
// Only the fields FlagLens reads are declared; the API returns more.

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiOrganisation {
  id: number;
  name: string;
}

export interface ApiProject {
  id: number;
  name: string;
  organisation: number;
  only_allow_lower_case_feature_names: boolean;
  feature_name_regex: string | null;
  stale_flags_limit_days: number | null;
}

export interface ApiEnvironment {
  id: number;
  name: string;
  /** Client-side environment key. Also the identifier used in dashboard URLs and environment-scoped endpoints. */
  api_key: string;
  project: number;
  use_v2_feature_versioning: boolean;
}

export type FeatureType = 'STANDARD' | 'MULTIVARIATE';

export interface ApiMultivariateOption {
  id: number;
  type: 'unicode' | 'int' | 'bool';
  string_value: string | null;
  integer_value: number | null;
  boolean_value: boolean | null;
  default_percentage_allocation: number;
  key: string | null;
}

export interface ApiFeature {
  id: number;
  name: string;
  type: FeatureType;
  description: string | null;
  initial_value: string | number | boolean | null;
  default_enabled: boolean;
  created_date: string;
  tags: number[];
  multivariate_options: ApiMultivariateOption[];
  is_archived: boolean;
  num_segment_overrides: number | null;
  num_identity_overrides: number | null;
  /** Populated only by v2 feature versioning; always null on v1 environments. */
  last_modified_in_any_environment: string | null;
  /** Flagsmith's own lifecycle stage, present when the list is requested for an environment. */
  lifecycle_stage?: LifecycleStage | null;
  /** Code references Flagsmith knows about, per repository (from its CI action or FlagLens). */
  code_references_counts?: { repository_url: string; count: number; last_successful_repository_scanned_at?: string }[];
  owners?: { id: number; email?: string; first_name?: string; last_name?: string }[];
}

export type LifecycleStage = 'new' | 'live' | 'stale' | 'permanent' | 'needs_monitoring' | 'to_remove';

/** A Feature Health event (GET /projects/{id}/feature-health/events/): the latest one per flag and environment counts. */
export interface ApiFeatureHealthEvent {
  id: number;
  created_at: string;
  environment: number | null;
  feature: number;
  provider_name: string;
  type: 'HEALTHY' | 'UNHEALTHY';
  reason?: { text_blocks?: { title?: string; text: string }[]; url_blocks?: { title?: string; url: string }[] } | null;
}

/** POST /projects/{id}/code-references/ (the format Flagsmith's own CI scanner uploads). */
export interface CodeReferencesScan {
  repository_url: string;
  vcs_provider: 'github';
  revision: string;
  code_references: { file_path: string; line_number: number; feature_name: string }[];
}

export type FlagValue = string | number | boolean | null;

export interface ApiFeatureState {
  id: number;
  feature: number;
  environment: number;
  enabled: boolean;
  feature_state_value: FlagValue;
  /** null for the environment default; set for segment overrides. */
  feature_segment: number | null;
  /** null for the environment default; set for identity overrides. */
  identity: number | null;
  updated_at: string;
  multivariate_feature_state_values: { id: number; multivariate_feature_option: number; percentage_allocation: number }[];
}

export interface ApiTag {
  id: number;
  label: string;
  color: string;
  is_permanent: boolean;
}

export type ExperimentStatus = 'created' | 'running' | 'paused' | 'completed';

export interface ApiExperiment {
  id: number;
  feature: number;
  name: string;
  status: ExperimentStatus;
  hypothesis?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface CreateFeatureBody {
  name: string;
  type?: FeatureType;
  description?: string;
  default_enabled?: boolean;
  initial_value?: FlagValue;
}
