"""Consultas de resultados: tabela de amostras, séries por temperatura e
detalhe de uma amostra (ESPECIFICACAO.md, seção 6).

Validade (`mode`):
* "padrao" (padrão das telas): tudo, menos o que foi marcado INVÁLIDO
  (amostra ou medição); pendentes entram;
* "validas": só amostras marcadas VÁLIDAS (e medições não inválidas) — o
  "banco de experimentos válidos";
* "todas": inclui as inválidas.

Média ± desvio: média de TODOS os valores da amostra para o parâmetro (todas
as réplicas de análise de todas as alíquotas); desvio-padrão amostral (n-1).
Na série, cada ponto (fração × temperatura × atmosfera) junta as amostras:
com 2+ amostras (ex. réplicas A/B/C do experimento), média ± desvio das
médias das amostras; com uma só, a média e o desvio das réplicas dela.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass

from sqlmodel import Session, select

from app.db.models import Analysis, AnalysisValue, Experiment, FractionType, Sample, SampleAlias, StoredFile
from app.services.catalog import TECHNIQUES

MODES = ("padrao", "validas", "todas")


def mean_sd(values: list[float]) -> dict:
    n = len(values)
    if n == 0:
        return {"mean": None, "sd": None, "n": 0}
    mean = sum(values) / n
    sd = math.sqrt(sum((v - mean) ** 2 for v in values) / (n - 1)) if n > 1 else None
    return {"mean": mean, "sd": sd, "n": n}


def _sample_ok(sample: Sample, mode: str) -> bool:
    if mode == "todas":
        return True
    if mode == "validas":
        return sample.valid is True
    return sample.valid is not False


def _analysis_ok(analysis: Analysis, mode: str) -> bool:
    return mode == "todas" or analysis.valid is not False


@dataclass
class Loaded:
    samples: dict[int, Sample]
    experiments: dict[int, Experiment]
    analyses: dict[int, Analysis]
    values: list[AnalysisValue]


def load(session: Session, project_id: int, sample_ids: list[int] | None = None, technique: str | None = None) -> Loaded:
    q = select(Sample).where(Sample.project_id == project_id)
    if sample_ids:
        q = q.where(Sample.id.in_(sample_ids))  # type: ignore[union-attr]
    samples = {s.id: s for s in session.exec(q)}
    experiments = {e.id: e for e in session.exec(select(Experiment).where(Experiment.project_id == project_id))}
    aq = select(Analysis).where(Analysis.project_id == project_id)
    if technique:
        aq = aq.where(Analysis.technique == technique)
    analyses = {a.id: a for a in session.exec(aq) if a.sample_id in samples}
    values: list[AnalysisValue] = []
    ids = list(analyses)
    for start in range(0, len(ids), 500):
        chunk = ids[start : start + 500]
        values.extend(session.exec(select(AnalysisValue).where(AnalysisValue.analysis_id.in_(chunk))))  # type: ignore[union-attr]
    return Loaded(samples, experiments, analyses, _with_edited_gas(samples, experiments, analyses, values))


def _with_edited_gas(
    samples: dict[int, Sample], experiments: dict[int, Experiment], analyses: dict[int, Analysis], values: list[AnalysisValue]
) -> list[AnalysisValue]:
    """Massa de gás digitada em Condições experimentais (`Experiment.gas_mass_g`)
    vale em TODO lugar (decisão de 08/10/2026): substitui o `gas_mass_g` da
    planilha nas medições `gas_balanco` da corrida e recalcula o gás por massa
    de rocha. Cópias soltas — o valor importado no banco não muda."""
    edited: dict[int, float] = {}
    for a in analyses.values():
        if a.technique != "gas_balanco":
            continue
        exp_id = samples[a.sample_id].experiment_id
        exp = experiments.get(exp_id) if exp_id else None
        if exp is not None and exp.gas_mass_g is not None:
            edited[a.id] = exp.gas_mass_g
    if not edited:
        return values
    initial: dict[tuple[int, int | None], float] = {}
    for v in values:
        if v.analysis_id in edited and v.parameter == "initial_mass_g" and v.value:
            initial[(v.analysis_id, v.replicate)] = v.value
    out: list[AnalysisValue] = []
    seen: set[int] = set()
    for v in values:
        if v.analysis_id not in edited or v.parameter not in ("gas_mass_g", "gas_yield_mg_g"):
            out.append(v)
            continue
        gas = edited[v.analysis_id]
        if v.parameter == "gas_mass_g":
            seen.add(v.analysis_id)
            out.append(AnalysisValue(analysis_id=v.analysis_id, parameter="gas_mass_g", value=gas, unit=v.unit, replicate=v.replicate))
        else:
            mass = initial.get((v.analysis_id, v.replicate)) or initial.get((v.analysis_id, None))
            if mass:
                out.append(AnalysisValue(analysis_id=v.analysis_id, parameter="gas_yield_mg_g", value=1000 * gas / mass, unit=v.unit, replicate=v.replicate))
    for analysis_id, gas in edited.items():
        if analysis_id in seen:
            continue
        # planilha sem "Massa de gás gerada" calculada: o valor digitado entra
        out.append(AnalysisValue(analysis_id=analysis_id, parameter="gas_mass_g", value=gas, unit="g"))
        mass = initial.get((analysis_id, None))
        if mass and not any(v.analysis_id == analysis_id and v.parameter == "gas_yield_mg_g" for v in out):
            out.append(AnalysisValue(analysis_id=analysis_id, parameter="gas_yield_mg_g", value=1000 * gas / mass, unit="mg/g"))
    return out


def _values_by_sample(data: Loaded, mode: str) -> dict[int, dict[str, list[float]]]:
    out: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for v in data.values:
        a = data.analyses[v.analysis_id]
        if not _analysis_ok(a, mode):
            continue
        out[a.sample_id][f"{a.technique}.{v.parameter}"].append(v.value)
    return out


def sample_row(sample: Sample, experiments: dict[int, Experiment]) -> dict:
    exp = experiments.get(sample.experiment_id) if sample.experiment_id else None
    return {
        "id": sample.id,
        "code": sample.code,
        "fraction": sample.fraction,
        "temperature_c": sample.temperature_c,
        "experiment_id": sample.experiment_id,
        "experiment_code": exp.code if exp else None,
        "atmosphere": exp.atmosphere if exp else None,
        "replicate_letter": exp.replicate_letter if exp else None,
        "kind": sample.kind,
        "notes": sample.notes,
        "valid": sample.valid,
        "validated_by": sample.validated_by,
        "validated_at": sample.validated_at.isoformat() if sample.validated_at else None,
    }


def table(session: Session, project_id: int, mode: str = "padrao") -> dict:
    data = load(session, project_id)
    by_sample = _values_by_sample(data, mode)
    techniques_by_sample: dict[int, set[str]] = defaultdict(set)
    for a in data.analyses.values():
        techniques_by_sample[a.sample_id].add(a.technique)
    rows = []
    for s in sorted(data.samples.values(), key=lambda s: (s.kind != "sample", s.temperature_c is None, s.temperature_c or 0, s.code)):
        row = sample_row(s, data.experiments)
        row["techniques"] = sorted(techniques_by_sample.get(s.id, set()))
        row["values"] = {k: mean_sd(v) for k, v in by_sample.get(s.id, {}).items()}
        rows.append(row)
    return {"samples": rows}


def _fraction_groups(session: Session) -> dict[str, FractionType]:
    return {f.code: f for f in session.exec(select(FractionType))}


def series(
    session: Session,
    project_id: int,
    technique: str,
    parameter: str,
    mode: str = "padrao",
    split_replicates: bool = False,
) -> dict:
    data = load(session, project_id, technique=technique)
    fractions = _fraction_groups(session)
    key = f"{technique}.{parameter}"
    by_sample = _values_by_sample(data, mode)
    atmospheres = {e.atmosphere for e in data.experiments.values() if e.atmosphere}

    groups: dict[tuple, dict] = {}
    baseline: list[dict] = []
    for s in data.samples.values():
        vals = by_sample.get(s.id, {}).get(key)
        if not vals or not _sample_ok(s, mode):
            continue
        frac = fractions.get(s.fraction)
        if frac is not None and not frac.in_series:
            continue
        stats = mean_sd(vals)
        if s.temperature_c is None:
            # rocha original (sem temperatura): linha de referência
            baseline.append({"sample_id": s.id, "code": s.code, "fraction": s.fraction, **stats})
            continue
        group_code = (frac.series_group or frac.code) if frac else s.fraction
        exp = data.experiments.get(s.experiment_id) if s.experiment_id else None
        # atmosfera só separa linhas quando o projeto tem mais de uma
        atm = ((exp.atmosphere if exp else "") or "atmosfera não informada") if len(atmospheres) > 1 else ""
        letter = (exp.replicate_letter if exp else "") if split_replicates else ""
        gk = (group_code, atm, letter)
        g = groups.setdefault(gk, {"points": defaultdict(list)})
        g["points"][s.temperature_c].append({"sample_id": s.id, "code": s.code, "values": vals, **stats})

    out_series = []
    for (group_code, atm, letter), g in sorted(groups.items(), key=lambda kv: (fractions[kv[0][0]].sort if kv[0][0] in fractions else 99, kv[0][1], kv[0][2])):
        frac = fractions.get(group_code)
        members = sorted({c for c, f in fractions.items() if (f.series_group or c) == group_code})
        label = frac.label if frac else group_code
        if atm:
            label += f" · {atm}"
        if letter:
            label += f" · réplica {letter}"
        points = []
        for temp, entries in sorted(g["points"].items()):
            if len(entries) > 1:
                stats = mean_sd([e["mean"] for e in entries])
            else:
                stats = {k: entries[0][k] for k in ("mean", "sd")} | {"n": entries[0]["n"]}
            points.append(
                {
                    "temperature_c": temp,
                    **stats,
                    "n_samples": len(entries),
                    "n_values": sum(e["n"] for e in entries),
                    "samples": [{"id": e["sample_id"], "code": e["code"], "mean": e["mean"], "sd": e["sd"], "n": e["n"]} for e in entries],
                }
            )
        out_series.append(
            {"key": "|".join([group_code, atm, letter]), "fraction": group_code, "fractions": members, "atmosphere": atm, "replicate_letter": letter, "label": label, "points": points}
        )
    param = next((p for p in TECHNIQUES.get(technique, {}).get("params", []) if p.key == parameter), None)
    return {
        "technique": technique,
        "parameter": parameter,
        "label": param.label if param else parameter,
        "unit": param.unit if param else "",
        "mode": mode,
        "series": out_series,
        "baseline": baseline,
    }


def sample_detail(session: Session, sample: Sample, mode: str = "todas") -> dict:
    data = load(session, sample.project_id, sample_ids=[sample.id])
    files = {f.id: f for f in session.exec(select(StoredFile).where(StoredFile.project_id == sample.project_id))}
    vals_by_analysis: dict[int, list[AnalysisValue]] = defaultdict(list)
    for v in data.values:
        vals_by_analysis[v.analysis_id].append(v)
    analyses = []
    per_aliquot: dict[tuple[str, int | None], dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for a in sorted(data.analyses.values(), key=lambda a: (a.technique, a.aliquot or 0, a.replicate or 0, a.id)):
        vs = vals_by_analysis.get(a.id, [])
        if _analysis_ok(a, mode):
            for v in vs:
                per_aliquot[(a.technique, a.aliquot)][v.parameter].append(v.value)
        f = files.get(a.source_file_id) if a.source_file_id else None
        analyses.append(
            {
                "id": a.id,
                "technique": a.technique,
                "source_name": a.source_name,
                "replicate": a.replicate,
                "aliquot": a.aliquot,
                "analyzed_at": a.analyzed_at,
                "instrument": a.instrument,
                "method": a.method,
                "valid": a.valid,
                "validated_by": a.validated_by,
                "file": {"id": f.id, "filename": f.filename} if f else None,
                "has_data": a.data_json is not None,
                "values": [{"parameter": v.parameter, "replicate": v.replicate, "value": v.value, "unit": v.unit} for v in vs],
            }
        )
    aliquots = [
        {"technique": tech, "aliquot": aliquot, "values": {k: mean_sd(v) for k, v in params.items()}}
        for (tech, aliquot), params in sorted(per_aliquot.items(), key=lambda kv: (kv[0][0], kv[0][1] or 0))
        if aliquot is not None
    ]
    by_sample = _values_by_sample(data, mode)
    aliases = session.exec(select(SampleAlias).where(SampleAlias.sample_id == sample.id)).all()
    return {
        **sample_row(sample, data.experiments),
        "values": {k: mean_sd(v) for k, v in by_sample.get(sample.id, {}).items()},
        "analyses": analyses,
        "aliquots": aliquots,
        "aliases": [{"id": a.id, "alias": a.alias, "created_by": a.created_by} for a in aliases],
    }


def analysis_data(session: Session, project_id: int, technique: str, sample_ids: list[int], mode: str = "padrao") -> list[dict]:
    """Curvas/tabelas (JSON) das medições de uma técnica — pirogramas,
    picos de Py-GC-MS, composição do gás."""
    data = load(session, project_id, sample_ids=sample_ids or None, technique=technique)
    out = []
    for a in sorted(data.analyses.values(), key=lambda a: (a.sample_id, a.aliquot or 0, a.replicate or 0)):
        if a.data_json is None or not _analysis_ok(a, mode):
            continue
        s = data.samples[a.sample_id]
        if not _sample_ok(s, mode):
            continue
        out.append(
            {
                "analysis_id": a.id,
                "sample_id": s.id,
                "sample_code": s.code,
                "source_name": a.source_name,
                "replicate": a.replicate,
                "aliquot": a.aliquot,
                "data": json.loads(a.data_json),
            }
        )
    return out
