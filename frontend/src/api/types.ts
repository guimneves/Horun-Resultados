export type Mode = 'padrao' | 'validas' | 'todas'

export interface Me {
  user_id: string
  username: string
  level: number
  level_name: string
  role: 'coordenador' | 'colaborador'
  is_coordenador: boolean
  can_delete_projects: boolean
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
}

export interface SeriesPoint extends Stat {
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

export interface PyPeaks {
  peaks: { rt_min: number | null; area: number | null; id: string; n_carbon: number | null }[]
}

export interface PreviewMeasurement {
  file: string
  technique: string
  raw_name: string
  replicate: number | null
  aliquot: number | null
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
