export type Mode = 'padrao' | 'validas' | 'todas'

export interface Me {
  user_id: string
  username: string
  level: number
  level_name: string
  role: 'coordenador' | 'colaborador'
  is_coordenador: boolean
  /** Pode importar e alterar resultados (níveis 1–3); técnico(a) e IC só visualizam. */
  can_edit: boolean
  can_delete_projects: boolean
  can_see_history: boolean
  /** Níveis 1–2 veem todos os projetos; os demais, só aqueles em que são membros. */
  sees_all_projects: boolean
  /** Pode cuidar de "Pessoas do projeto" (níveis 1–3: pesquisadores, técnicos e ICs). */
  can_manage_members: boolean
  dev_mode: boolean
}

export interface ParamDef {
  key: string
  label: string
  unit: string
  main: boolean
  derived: boolean
}

export interface TechniqueDef {
  key: string
  label: string
  instrument?: string
  params: ParamDef[]
}

export interface Fraction {
  id: number
  code: string
  label: string
  description: string
  in_series: boolean
  series_group: string
  sort: number
  /** tipo de amostra em que existe ("" = todos): rocha_hidropirolise, tabaco... */
  sample_type: string
}

export interface Project {
  id: number
  name: string
  description: string
  color: string
  archived_at: string | null
  created_at: string
  created_by: string
  counts: { samples: number; analyses: number; experiments: number }
  can_manage_members: boolean
  /** Perfil já resolvido pelo servidor (backend/app/services/profiles.py). */
  profile: ProjectProfile
}

/** Tipo de amostra, análises e parâmetros do projeto (docs/PERFIS_DE_PROJETO.md). */
export interface ProjectProfile {
  version: number
  sample_type: string
  sample_type_label: string
  /** Tem o eixo "temperatura de hidropirólise" (abas Séries e Condições experimentais)? */
  temperature_axis: boolean
  recipes: string[]
  parameters: Record<string, string[]>
  /** vistas/grupos da aba Séries que aparecem (vazio = todos) */
  series?: string[]
}

/** GET /profiles — o que existe para montar um perfil. */
export interface ProfileOptions {
  default_sample_type: string
  sample_types: { key: string; label: string; description: string; recipes: string[]; status: string; temperature_axis: boolean }[]
  recipes: { key: string; label: string; instrument: string; status: string }[]
}

/** Pessoa com acesso a um projeto (níveis 3–5; níveis 1–2 veem todos). */
export interface ProjectMember {
  id: number
  project_id: number
  user_id: string
  username: string
  display_name: string
  level_at_add: number | null
  /** Cargo atual no Horun (ou o da hora em que foi adicionada, se o Core não respondeu). */
  level: number | null
  added_by: string
  added_at: string
  can_remove: boolean
}

/** Pessoa do Horun que pode ser adicionada a um projeto. */
export interface DirectoryPerson {
  user_id: string
  username: string
  display_name: string
  level: number
}

export interface Stat {
  mean: number | null
  sd: number | null
  n: number
}

export interface SampleRow {
  id: number
  code: string
  fraction: string
  temperature_c: number | null
  experiment_id: number | null
  experiment_code: string | null
  atmosphere: string | null
  replicate_letter: string | null
  kind: 'sample' | 'standard'
  notes: string
  valid: boolean | null
  validated_by: string | null
  validated_at: string | null
  techniques?: string[]
  values: Record<string, Stat>
  /** valor de cada variável de amostra (chave → número, categoria ou null) */
  variables?: Record<string, VariableValue>
}

export type VariableValue = number | string | null

/** Variável de amostra do projeto (eixo das Séries) — backend/app/services/variables.py. */
export interface SampleVariable {
  id: number
  key: string
  /** "" = criada pelas pessoas; "temperature" / "fraction" = do tipo de amostra */
  builtin: '' | 'temperature' | 'fraction'
  label: string
  kind: 'numero' | 'categoria'
  unit: string
  description: string
  options: { value: string; label: string }[]
  options_editable: boolean
  can_delete: boolean
  n_values: number
}

export interface VariablesResponse {
  variables: SampleVariable[]
  /** sample_id → chave → valor */
  values: Record<string, Record<string, VariableValue>>
}

export interface AnalysisOut {
  id: number
  technique: string
  source_name: string
  replicate: number | null
  aliquot: number | null
  analyzed_at: string
  instrument: string
  method: string
  valid: boolean | null
  validated_by: string | null
  file: { id: number; filename: string } | null
  has_data: boolean
  values: { parameter: string; replicate: number | null; value: number; unit: string }[]
}

export interface SampleDetail extends SampleRow {
  aliases: { id: number; alias: string; created_by: string }[]
  analyses: AnalysisOut[]
  aliquots: { technique: string; aliquot: number; values: Record<string, Stat> }[]
}

export interface Experiment {
  id: number
  project_id: number
  code: string
  temperature_c: number | null
  atmosphere: string
  replicate_letter: string
  duration_h: number | null
  reactor: string
  initial_mass_g: number | null
  date: string
  notes: string
  conditions: {
    condicoes?: Record<string, { value: unknown; unit: string }>
    resultados?: Record<string, { value: unknown; unit: string }>
    gas_enchimento?: string
  }
  samples: { id: number; code: string; fraction: string; valid: boolean | null }[]
  // massas da réplica (g) — gás: valor digitado substitui o da planilha
  gas_mass_g: number | null
  oil_mass_g: number | null
  bitumen_mass_g: number | null
  gas_mass_effective_g: number | null
  gas_mass_source: 'planilha' | 'editado' | null
  gas_mass_sheet_g: number | null
  gas_mass_manual_g: number | null
}

export type MassKey = 'gas_mass_g' | 'oil_mass_g' | 'bitumen_mass_g'

export interface MassReplicate {
  experiment_id: number
  code: string
  replicate_letter: string
  gas_mass_g: number | null
  gas_mass_source: 'planilha' | 'editado' | null
  oil_mass_g: number | null
  bitumen_mass_g: number | null
}

export interface MassGroup {
  key: string
  label: string
  temperature_c: number | null
  atmosphere: string
  replicates: MassReplicate[]
  stats: Record<MassKey, Stat>
}

export interface MassesResponse {
  masses: { key: MassKey; label: string; unit: string }[]
  atmospheres: string[]
  groups: MassGroup[]
}

export interface SeriesPoint extends Stat {
  /** valor da variável do eixo (número ou categoria) */
  x: number | string
  temperature_c: number
  n_samples: number
  n_values: number
  samples: { id: number; code: string; mean: number; sd: number | null; n: number }[]
}

export interface Series {
  key: string
  fraction: string
  fractions: string[]
  atmosphere: string
  replicate_letter: string
  label: string
  points: SeriesPoint[]
}

export interface SeriesResponse {
  technique: string
  parameter: string
  label: string
  unit: string
  mode: Mode
  series: Series[]
  baseline: ({ sample_id: number; code: string; fraction: string } & Stat)[]
  variable?: {
    key: string
    builtin: SampleVariable['builtin']
    label: string
    kind: SampleVariable['kind']
    unit: string
    categories: { value: string; label: string }[]
  }
}

export interface AnalysisData<T = unknown> {
  analysis_id: number
  sample_id: number
  sample_code: string
  source_name: string
  replicate: number | null
  aliquot: number | null
  data: T
}

export interface CurveSet {
  legend: string[]
  series: Record<string, number[]>
  points: number
}

export interface PyroData {
  pyro: CurveSet | null
  oxi: CurveSet | null
}

/** Curva do TG (backend/app/parsers/tg.py): massa em % da inicial e DTG = dm/dT (%/°C). */
export interface TgData {
  time_s: number[] | null
  temperature: number[]
  mass_pct: number[]
  dtg: (number | null)[]
  points: number
}

/** Pico do GC-FID/GC-MS da Shimadzu (parsers/shimadzu.py) */
export interface GcPeak {
  rt_min: number
  start_min: number
  end_min: number
  area: number
  height: number
  area_pct: number | null
  /** só GC-MS */
  similarity?: number
  name?: string
  identified?: boolean
  target?: string | null
}

/** Cromatograma (curva reduzida) + picos — .gcd (FID) ou .qgd (MS) */
export interface GcData {
  kind: 'chromatogram'
  detector: string
  curve: { t: number[]; y: number[] }
  peaks: GcPeak[]
  min_similarity?: number
}

export interface PyPeaks {
  peaks: { rt_min: number | null; area: number | null; id: string; n_carbon: number | null }[]
}

export interface PreviewMeasurement {
  file: string
  technique: string
  raw_name: string
  replicate: number | null
  aliquot: number | null
  /** Região da amostra no MEV-EDS (pasta "externo", "folha externa"...). */
  region?: string | null
  key: string
  n_values: number
  updates_existing: boolean
  duplicate_of: string | null
}

export type RowAction = 'link' | 'create' | 'skip'

export interface PreviewRow {
  row: string
  name: string
  kind: 'sample' | 'standard' | 'blank'
  techniques: string[]
  files: string[]
  n_measurements: number
  replicates: number[]
  aliquots: number[]
  values: Record<string, number>
  suggested: {
    code: string
    fraction: string
    temperature_c: number | null
    experiment_code: string | null
    kind: string
    recognized: boolean
  }
  action: RowAction
  sample_id: number | null
  sample_code: string | null
  suggestion_source: string
  updates_existing: boolean
  measurements: PreviewMeasurement[]
}

export interface PreviewFile {
  filename: string
  folder: string
  status: 'ok' | 'ignorado' | 'erro' | 'duplicado'
  message: string
  technique: string | null
  format: string
  records: number
  warnings: string[]
  already_in_samples: string[]
}

export interface Preview {
  batch_id: number
  technique: string
  files: PreviewFile[]
  rows: PreviewRow[]
  counts: Record<string, number>
}

export interface ImportResult {
  samples_created: number
  samples_linked: number
  analyses_created: number
  analyses_updated: number
  skipped: number
  aliases_saved: number
  /** valores de variáveis de amostra gravados a partir do arquivo (Estudo PostRun: frações, composição) */
  variables_set?: number
  files_imported: number
  new_sample_codes: string[]
  linked: Record<string, string[]>
}

export interface HistoryEvent {
  id: number
  user_id: string
  username: string
  action: string
  summary: string
  created_at: string
  details: Record<string, unknown>
}

export interface StoredFileOut {
  id: number
  filename: string
  path_hint: string
  technique: string | null
  format_label: string
  size: number
  imported_at: string | null
  imported_by: string | null
}

/** Prévia de "Excluir selecionadas" (POST samples/bulk-delete com dry_run). */
export interface BulkDeletePreview {
  dry_run: true
  samples: { id: number; code: string; analyses: number }[]
  total_samples: number
  total_analyses: number
  files_removed: number
  files_kept: number
}

export interface BulkDeleteResult {
  dry_run: false
  deleted_samples: number
  deleted_analyses: number
  files_removed: number
  files_kept: number
}

// ---------------------------------------------------------------- Extração ASE e DOE (22/10/2026)

export type DoeFactorKind = 'continuo' | 'discreto' | 'categorico'
export interface DoeFactor {
  letter: string
  name: string
  unit: string
  kind: DoeFactorKind
  low: number | string
  high: number | string
  low_label: string
  high_label: string
}

export type AseGroup = 'principal' | 'complementar' | 'eficiencia' | 'diagnostico' | 'rockeval' | 'rockeval_delta'
export interface AseField {
  key: string
  label: string
  short: string
  unit: string
  group: AseGroup
  group_label: string
  /** digitado (resultado final) ou calculado / vindo do Rock-Eval */
  input: boolean
  /** execuções válidas com valor */
  n: number
}

export interface AseStat {
  n: number
  mean: number | null
  sd: number | null
  rsd: number | null
}

export interface DoeRun {
  id: number
  condition: string
  replicate: number
  label: string
  code: string
  coded: Record<string, number>
  levels: Record<string, string>
  planned_order: number | null
  actual_order: number | null
  run_date: string
  sample_id: number | null
  sample_linked_by: 'escolhida' | 'código' | null
  valid: boolean
  notes: string
  values: Record<string, number | null>
  solvent_ml_kind: 'medido' | 'estimado' | null
  flags: string[]
  done: boolean
  updated_by: string
}

export interface DoeConditionSummary {
  code: string
  coded: Record<string, number>
  levels: Record<string, string>
  n_runs: number
  n_done: number
  stats: Record<string, AseStat>
}

export interface DoePlanListItem {
  id: number
  name: string
  design: string
  factors: string[]
  replicates: number
  center_points: number
  n_runs: number
  n_done: number
  updated_at: string
}

export interface DoePlan {
  id: number
  name: string
  description: string
  factors: DoeFactor[]
  design: string
  terms: string[]
  replicates: number
  center_points: number
  center_possible: boolean
  center_reason: string
  center_values: Record<string, number> | null
  randomized: boolean
  pre_sample: { id: number; code: string } | null
  method: Record<string, string>
  conditions_matrix: { code: string; coded: Record<string, number>; values: Record<string, number | string>; levels: Record<string, string> }[]
  n_runs: number
  n_done: number
  runs: DoeRun[]
  conditions: DoeConditionSummary[]
  fields: AseField[]
  created_by: string
  updated_at: string
}

export interface DoeEffect {
  term: string
  label: string
  order: number
  coef: number
  effect: number
  se_effect?: number
  t?: number | null
  p?: number | null
  significant?: boolean
  ss?: number
}

export interface DoeAnalysis {
  ok: boolean
  message?: string
  confidence: number
  terms: string[]
  n_runs: number
  n_center: number
  missing_conditions: string[]
  response: { key: string; label: string; short: string; unit: string; group: AseGroup }
  intercept?: number
  df_resid?: number
  mse?: number | null
  s?: number | null
  t_crit?: number | null
  alpha?: number
  effects?: DoeEffect[]
  curvature?: { coef: number; mean_center: number | null; mean_factorial: number | null; t?: number | null; p?: number | null; significant?: boolean }
  r2?: number | null
  r2_adj?: number | null
  r2_pred?: number | null
  anova?: { source: string; label: string; df: number; ss: number | null; ms: number | null; f: number | null; p: number | null }[] | null
  significance_note?: string | null
  half_normal?: { term: string; abs_effect: number; quantile: number }[]
  main_effects?: { letter: string; name: string; low: string; high: string; mean_low: number | null; mean_high: number | null }[]
  interactions?: {
    a: string
    b: string
    a_name: string
    b_name: string
    a_low: string
    a_high: string
    b_low: string
    b_high: string
    means: Record<string, number | null>
  }[]
  residuals?: { run: string; condition: string; y: number; fitted: number; residual: number; standardized: number | null; normal_score: number }[]
}
