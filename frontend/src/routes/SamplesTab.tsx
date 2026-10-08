import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, errorText } from "../api/client";
import type {
  BulkDeletePreview,
  BulkDeleteResult,
  Mode,
  SampleRow,
} from "../api/types";
import { BulkCreate } from "../components/BulkCreate";
import {
  Button,
  card,
  Empty,
  ErrorBox,
  Field,
  inputClass,
  inputStyle,
  Modal,
  muted,
  ValidityBadge,
} from "../components/ui";
import { useApp } from "../context/AppContext";
import { fmtMeanSd, fmtTemp } from "../lib/format";
import { useIsMobile } from "../lib/useIsMobile";
import { useSamples } from "../lib/useSamples";
import { useProject } from "./ProjectLayout";
import { SampleDetailModal } from "./SampleDetail";

export const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "padrao", label: "Válidas e pendentes (sem as inválidas)" },
  { value: "validas", label: "Só as validadas" },
  { value: "todas", label: "Todas (inclui inválidas)" },
];

function NewSample({
  projectId,
  onClose,
  onDone,
}: {
  projectId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { fractions } = useApp();
  const [code, setCode] = useState("");
  const [fraction, setFraction] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Nova amostra" onClose={onClose}>
      <div className="space-y-3">
        <Field
          label="Código"
          hint="Ex.: HP320H, HP355NBE, RO-1. Fração e temperatura são sugeridas pelo código se você deixar em branco."
        >
          <input
            className={inputClass}
            style={inputStyle}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Fração">
          <select
            className={inputClass}
            style={inputStyle}
            value={fraction}
            onChange={(e) => setFraction(e.target.value)}
          >
            <option value="">(sugerir pelo código)</option>
            {fractions.map((f) => (
              <option key={f.code} value={f.code}>
                {f.label} ({f.code})
              </option>
            ))}
          </select>
        </Field>
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!code.trim()}
            onClick={async () => {
              try {
                await api.post(`/projects/${projectId}/samples`, {
                  code,
                  fraction: fraction || null,
                });
                onDone();
              } catch (err) {
                setError(errorText(err));
              }
            }}
          >
            Criar amostra
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type View = "lista" | "valores";
const VIEW_KEY = "resultados.amostras.visao";
function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "valores" ? "valores" : "lista";
  } catch {
    return "lista";
  }
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-[var(--color-surface)] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Caixa de seleção com área de toque de 40 px (Prompt, seção 13). */
function SelectBox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label
      className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center"
      onClick={(e) => e.stopPropagation()}
      title={label}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
    </label>
  );
}

function BulkDeleteConfirm({
  projectId,
  ids,
  onClose,
  onDone,
}: {
  projectId: number;
  ids: number[];
  onClose: () => void;
  onDone: (r: BulkDeleteResult) => void;
}) {
  const [preview, setPreview] = useState<BulkDeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .post<BulkDeletePreview>(`/projects/${projectId}/samples/bulk-delete`, {
        sample_ids: ids,
        dry_run: true,
      })
      .then(setPreview)
      .catch((err) => setError(errorText(err)));
  }, [projectId, ids]);
  const n = ids.length;
  return (
    <Modal title={`Excluir ${n} amostra(s)`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        {!preview && !error && <p style={muted}>Contando as medições…</p>}
        {preview && (
          <>
            <p>
              Vão sair <strong>para sempre</strong> {preview.total_samples}{" "}
              amostra(s) e{" "}
              <strong>{preview.total_analyses} medição(ões)</strong> (valores,
              curvas, nomes lembrados e validação).{" "}
              <strong>Não dá para desfazer.</strong>
            </p>
            <ul
              className="max-h-60 overflow-y-auto rounded-md border"
              style={{ borderColor: "var(--color-border)" }}
              data-testid="bulk-delete-list"
            >
              {preview.samples.map((s) => (
                <li
                  key={s.id}
                  className="flex justify-between gap-2 border-b px-3 py-1.5 last:border-b-0"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <span className="min-w-0 truncate font-medium">{s.code}</span>
                  <span className="shrink-0" style={muted}>
                    {s.analyses} medição(ões)
                  </span>
                </li>
              ))}
            </ul>
            <p style={muted}>
              Arquivos originais: os que ainda têm medições de outras amostras
              continuam guardados
              {preview.files_kept ? ` (${preview.files_kept})` : ""}; os que
              ficarem sem nenhuma medição saem do servidor
              {preview.files_removed ? ` (${preview.files_removed})` : ""} e
              poderão ser importados de novo.
            </p>
          </>
        )}
        <ErrorBox message={error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            disabled={!preview || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                onDone(
                  await api.post<BulkDeleteResult>(
                    `/projects/${projectId}/samples/bulk-delete`,
                    { sample_ids: ids },
                  ),
                );
              } catch (err) {
                setError(errorText(err));
                setBusy(false);
              }
            }}
          >
            Excluir {n} amostra(s)
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SamplesTab() {
  const { project, readOnly } = useProject();
  const { catalog, fractions, fractionLabel, paramLabel, techniqueLabel, me } =
    useApp();
  const mobile = useIsMobile();
  const [mode, setMode] = useState<Mode>("padrao");
  const { samples, error, reload } = useSamples(project.id, mode);
  const [search, setSearch] = useState("");
  const [fraction, setFraction] = useState("");
  const [technique, setTechnique] = useState("");
  const [validity, setValidity] = useState("");
  const [showOthers, setShowOthers] = useState(false);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Seleção (só coordenadores, projeto aberto): excluir/validar várias de uma vez
  const canSelect = !!me?.is_coordenador && !readOnly;
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState<number[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // Tela enxuta por padrão: filtros recolhidos, "Lista" sem números, caixinhas só no modo seleção.
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<View>(readView);
  const [selecting, setSelecting] = useState(false);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sem armazenamento: só não lembra a escolha */
    }
  };
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const otherFractions = useMemo(
    () => new Set(fractions.filter((f) => !f.in_series).map((f) => f.code)),
    [fractions],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (samples ?? []).filter((s) => {
      if (
        q &&
        !`${s.code} ${s.experiment_code ?? ""}`.toLowerCase().includes(q)
      )
        return false;
      if (fraction && s.fraction !== fraction) return false;
      if (technique && !s.techniques?.includes(technique)) return false;
      if (validity && String(s.valid) !== validity) return false;
      if (!showOthers && !fraction && otherFractions.has(s.fraction))
        return false;
      return true;
    });
  }, [
    samples,
    search,
    fraction,
    technique,
    validity,
    showOthers,
    otherFractions,
  ]);

  // colunas: as principais de cada técnica que aparece nos dados
  const available = useMemo(() => {
    const present = new Set(filtered.flatMap((s) => Object.keys(s.values)));
    return catalog
      .flatMap((t) =>
        t.params.map((p) => ({
          col: `${t.key}.${p.key}`,
          main: p.main,
          tech: t.key,
        })),
      )
      .filter((c) => present.has(c.col));
  }, [catalog, filtered]);
  const columns = chosen ?? available.filter((c) => c.main).map((c) => c.col);

  // As ações valem só para as selecionadas que aparecem com os filtros atuais.
  const selectedIds = useMemo(
    () => filtered.filter((s) => selected.has(s.id)).map((s) => s.id),
    [filtered, selected],
  );
  const allSelected =
    filtered.length > 0 && selectedIds.length === filtered.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) =>
    setSelected(on ? new Set(filtered.map((s) => s.id)) : new Set());
  const clearSelection = () => setSelected(new Set());

  async function bulkValidate(valid: boolean) {
    setBulkBusy(true);
    setBulkError(null);
    setBulkMsg(null);
    try {
      const r = await api.post<{ updated: number }>(
        `/projects/${project.id}/samples/bulk-validation`,
        { sample_ids: selectedIds, valid },
      );
      setBulkMsg(
        `${r.updated} amostra(s) marcada(s) como ${valid ? "válida(s)" : "inválida(s)"}.`,
      );
      await reload();
    } catch (err) {
      setBulkError(errorText(err));
    } finally {
      setBulkBusy(false);
    }
  }

  async function exportAs(format: "csv" | "xlsx") {
    setExportError(null);
    try {
      await api.download(
        `/projects/${project.id}/export`,
        `resultados.${format}`,
        {
          format,
          mode,
          sample_ids: filtered.map((s) => s.id),
          columns,
        },
      );
    } catch (err) {
      setExportError(errorText(err));
    }
  }

  const shownCols = view === "valores" ? columns : [];
  const techsOf = (s: SampleRow) =>
    s.techniques ??
    Array.from(new Set(Object.keys(s.values).map((k) => k.split(".")[0])));
  const header = (col: string) =>
    `${techniqueLabel(col.split(".")[0])} ${paramLabel(col)}`;
  const activeFilters = [
    fraction,
    technique,
    validity,
    mode !== "padrao" ? mode : "",
    showOthers ? "x" : "",
  ].filter(Boolean).length;
  const checkboxes = canSelect && selecting;

  return (
    <div className="space-y-3">
      {/* Barra simples: busca, filtros (recolhidos), visão, nova amostra e o resto no "Mais". */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} min-w-0 flex-1 basis-48`}
          style={inputStyle}
          placeholder="Buscar amostra"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar"
        />
        <Button
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          Filtros{activeFilters ? ` (${activeFilters})` : ""}
        </Button>
        <div
          className="inline-flex rounded-md border p-0.5"
          style={{ borderColor: "var(--color-border)" }}
          role="group"
          aria-label="Visão"
        >
          {(
            [
              ["lista", "Lista"],
              ["valores", "Valores"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              aria-pressed={view === v}
              className="rounded px-3 py-1 text-sm"
              style={
                view === v
                  ? {
                      background: "var(--color-primary)",
                      color: "var(--color-primary-contrast)",
                    }
                  : muted
              }
            >
              {label}
            </button>
          ))}
        </div>
        {!readOnly && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + Nova amostra
          </Button>
        )}
        <details className="relative" ref={moreRef}>
          <summary
            className="flex h-9 cursor-pointer list-none items-center rounded-md border px-3 text-sm"
            style={{ borderColor: "var(--color-border)" }}
            aria-label="Mais ações"
          >
            Mais ▾
          </summary>
          <div
            className="absolute right-0 z-20 mt-1 w-56 rounded-md border p-1 shadow-lg"
            style={card}
            onClick={() => moreRef.current?.removeAttribute("open")}
          >
            {canSelect && (
              <MenuItem
                onClick={() =>
                  selecting ? stopSelecting() : setSelecting(true)
                }
              >
                {selecting ? "Parar de selecionar" : "Selecionar várias"}
              </MenuItem>
            )}
            {!readOnly && (
              <MenuItem onClick={() => setBulk(true)}>Criar várias</MenuItem>
            )}
            <MenuItem
              disabled={!filtered.length}
              onClick={() => exportAs("csv")}
            >
              Exportar CSV
            </MenuItem>
            <MenuItem
              disabled={!filtered.length}
              onClick={() => exportAs("xlsx")}
            >
              Exportar XLSX
            </MenuItem>
          </div>
        </details>
      </div>

      {showFilters && (
        <div
          className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4"
          style={card}
          data-testid="filters"
        >
          <select
            className={inputClass}
            style={inputStyle}
            value={fraction}
            onChange={(e) => setFraction(e.target.value)}
            aria-label="Fração"
          >
            <option value="">Todas as frações</option>
            {fractions.map((f) => (
              <option key={f.code} value={f.code}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            style={inputStyle}
            value={technique}
            onChange={(e) => setTechnique(e.target.value)}
            aria-label="Técnica"
          >
            <option value="">Todas as técnicas</option>
            {catalog.map((t) => (
              <option key={t.key} value={t.key}>
                Com {t.label}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            style={inputStyle}
            value={validity}
            onChange={(e) => setValidity(e.target.value)}
            aria-label="Validade"
          >
            <option value="">Válidas, pendentes e inválidas</option>
            <option value="true">Só válidas</option>
            <option value="null">Só pendentes</option>
            <option value="false">Só inválidas</option>
          </select>
          <select
            className={inputClass}
            style={inputStyle}
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            aria-label="Medições nas médias"
          >
            {MODE_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                Médias: {m.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm" style={muted}>
            <input
              type="checkbox"
              checked={showOthers}
              onChange={(e) => setShowOthers(e.target.checked)}
            />
            Mostrar padrões e outras
          </label>
          {activeFilters > 0 && (
            <Button
              variant="ghost"
              className="justify-self-start"
              onClick={() => {
                setFraction("");
                setTechnique("");
                setValidity("");
                setMode("padrao");
                setShowOthers(false);
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span style={muted}>{filtered.length} amostra(s)</span>
        {view === "valores" && (
          <details className="relative">
            <summary
              className="cursor-pointer rounded-md border px-3 py-1.5"
              style={{ borderColor: "var(--color-border)" }}
            >
              Colunas ({columns.length})
            </summary>
            <div
              className="fixed inset-x-4 z-20 mt-1 max-h-80 overflow-y-auto rounded-md border p-2 shadow-lg md:absolute md:inset-x-auto md:left-0 md:w-72"
              style={card}
            >
              {available.length === 0 && (
                <p style={muted}>Sem valores ainda.</p>
              )}
              {available.map((c) => (
                <label
                  key={c.col}
                  className="flex items-center gap-2 py-1 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={columns.includes(c.col)}
                    onChange={(e) =>
                      setChosen(
                        e.target.checked
                          ? [...columns, c.col]
                          : columns.filter((x) => x !== c.col),
                      )
                    }
                  />
                  {header(c.col)}
                </label>
              ))}
            </div>
          </details>
        )}
        {view === "lista" && (
          <span style={muted}>· toque numa amostra para ver os valores</span>
        )}
      </div>
      <ErrorBox message={error ?? exportError ?? bulkError} />
      {bulkMsg && (
        <p
          className="rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: "#9fd3ae",
            background: "#eef8f1",
            color: "#1b6b34",
          }}
          role="status"
        >
          {bulkMsg}
        </p>
      )}

      {samples === null ? (
        <p style={muted}>Carregando…</p>
      ) : filtered.length === 0 ? (
        <Empty>
          {samples.length
            ? "Nenhuma amostra com esses filtros."
            : "Nenhuma amostra ainda. Comece pela aba Importar."}
        </Empty>
      ) : mobile ? (
        <div className="space-y-2" data-testid="samples-cards">
          {checkboxes && (
            <div className="flex items-center gap-1 text-sm" style={muted}>
              <SelectBox
                checked={allSelected}
                indeterminate={someSelected}
                onChange={toggleAll}
                label="Selecionar todas (filtradas)"
              />
              Selecionar todas ({filtered.length})
            </div>
          )}
          {filtered.map((s) => (
            <div key={s.id} className="flex items-start gap-1">
              {checkboxes && (
                <SelectBox
                  checked={selected.has(s.id)}
                  onChange={(on) => toggle(s.id, on)}
                  label={`Selecionar ${s.code}`}
                />
              )}
              <div className="min-w-0 flex-1">
                <SampleCard
                  s={s}
                  columns={shownCols}
                  techs={techsOf(s)}
                  techniqueLabel={techniqueLabel}
                  header={header}
                  fractionLabel={fractionLabel}
                  onOpen={() => setOpenId(s.id)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="table-wrap rounded-lg border"
          style={card}
          data-testid="samples-table"
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={muted}>
                {checkboxes && (
                  <th className="w-10 px-1 py-0">
                    <SelectBox
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={toggleAll}
                      label="Selecionar todas (filtradas)"
                    />
                  </th>
                )}
                <th className="px-3 py-2 font-medium">Amostra</th>
                <th className="px-3 py-2 font-medium">Fração</th>
                <th className="px-3 py-2 font-medium">Temp.</th>
                {view === "valores" ? (
                  <th className="px-3 py-2 font-medium">Experimento</th>
                ) : (
                  <th className="px-3 py-2 font-medium">Análises</th>
                )}
                <th className="px-3 py-2 font-medium">Validade</th>
                {shownCols.map((c) => (
                  <th
                    key={c}
                    className="px-3 py-2 text-right font-medium whitespace-nowrap"
                  >
                    {header(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-t hover:bg-[var(--color-surface)]"
                  style={{ borderColor: "var(--color-border)" }}
                  onClick={() => setOpenId(s.id)}
                >
                  {checkboxes && (
                    <td className="w-10 px-1 py-0">
                      <SelectBox
                        checked={selected.has(s.id)}
                        onChange={(on) => toggle(s.id, on)}
                        label={`Selecionar ${s.code}`}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {s.code}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fractionLabel(s.fraction)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fmtTemp(s.temperature_c)}
                  </td>
                  {view === "valores" ? (
                    <td className="px-3 py-2 whitespace-nowrap">
                      {s.experiment_code ?? "—"}
                    </td>
                  ) : (
                    <td className="px-3 py-2">
                      <TechChips
                        techs={techsOf(s)}
                        techniqueLabel={techniqueLabel}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <ValidityBadge valid={s.valid} />
                  </td>
                  {shownCols.map((c) => (
                    <td
                      key={c}
                      className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                    >
                      {fmtMeanSd(s.values[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canSelect && selectedIds.length > 0 && (
        <div
          className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border p-2 shadow-lg"
          style={card}
          role="region"
          aria-label="Ações nas amostras selecionadas"
          data-testid="bulk-bar"
        >
          <span className="mr-auto px-1 text-sm font-medium">
            {selectedIds.length} selecionada(s)
          </span>
          <Button disabled={bulkBusy} onClick={() => bulkValidate(true)}>
            Marcar como válida
          </Button>
          <Button disabled={bulkBusy} onClick={() => bulkValidate(false)}>
            Marcar como inválida
          </Button>
          <Button
            variant="danger"
            disabled={bulkBusy}
            onClick={() => setConfirmDelete(selectedIds)}
          >
            Excluir selecionadas
          </Button>
          <Button variant="ghost" onClick={clearSelection}>
            Limpar seleção
          </Button>
        </div>
      )}
      {confirmDelete && (
        <BulkDeleteConfirm
          projectId={project.id}
          ids={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onDone={async (r) => {
            setConfirmDelete(null);
            clearSelection();
            setBulkError(null);
            setBulkMsg(
              `Excluídas ${r.deleted_samples} amostra(s) e ${r.deleted_analyses} medição(ões).`,
            );
            await reload();
          }}
        />
      )}
      {openId !== null && (
        <SampleDetailModal
          projectId={project.id}
          sampleId={openId}
          readOnly={readOnly}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
      {bulk && (
        <BulkCreate
          title="Criar várias amostras"
          path={`/projects/${project.id}/samples/bulk`}
          hint="Cole os códigos, um por linha (ex.: HP300H, HP300E, HP355NBE). Fração, temperatura e experimento são lidos do código; HP320E.1 e HP320E.2 viram a mesma amostra HP320E."
          onClose={() => setBulk(false)}
          onDone={() => {
            setBulk(false);
            reload();
          }}
        />
      )}
      {creating && (
        <NewSample
          projectId={project.id}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** Etiquetas das técnicas que já têm resultado na amostra (visão "Lista"). */
function TechChips({
  techs,
  techniqueLabel,
}: {
  techs: string[];
  techniqueLabel: (t: string) => string;
}) {
  if (!techs.length) return <span style={muted}>sem resultados</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {techs.map((t) => (
        <span
          key={t}
          className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs"
          style={{ background: "var(--color-surface)" }}
        >
          {techniqueLabel(t)}
        </span>
      ))}
    </span>
  );
}

function SampleCard({
  s,
  columns,
  techs,
  techniqueLabel,
  header,
  fractionLabel,
  onOpen,
}: {
  s: SampleRow;
  columns: string[];
  techs: string[];
  techniqueLabel: (t: string) => string;
  header: (c: string) => string;
  fractionLabel: (c: string) => string;
  onOpen: () => void;
}) {
  const shown = columns.filter((c) => s.values[c]);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-lg border p-3 text-left"
      style={card}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{s.code}</span>
        <ValidityBadge valid={s.valid} />
      </div>
      <div className="text-xs" style={muted}>
        {fractionLabel(s.fraction)} · {fmtTemp(s.temperature_c)}
      </div>
      {columns.length === 0 && (
        <div className="mt-2">
          <TechChips techs={techs} techniqueLabel={techniqueLabel} />
        </div>
      )}
      {shown.length > 0 && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {shown.map((c) => (
            <div key={c} className="min-w-0">
              <dt className="truncate" style={muted}>
                {header(c)}
              </dt>
              <dd className="tabular-nums">{fmtMeanSd(s.values[c])}</dd>
            </div>
          ))}
        </dl>
      )}
    </button>
  );
}
