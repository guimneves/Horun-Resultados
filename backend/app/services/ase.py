"""Resultados finais das extrações no ASE 350 e variáveis-resposta do DOE
(pedido do mantenedor, 22/10/2026; especificação em "Solicitação de
desenvolvimento — ASE/DOE").

Regras do pedido:
* Só RESULTADOS FINAIS, já corrigidos pelo branco (nada de pesagens de
  frasco/tampa/papel/célula, "branco aplicado" ou densidades auxiliares).
* Três grupos: principais, complementares e — calculados aqui, nunca
  digitados — eficiências e diagnósticos. Valor ausente é ausente (None),
  nunca zero.
* Rock-Eval NÃO é redigitado: vem da amostra da rocha residual pós-ASE ligada
  à execução (`DoeRun.sample_id`, ou a amostra com o mesmo código) e, para
  reduções/variações, da rocha pré-extração do planejamento. Leituras
  analíticas repetidas da mesma rocha viram a média da amostra (não são
  réplicas independentes); o valor da rocha pré é um só, comum a todas as
  execuções — por isso não é oferecido como variável-resposta sozinho.
* Recuperações (%) comparam métodos; não são "eficiência absoluta".
"""

from __future__ import annotations

import io
import json
import math
import re
from dataclasses import dataclass

from sqlmodel import Session, select

from app.db.models import Analysis, AnalysisValue, DoePlan, DoeRun, Sample
from app.services import doe
from app.services.codes import normalize_code, strip_accents


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    unit: str
    group: str  # principal | complementar | eficiencia | diagnostico | rockeval | rockeval_delta
    short: str = ""


# Digitados (resultados finais)
INPUT_FIELDS: tuple[Field, ...] = (
    Field("m1_mg", "Betume extraído — frasco coletor (M1), corrigido pelo branco", "mg", "principal", "Betume M1"),
    Field("y_m1", "Rendimento de betume (M1, corrigido)", "mg/g", "principal", "Rendimento M1"),
    Field("m6_mg", "Massa removida — rocha pura pré − pós (M6)", "mg", "principal", "Removido M6"),
    Field("m3_mg", "Massa removida — papel + rocha (M3), corrigida", "mg", "principal", "Removido M3"),
    Field("m4_mg", "Massa removida — célula + papel + rocha (M4), corrigida", "mg", "principal", "Removido M4"),
    Field("solvent_ml", "Volume de solvente coletado (medido ou estimado)", "mL", "principal", "Volume de solvente"),
    Field("solvent_specific", "Consumo específico de solvente", "mL/g", "principal", "Consumo específico"),
    Field("time_min", "Tempo total real de extração", "min", "principal", "Tempo total"),
    Field("y_m6", "Rendimento — M6", "mg/g", "complementar", "Rendimento M6"),
    Field("y_m3", "Rendimento — M3 corrigido", "mg/g", "complementar", "Rendimento M3"),
    Field("y_m4", "Rendimento — M4 corrigido", "mg/g", "complementar", "Rendimento M4"),
    Field("solvent_g", "Massa de solvente coletado", "g", "complementar", "Massa de solvente"),
    Field("rock_mass_g", "Massa real de rocha na célula", "g", "complementar", "Massa de rocha"),
)
INPUT_KEYS = tuple(f.key for f in INPUT_FIELDS)
# os que dependem do branco (corrigidos); sem branco, a planilha nova só tem o bruto
BLANK_CORRECTED = ("m1_mg", "y_m1", "m3_mg", "y_m3", "m4_mg", "y_m4")
SOLVENT_KINDS = ("medido", "estimado")

# Calculados a partir dos digitados
DERIVED_FIELDS: tuple[Field, ...] = (
    Field("eff_solvent", "Eficiência de uso do solvente (M1 ÷ volume)", "mg/mL", "eficiencia", "Eficiência do solvente"),
    Field("eff_time", "Eficiência temporal (M1 ÷ tempo total)", "mg/min", "eficiencia", "Eficiência temporal"),
    Field("rec_m6", "Recuperação relativa M1 ÷ M6", "%", "diagnostico", "M1/M6"),
    Field("rec_m3", "Recuperação relativa M1 ÷ M3", "%", "diagnostico", "M1/M3"),
    Field("rec_m4", "Recuperação relativa M1 ÷ M4", "%", "diagnostico", "M1/M4"),
    Field("d_m1_m6", "Diferença M1 − M6", "mg", "diagnostico", "M1 − M6"),
    Field("d_m1_m3", "Diferença M1 − M3", "mg", "diagnostico", "M1 − M3"),
    Field("d_m1_m4", "Diferença M1 − M4", "mg", "diagnostico", "M1 − M4"),
)

# Rock-Eval da rocha residual pós-ASE (catálogo do módulo: técnica rockeval)
ROCKEVAL_PARAMS = (("TOC", "COT", "%"), ("S1", "S1", "mg HC/g"), ("S2", "S2", "mg HC/g"), ("S3", "S3", "mg CO₂/g"),
                   ("Tmax", "Tmax", "°C"), ("HI", "HI", "mg HC/g COT"), ("OI", "OI", "mg CO₂/g COT"), ("PI", "PI", "–"))
ROCKEVAL_FIELDS = tuple(Field(f"re_{k}", f"{label} pós-ASE (Rock-Eval)", unit, "rockeval", f"{label} pós-ASE") for k, label, unit in ROCKEVAL_PARAMS)
DELTA_FIELDS: tuple[Field, ...] = (
    Field("red_S1", "Redução de S1 vs. rocha pré-extração", "%", "rockeval_delta", "Redução de S1"),
    Field("red_S2", "Redução de S2 vs. rocha pré-extração", "%", "rockeval_delta", "Redução de S2"),
    Field("red_TOC", "Redução de COT vs. rocha pré-extração", "%", "rockeval_delta", "Redução de COT"),
    Field("d_Tmax", "Variação de Tmax (pós − pré)", "°C", "rockeval_delta", "ΔTmax"),
)
ALL_FIELDS = INPUT_FIELDS + DERIVED_FIELDS + ROCKEVAL_FIELDS + DELTA_FIELDS
FIELD_BY_KEY = {f.key: f for f in ALL_FIELDS}
GROUP_LABELS = {
    "principal": "Resultados principais",
    "complementar": "Complementares",
    "eficiencia": "Eficiências",
    "diagnostico": "Diagnósticos (comparação entre métodos)",
    "rockeval": "Rock-Eval da rocha pós-ASE",
    "rockeval_delta": "Rock-Eval — antes × depois",
}


class AseError(ValueError):
    """Mensagem em português."""


def _ok(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def clean_results(raw: dict) -> dict:
    """Valores digitados → só os campos conhecidos, números ou ausentes."""
    out: dict = {}
    for key in INPUT_KEYS:
        if key not in raw:
            continue
        v = raw[key]
        if v is None or v == "":
            continue
        if isinstance(v, str):
            try:
                v = float(v.strip().replace(",", "."))
            except ValueError:
                raise AseError(f'{FIELD_BY_KEY[key].label}: "{raw[key]}" não é um número.') from None
        if not _ok(v):
            raise AseError(f"{FIELD_BY_KEY[key].label}: valor inválido.")
        out[key] = float(v)
    kind = raw.get("solvent_ml_kind")
    if kind:
        if kind not in SOLVENT_KINDS:
            raise AseError("Volume de solvente: diga se foi medido ou estimado.")
        out["solvent_ml_kind"] = kind
    # campos que vieram SEM correção do branco (planilha nova, brancos ainda
    # não feitos): o valor bruto entra, marcado, e o aviso aparece na execução
    unc = [k for k in (raw.get("uncorrected") or []) if k in BLANK_CORRECTED and k in out]
    if unc:
        out["uncorrected"] = unc
    return out


def _div(a, b, scale=1.0):
    return a / b * scale if _ok(a) and _ok(b) and b != 0 else None


def derived(r: dict) -> dict:
    m1 = r.get("m1_mg")
    return {
        "eff_solvent": _div(m1, r.get("solvent_ml")),
        "eff_time": _div(m1, r.get("time_min")),
        "rec_m6": _div(m1, r.get("m6_mg"), 100),
        "rec_m3": _div(m1, r.get("m3_mg"), 100),
        "rec_m4": _div(m1, r.get("m4_mg"), 100),
        "d_m1_m6": m1 - r["m6_mg"] if _ok(m1) and _ok(r.get("m6_mg")) else None,
        "d_m1_m3": m1 - r["m3_mg"] if _ok(m1) and _ok(r.get("m3_mg")) else None,
        "d_m1_m4": m1 - r["m4_mg"] if _ok(m1) and _ok(r.get("m4_mg")) else None,
    }


def flags(r: dict, d: dict) -> list[str]:
    """Sinalizações de possíveis inconsistências — só avisam, nunca alteram."""
    out = []
    unc = [k for k in (r.get("uncorrected") or []) if k in r]
    if unc:
        out.append("Sem correção do branco (brancos ainda não lançados): " + ", ".join(FIELD_BY_KEY[k].short for k in unc) + ".")
    for key in ("m1_mg", "m6_mg", "m3_mg", "m4_mg", "solvent_ml", "time_min", "rock_mass_g"):
        if _ok(r.get(key)) and r[key] < 0:
            out.append(f"{FIELD_BY_KEY[key].short} negativo ({r[key]:g}).")
    for key in ("rec_m6", "rec_m3", "rec_m4"):
        v = d.get(key)
        if _ok(v) and v > 110:
            out.append(f"{FIELD_BY_KEY[key].short} = {v:.0f} %: betume no frasco maior que a massa removida — conferir.")
    if _ok(r.get("y_m1")) and _ok(r.get("m1_mg")) and _ok(r.get("rock_mass_g")) and r["rock_mass_g"] > 0:
        calc = r["m1_mg"] / r["rock_mass_g"]
        if abs(calc - r["y_m1"]) > 0.05 * max(abs(calc), 1e-9):
            out.append(f"Rendimento M1 ({r['y_m1']:g} mg/g) não confere com M1 ÷ massa de rocha ({calc:.3g} mg/g).")
    return out


# ------------------------------------------------------------- Rock-Eval


def _sample_means(session: Session, sample_ids: list[int]) -> dict[int, dict[str, float]]:
    """Média de cada parâmetro de Rock-Eval por amostra (medições válidas)."""
    if not sample_ids:
        return {}
    analyses = session.exec(select(Analysis).where(Analysis.sample_id.in_(sample_ids), Analysis.technique == "rockeval")).all()  # type: ignore[union-attr]
    ok = {a.id: a.sample_id for a in analyses if a.valid is not False}
    acc: dict[int, dict[str, list[float]]] = {}
    if ok:
        for v in session.exec(select(AnalysisValue).where(AnalysisValue.analysis_id.in_(list(ok)))):  # type: ignore[union-attr]
            acc.setdefault(ok[v.analysis_id], {}).setdefault(v.parameter, []).append(v.value)
    return {sid: {p: sum(vs) / len(vs) for p, vs in params.items()} for sid, params in acc.items()}


def rockeval_values(post: dict[str, float] | None, pre: dict[str, float] | None) -> dict:
    post = post or {}
    pre = pre or {}
    out = {f"re_{k}": post.get(k) for k, _l, _u in ROCKEVAL_PARAMS}
    if "PI" not in post and _ok(post.get("S1")) and _ok(post.get("S2")) and post["S1"] + post["S2"] > 0:
        out["re_PI"] = post["S1"] / (post["S1"] + post["S2"])

    def red(k):
        a, b = pre.get(k), post.get(k)
        return (a - b) / a * 100 if _ok(a) and _ok(b) and a != 0 else None

    out["red_S1"] = red("S1")
    out["red_S2"] = red("S2")
    out["red_TOC"] = red("TOC")
    out["d_Tmax"] = post["Tmax"] - pre["Tmax"] if _ok(post.get("Tmax")) and _ok(pre.get("Tmax")) else None
    return out


# ------------------------------------------------------------- planejamento


def plan_factors(plan: DoePlan) -> list[dict]:
    return json.loads(plan.factors_json or "[]")


def runs_of(session: Session, plan: DoePlan) -> list[DoeRun]:
    rows = session.exec(select(DoeRun).where(DoeRun.plan_id == plan.id)).all()
    return sorted(rows, key=lambda r: (r.condition == "C", r.condition, r.replicate))


def linked_sample_ids(session: Session, plan: DoePlan, runs: list[DoeRun]) -> dict[int, int | None]:
    """Execução → amostra da rocha pós-ASE: a escolhida, ou a de mesmo código."""
    by_code = {s.code_norm: s.id for s in session.exec(select(Sample).where(Sample.project_id == plan.project_id))}
    return {r.id: r.sample_id or (by_code.get(normalize_code(r.code)) if r.code else None) for r in runs}  # type: ignore[misc]


def run_values(session: Session, plan: DoePlan, runs: list[DoeRun]) -> dict[int, dict]:
    """Todos os valores de cada execução: digitados, calculados e Rock-Eval."""
    links = linked_sample_ids(session, plan, runs)
    ids = [s for s in links.values() if s] + ([plan.pre_sample_id] if plan.pre_sample_id else [])
    means = _sample_means(session, list(set(ids)))
    pre = means.get(plan.pre_sample_id) if plan.pre_sample_id else None
    out = {}
    for r in runs:
        res = json.loads(r.results_json or "{}")
        vals = {k: res.get(k) for k in INPUT_KEYS}
        d = derived(res)
        vals.update(d)
        sid = links.get(r.id)
        vals.update(rockeval_values(means.get(sid) if sid else None, pre))
        out[r.id] = {"values": vals, "solvent_ml_kind": res.get("solvent_ml_kind"), "flags": flags(res, d), "sample_id": sid}
    return out


def _stat(v: list[float]) -> dict:
    n = len(v)
    if n == 0:
        return {"n": 0, "mean": None, "sd": None, "rsd": None}
    mean = sum(v) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in v) / (n - 1)) if n > 1 else None
    rsd = sd / abs(mean) * 100 if sd is not None and mean != 0 else None
    return {"n": n, "mean": mean, "sd": sd, "rsd": rsd}


def summary(session: Session, plan: DoePlan) -> dict:
    """Execuções (réplicas) + médias por condição, como a aba "Médias"."""
    factors = plan_factors(plan)
    runs = runs_of(session, plan)
    values = run_values(session, plan, runs)
    conds = doe.conditions(factors, plan.condition_start) + ([{"code": "C", "coded": {f["letter"]: 0 for f in factors}, "center": True}] if any(r.condition == "C" for r in runs) else [])
    cond_rows = []
    for c in conds:
        rs = [r for r in runs if r.condition == c["code"] and r.valid]
        stats_ = {}
        for f in ALL_FIELDS:
            vs = [values[r.id]["values"].get(f.key) for r in rs]
            stats_[f.key] = _stat([v for v in vs if _ok(v)])
        cond_rows.append({
            "code": c["code"],
            "coded": c["coded"],
            "levels": {f["letter"]: doe.level_text(f, c["coded"][f["letter"]]) for f in factors},
            "n_runs": len([r for r in runs if r.condition == c["code"]]),
            "n_done": len([r for r in rs if has_results(values[r.id])]),
            "stats": stats_,
        })
    available = {f.key: sum(1 for r in runs if r.valid and _ok(values[r.id]["values"].get(f.key))) for f in ALL_FIELDS}
    return {
        "runs": [run_out(r, values[r.id], factors, plan.condition_start) for r in runs],
        "conditions": cond_rows,
        "fields": fields_out(available),
    }


def has_results(v: dict) -> bool:
    return any(_ok(v["values"].get(k)) for k in INPUT_KEYS)


def run_out(r: DoeRun, v: dict, factors: list[dict], start: int = 1) -> dict:
    coded = doe.coded_of(factors, r.condition, start)
    return {
        "id": r.id,
        "condition": r.condition,
        "replicate": r.replicate,
        "label": f"{'Centro' if r.condition == 'C' else r.condition} · R{r.replicate}",
        "code": r.code,
        "coded": coded,
        "levels": {f["letter"]: doe.level_text(f, coded[f["letter"]]) for f in factors},
        "planned_order": r.planned_order,
        "actual_order": r.actual_order,
        "run_date": r.run_date,
        "sample_id": v["sample_id"],
        "sample_linked_by": "escolhida" if r.sample_id else ("código" if v["sample_id"] else None),
        "valid": r.valid,
        "notes": r.notes,
        "values": v["values"],
        "solvent_ml_kind": v["solvent_ml_kind"],
        "flags": v["flags"],
        "done": has_results(v),
        "updated_by": r.updated_by,
    }


def fields_out(available: dict[str, int] | None = None) -> list[dict]:
    return [
        {"key": f.key, "label": f.label, "short": f.short or f.label, "unit": f.unit, "group": f.group,
         "group_label": GROUP_LABELS[f.group], "input": f.key in INPUT_KEYS, "n": (available or {}).get(f.key, 0)}
        for f in ALL_FIELDS
    ]


def observations(session: Session, plan: DoePlan, response: str) -> list[dict]:
    if response not in FIELD_BY_KEY:
        raise AseError("Variável-resposta desconhecida.")
    runs = [r for r in runs_of(session, plan) if r.valid]
    values = run_values(session, plan, runs)
    return [{"condition": r.condition, "y": values[r.id]["values"].get(response), "run": f"{r.condition} · R{r.replicate}"}
            for r in runs if _ok(values[r.id]["values"].get(response))]


# ------------------------------------------------------------- importação da planilha consolidada

_SHEET_REP_RE = re.compile(r"consolidado\s*(?:—|-|–)?\s*(?:replica\s*)?r?\s*(\d+)", re.IGNORECASE)
_COND_RE = re.compile(r"^F\d{2}$")


def _plain(text) -> str:
    return re.sub(r"\s+", " ", strip_accents(str(text or "")).lower()).strip()


def _row_key(section: str, label: str) -> str | None:
    """Rótulo da linha (e a seção em que está) → campo. Só valores finais."""
    s, lab = _plain(section), _plain(label)
    if s.startswith("resultados principais"):
        if "(m1)" in lab and lab.startswith("massa") and "corrigida" in lab and "sem correcao" not in lab:
            return "m1_mg"
        if "(m1)" in lab and lab.startswith("rendimento") and "corrigido" in lab and "sem correcao" not in lab:
            return "y_m1"
        if "(m6)" in lab:
            return "m6_mg"
        if "(m3)" in lab and "corrigida" in lab and "sem correcao" not in lab:
            return "m3_mg"
        if "(m4)" in lab and "corrig" in lab and "sem co" not in lab:
            return "m4_mg"
        if lab.startswith("massa de solvente"):
            return "solvent_g"
        if lab.startswith("volume de solvente"):
            return "solvent_ml"
        if lab.startswith("consumo especifico"):
            return "solvent_specific"
        if lab.startswith("tempo total"):
            return "time_min"
    if s.startswith("dados de base") and lab.startswith("massa real de rocha"):
        return "rock_mass_g"
    if s.startswith("solvente") and lab.startswith("volume lido"):
        return "solvent_ml_measured"
    if s.startswith("metodo 3") and lab.startswith("rendimento corrigido"):
        return "y_m3"
    if s.startswith("metodo 4") and lab.startswith("rendimento corrigido"):
        return "y_m4"
    if s.startswith("metodo 6") and lab == "rendimento":
        return "y_m6"
    return None


_SECTION_HEADS = ("resultados principais", "dados de base", "solvente", "metodo ", "diagnosticos", "eficiencias", "rock-eval", "checagens")


def read_consolidated(content: bytes) -> dict:
    """Planilha de resultados (abas "Consolidado R1", "Consolidado R2"…) →
    {(condição, réplica): {"code": ..., "results": {...}}}. Lê por rótulo; só
    os valores finais (corrigidos); célula com erro (#REF!) ou vazia fica de fora."""
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    except Exception as err:  # noqa: BLE001 — arquivo que não é xlsx
        raise AseError("Não consegui abrir a planilha (.xlsx).") from err
    found: dict[tuple[str, int], dict] = {}
    warnings: list[str] = []
    sheets = 0
    for ws in wb.worksheets:
        m = _SHEET_REP_RE.search(_plain(ws.title))
        if not m:
            continue
        rep = int(m.group(1))
        sheets += 1
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        cols: dict[int, str] = {}
        section = ""
        for row in rows:
            label = row[0] if row else None
            if _plain(label) == "condicao":
                cols = {j: str(v).strip() for j, v in enumerate(row) if isinstance(v, str) and _COND_RE.match(v.strip())}
                continue
            if not cols or label is None:
                continue
            pl = _plain(label)
            if any(pl.startswith(h) for h in _SECTION_HEADS) and all(row[j] is None for j in cols):
                section = pl
                continue
            if pl == "codigo":
                for j, cond in cols.items():
                    if isinstance(row[j], str) and row[j].strip():
                        found.setdefault((cond, rep), {"code": "", "results": {}})["code"] = row[j].strip()
                continue
            key = _row_key(section, str(label))
            if not key:
                continue
            for j, cond in cols.items():
                v = row[j] if j < len(row) else None
                entry = found.setdefault((cond, rep), {"code": "", "results": {}})
                if isinstance(v, str) and v.startswith("#"):
                    warnings.append(f"{ws.title}, {cond}: {FIELD_BY_KEY.get(key.replace('_measured', ''), FIELD_BY_KEY['solvent_ml']).short} com erro na planilha ({v}) — ficou de fora.")
                    continue
                if not _ok(v):
                    continue
                if key == "solvent_ml_measured":
                    entry["results"]["solvent_ml"] = float(v)
                    entry["results"]["solvent_ml_kind"] = "medido"
                elif key == "solvent_ml":
                    if entry["results"].get("solvent_ml_kind") != "medido":
                        entry["results"]["solvent_ml"] = float(v)
                        entry["results"]["solvent_ml_kind"] = "estimado"
                else:
                    entry["results"][key] = float(v)
    if not sheets:
        raise AseError('A planilha não tem abas "Consolidado R1", "Consolidado R2"….')
    return {"entries": found, "warnings": warnings, "sheets": sheets}


# ------------------------------------------------------------- planilha nova (uma linha por extração)
# Modelo de 19/11/2026 ("Planilha_ExtraçãoASE_Resultados"): abas "Experimentos",
# "Experimentos 2.0"… com uma linha por extração — Condição, Réplica, Código do
# experimento, os fatores (Temperatura, Solvente, Ciclos) e, na mesma linha, os
# resultados. Lê pelo título da coluna. Os corrigidos pelo branco têm
# prioridade; enquanto não há branco, entra o bruto, marcado (`uncorrected`).

# título da coluna → (campo, "corrigido" | "bruto" | "")
_EXP_COLUMNS = {
    "Betume M1 corrigido (mg)": ("m1_mg", "corrigido"),
    "Betume extraído — M1 (mg)": ("m1_mg", "bruto"),
    "Rendimento M1 corrigido (mg/g)": ("y_m1", "corrigido"),
    "Rendimento M1 (mg/g)": ("y_m1", "bruto"),
    "M3 corrigido (mg)": ("m3_mg", "corrigido"),
    "Perda papel + rocha — M3 (mg)": ("m3_mg", "bruto"),
    "Rendimento M3 corrigido (mg/g)": ("y_m3", "corrigido"),
    "Rendimento M3 (mg/g)": ("y_m3", "bruto"),
    "M4 corrigido (mg)": ("m4_mg", "corrigido"),
    "Perda célula + papel + rocha — M4 (mg)": ("m4_mg", "bruto"),
    "Rendimento M4 corrigido (mg/g)": ("y_m4", "corrigido"),
    "Rendimento M4 (mg/g)": ("y_m4", "bruto"),
    "Massa removida da rocha pura — M6 (mg)": ("m6_mg", ""),
    "Rendimento M6 (mg/g)": ("y_m6", ""),
    "Volume lido no ASE (mL)": ("solvent_ml_measured", ""),
    "Volume de solvente estimado (mL)": ("solvent_ml", ""),
    "Consumo específico de solvente (mL/g)": ("solvent_specific", ""),
    "Tempo total de extração (min)": ("time_min", ""),
    "Massa de solvente coletado (g)": ("solvent_g", ""),
    "Massa real da rocha (g)": ("rock_mass_g", ""),
}
_EXP_BY_PLAIN = {_plain(k): v for k, v in _EXP_COLUMNS.items()}
_EXP_COND_RE = re.compile(r"^F\d{2}$")
_EXP_ID_COLUMNS = {"condicao", "replica", "situacao"}
_EXP_REP_RE = re.compile(r"^R?\s*(\d+)$", re.IGNORECASE)


def _is_experiments_header(row: list) -> bool:
    plains = {_plain(v) for v in row if isinstance(v, str)}
    return "condicao" in plains and "replica" in plains


def read_experiments(content: bytes) -> dict | None:
    """Planilha nova → {"entries": {(cond, rep): {...}}, ...}; None se o
    arquivo não tem nenhuma aba nesse formato (aí vale o formato antigo)."""
    import openpyxl

    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    except Exception as err:  # noqa: BLE001 — arquivo que não é xlsx
        raise AseError("Não consegui abrir a planilha (.xlsx).") from err
    found: dict[tuple[str, int], dict] = {}
    warnings: list[str] = []
    sheets = 0
    for ws in wb.worksheets:
        header: dict[int, str] | None = None
        for raw_row in ws.iter_rows(values_only=True):
            row = list(raw_row)
            if header is None:
                if _is_experiments_header(row):
                    header = {j: _plain(v) for j, v in enumerate(row) if isinstance(v, str)}
                    # colunas dos fatores: as de identificação antes do código
                    # (Temperatura, Solvente, Ciclos) — só elas são conferidas
                    code_col = next((j for j, n in header.items() if n.startswith("codigo")), max(header) + 1)
                    factor_cols = [n for j, n in header.items() if j < code_col and n not in _EXP_ID_COLUMNS and len(n) > 3]
                    sheets += 1
                continue
            cells = {name: (row[j] if j < len(row) else None) for j, name in header.items()}
            cond = str(cells.get("condicao") or "").strip().upper()
            m = _EXP_REP_RE.match(str(cells.get("replica") or "").strip())
            if not _EXP_COND_RE.match(cond) or not m:
                continue  # linha de fórmulas, vazia ou de total
            rep = int(m.group(1))
            if (cond, rep) in found:
                warnings.append(f"{ws.title}, {cond} R{rep}: já veio da aba {found[(cond, rep)]['sheet']} — ficou de fora.")
                continue
            results: dict = {}
            sources: dict[str, str] = {}
            for name, v in cells.items():
                key, kind = _EXP_BY_PLAIN.get(name, (None, ""))
                if key is None:
                    continue
                if isinstance(v, str) and v.strip().startswith("#"):
                    short = FIELD_BY_KEY[key.replace("_measured", "")].short
                    warnings.append(f"{ws.title}, {cond} R{rep}: {short} com erro na planilha ({v.strip()}) — ficou de fora.")
                    continue
                if not _ok(v):
                    continue
                if key == "solvent_ml_measured":
                    results["solvent_ml"], results["solvent_ml_kind"] = float(v), "medido"
                elif key == "solvent_ml":
                    if results.get("solvent_ml_kind") != "medido":
                        results["solvent_ml"], results["solvent_ml_kind"] = float(v), "estimado"
                elif kind == "bruto":
                    if sources.get(key) != "corrigido":
                        results[key], sources[key] = float(v), "bruto"
                else:
                    results[key] = float(v)
                    if kind:
                        sources[key] = kind
            unc = [k for k in BLANK_CORRECTED if sources.get(k) == "bruto"]
            if unc:
                results["uncorrected"] = unc
            code = cells.get("codigo do experimento")
            found[(cond, rep)] = {
                "code": str(code).strip() if code else "",
                "results": results,
                "sheet": ws.title,
                "levels": {name: cells[name] for name in factor_cols if cells.get(name) is not None},
            }
    if not sheets:
        return None
    return {"entries": found, "warnings": warnings, "sheets": sheets}


def read_results_workbook(content: bytes) -> dict:
    """Planilha nova (abas "Experimentos…") ou a antiga ("Consolidado R1"…)."""
    new = read_experiments(content)
    if new is not None:
        return new
    try:
        return read_consolidated(content)
    except AseError as err:
        if "Consolidado" in str(err):
            raise AseError(
                'A planilha não tem uma aba "Experimentos" (colunas Condição e Réplica) nem abas "Consolidado R1", "Consolidado R2"….'
            ) from err
        raise


_NUM_RE = re.compile(r"-?\d+(?:[.,]\d+)?")


def level_mismatch(factors: list[dict], coded: dict[str, int], levels: dict) -> str | None:
    """A linha da planilha tem os níveis da condição do planejamento? Confere
    cada fator que tem coluna com o mesmo nome (Temperatura, Solvente, Ciclos…);
    devolve a primeira diferença, ou None."""
    for f in factors:
        name = _plain(f["name"])

        def same(header: str) -> bool:  # "temperatura (°c)" ~ "Temperatura"; "ciclos" ~ "Número de ciclos"
            base = header.split("(")[0].strip()
            return bool(name and base) and (base == name or name.endswith(" " + base) or base.startswith(name + " "))

        col = next((k for k in levels if same(k)), None)
        if col is None:
            continue
        cell, want = levels[col], coded[f["letter"]]
        if f["kind"] == "categorico":
            side = {-1: (f["low"], f.get("low_label")), 1: (f["high"], f.get("high_label"))}[want]
            if _plain(cell) not in {_plain(x) for x in side if x}:
                return f'{f["name"]} = "{cell}" na planilha, mas o planejamento tem "{doe.level_text(f, want)}"'
            continue
        if _ok(cell):
            num = float(cell)
        else:
            m = _NUM_RE.search(str(cell))
            if not m:
                continue
            num = float(m.group(0).replace(",", "."))
        if abs(num - float(doe.level_value(f, want))) > 1e-9:
            return f'{f["name"]} = {cell} na planilha, mas o planejamento tem {doe.level_text(f, want)}'
    return None


def merge_results(current: dict, new: dict, overwrite: bool) -> tuple[dict, list[str]]:
    """Junta o que veio da planilha com o que a execução já tem. Sem
    `overwrite`, só preenche o vazio — mas um valor SEM correção do branco é
    trocado pelo corrigido quando ele chega (e o aviso some)."""
    cur_unc = set(current.get("uncorrected") or [])
    new_unc = set(new.get("uncorrected") or [])
    merged = {k: v for k, v in current.items() if k != "uncorrected"}
    unc = set(cur_unc)
    filled = []
    for k in INPUT_KEYS:
        if k not in new:
            continue
        replace_raw = k in cur_unc and k not in new_unc
        if overwrite or k not in current or replace_raw:
            merged[k] = new[k]
            filled.append(k)
            unc.discard(k)
            if k in new_unc:
                unc.add(k)
            if k == "solvent_ml" and new.get("solvent_ml_kind"):
                merged["solvent_ml_kind"] = new["solvent_ml_kind"]
    if unc & set(merged):
        merged["uncorrected"] = sorted(unc & set(merged))
    return merged, filled
