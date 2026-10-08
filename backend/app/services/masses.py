"""Massas por réplica do experimento (gás gerado, óleo, betume) e a média por
amostra — pedido do mantenedor de 08/10/2026.

* Cada `Experiment` é uma réplica (HP300NA, HP300NB, HP300NC); a "amostra" é o
  grupo de réplicas com a mesma temperatura e atmosfera (HP300N).
* Gás gerado: o valor digitado (`Experiment.gas_mass_g`) substitui o da
  planilha de cálculo de gás; vazio = vale o da planilha. A planilha vem da
  medição `gas_balanco` (parâmetro `gas_mass_g`) ligada ao experimento ou,
  na falta dela, de `conditions_json["resultados"]`. Reimportar a planilha
  nunca mexe no valor digitado (fica em outra coluna).
* Óleo e betume: só digitados.
* Média, desvio-padrão (amostral) e n por massa IGNORAM valores 0 ou vazios.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict

from sqlmodel import Session, select

from app.db.models import Analysis, AnalysisValue, Experiment, Sample
from app.parsers.common import to_float
from app.services.codes import parse_experiment_code, strip_accents
from app.services.results import mean_sd

# (campo, rótulo, de onde vem)
MASSES: tuple[tuple[str, str], ...] = (
    ("gas_mass_g", "Massa de gás gerada"),
    ("oil_mass_g", "Massa de óleo"),
    ("bitumen_mass_g", "Massa de betume"),
)
MASS_FIELDS = tuple(k for k, _ in MASSES)
MAX_MASS_G = 10_000.0  # limite de sanidade (g) para o que se digita

SOURCE_SHEET = "planilha"
SOURCE_EDITED = "editado"


def stats(values: list[float | None]) -> dict:
    """Média ± desvio e n, sem os valores vazios ou iguais a 0."""
    return mean_sd([float(v) for v in values if v is not None and v != 0])


def _norm(label: str) -> str:
    return re.sub(r"[^a-z0-9%]+", " ", strip_accents(str(label)).lower()).strip()


def _gas_from_conditions(exp: Experiment) -> float | None:
    try:
        res = json.loads(exp.conditions_json or "{}").get("resultados") or {}
    except (ValueError, AttributeError):
        return None
    for label, entry in res.items():
        if "massa de gas gerada" in _norm(label) and isinstance(entry, dict):
            return to_float(entry.get("value"))
    return None


def sheet_gas_masses(session: Session, experiments: list[Experiment]) -> dict[int, float]:
    """Massa de gás gerada da planilha, por experimento. Usa a medição
    `gas_balanco` mais recente (não invalidada) das amostras do experimento;
    sem ela, o valor guardado nas condições da corrida."""
    ids = [e.id for e in experiments if e.id is not None]
    out: dict[int, float] = {}
    if ids:
        rows = session.exec(
            select(Sample.experiment_id, Analysis.id, AnalysisValue.value)
            .join(Analysis, Analysis.sample_id == Sample.id)  # type: ignore[arg-type]
            .join(AnalysisValue, AnalysisValue.analysis_id == Analysis.id)  # type: ignore[arg-type]
            .where(
                Sample.experiment_id.in_(ids),  # type: ignore[union-attr]
                Analysis.technique == "gas_balanco",
                Analysis.valid.is_not(False),  # type: ignore[union-attr]
                AnalysisValue.parameter == "gas_mass_g",
            )
        ).all()
        latest: dict[int, int] = {}
        for exp_id, analysis_id, value in rows:
            if exp_id not in latest or analysis_id > latest[exp_id]:
                latest[exp_id] = analysis_id
                out[exp_id] = value
    for exp in experiments:
        if exp.id not in out:
            value = _gas_from_conditions(exp)
            if value is not None:
                out[exp.id] = value  # type: ignore[index]
    return out


def experiment_masses(exp: Experiment, sheet_gas: float | None) -> dict:
    """Campos de massa de uma réplica para a API."""
    if exp.gas_mass_g is not None:
        gas, source = exp.gas_mass_g, SOURCE_EDITED
    elif sheet_gas is not None:
        gas, source = sheet_gas, SOURCE_SHEET
    else:
        gas, source = None, None
    return {
        "gas_mass_effective_g": gas,
        "gas_mass_source": source,
        "gas_mass_sheet_g": sheet_gas,
        "gas_mass_manual_g": exp.gas_mass_g,
        "oil_mass_g": exp.oil_mass_g,
        "bitumen_mass_g": exp.bitumen_mass_g,
    }


def group_label(exps: list[Experiment]) -> str:
    """HP300NA, HP300NB → "HP300N"; sem código reconhecível, temperatura · atmosfera."""
    prefixes = set()
    for e in exps:
        parts = parse_experiment_code(e.code)
        m = re.match(r"^(HP\d{3}[A-Z])[A-Z]", parts["code"] or "")
        prefixes.add(m.group(1) if m else None)
    if len(prefixes) == 1 and None not in prefixes:
        return prefixes.pop()
    e = exps[0]
    temp = f"{e.temperature_c:g} °C" if e.temperature_c is not None else "sem temperatura"
    return f"{temp} · {e.atmosphere}" if e.atmosphere else temp


def groups(session: Session, project_id: int) -> dict:
    """Réplicas agrupadas por amostra (temperatura + atmosfera), com os
    valores de cada réplica e média/desvio/n de cada massa."""
    exps = list(session.exec(select(Experiment).where(Experiment.project_id == project_id)))
    sheet = sheet_gas_masses(session, exps)
    buckets: dict[tuple, list[Experiment]] = defaultdict(list)
    for e in exps:
        buckets[(e.temperature_c, (e.atmosphere or "").strip().lower())].append(e)

    out = []
    for (temp, atm), members in sorted(buckets.items(), key=lambda kv: (kv[0][0] is None, kv[0][0] or 0, kv[0][1])):
        members.sort(key=lambda e: (e.replicate_letter or "", e.code))
        reps = []
        for e in members:
            m = experiment_masses(e, sheet.get(e.id))  # type: ignore[arg-type]
            reps.append(
                {
                    "experiment_id": e.id,
                    "code": e.code,
                    "replicate_letter": e.replicate_letter,
                    "gas_mass_g": m["gas_mass_effective_g"],
                    "gas_mass_source": m["gas_mass_source"],
                    "oil_mass_g": m["oil_mass_g"],
                    "bitumen_mass_g": m["bitumen_mass_g"],
                }
            )
        out.append(
            {
                "key": f"{'' if temp is None else f'{temp:g}'}|{atm}",
                "label": group_label(members),
                "temperature_c": temp,
                "atmosphere": members[0].atmosphere or "",
                "replicates": reps,
                "stats": {f: stats([r[f] for r in reps]) for f in MASS_FIELDS},
            }
        )
    return {
        "masses": [{"key": k, "label": label, "unit": "g"} for k, label in MASSES],
        "atmospheres": sorted({g["atmosphere"] for g in out if g["atmosphere"]}),
        "groups": out,
    }
