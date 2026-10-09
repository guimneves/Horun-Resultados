"""Séries → "Artigo": os dados das figuras do Supporting Information do artigo
de hidropirólise (pedido do mantenedor, 09/10/2026), calculados com o que o
projeto tem. Ficam de fora as figuras de FRX, MEV e DRX (não há esses dados).

Uma chamada devolve tudo, por temperatura:

* **gás** (medições "Balanço de gás" das amostras de gás, fração G) —
  rendimento de C1, C2, C3, C4, C5+ (≥ C5), H₂ e CO₂ em µmol por g de COT
  inicial (COT da rocha original no Rock-Eval; sem ele, por g de rocha),
  frações molares de H₂, CH₄ e CO₂ (% sem o gás de enchimento), participação
  do H₂ em C1–C5+ + CO₂ + H₂ (%), massa de gás recuperada e massa de rocha;
  - mols: da tabela consolidada (massa de cada componente ÷ massa molar); sem
    ela, estimados com a massa de gás total e a composição (mol%) por grupo
    (`estimated = True`);
  - experimentos da mesma temperatura (A, B, C...) viram média ± desvio;
* **resíduo** (Rock-Eval da rocha hidropirolisada, linha H/SE) — COT, S1, S2,
  HI, OI e Tmax "depois", e "antes" = rocha original (fração O, sem
  temperatura); consumo de S2 = (S2₀ − S2)/S2₀ × 100 e taxa de transformação
  = (HI₀ − HI)/HI₀ × 100.
"""

from __future__ import annotations

import json
from collections import defaultdict

from sqlmodel import Session

from app.db.models import Experiment
from app.services import results
from app.services.codes import FRACTION_GAS, FRACTION_H, FRACTION_ORIGINAL, strip_accents

GROUPS = ("C1", "C2", "C3", "C4", "C5p", "H2", "CO2")
# massa molar por grupo, para estimar mols só com a composição (mol%)
GROUP_MM = {"H2": 2.016, "CO2": 44.009, "C1": 16.043, "C2": 30.07, "C3": 44.097, "C4": 58.124, "C5p": 72.151}
ROCK_PARAMS = ("TOC", "S1", "S2", "HI", "OI", "Tmax")


def _mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def _stats(xs: list[float]) -> dict:
    return results.mean_sd([x for x in xs if x is not None])


def _water_mass(exp: Experiment | None) -> float | None:
    """Massa de água carregada, se a planilha do experimento trouxer."""
    if exp is None:
        return None
    try:
        cond = json.loads(exp.conditions_json or "{}")
    except ValueError:
        return None
    for block in cond.values():
        if not isinstance(block, dict):
            continue
        for label, entry in block.items():
            text = strip_accents(str(label)).lower()
            if "agua" in text and ("massa" in text or "volume" in text):
                value = entry.get("value") if isinstance(entry, dict) else entry
                try:
                    return float(str(value).replace(",", "."))
                except (TypeError, ValueError):
                    continue
    return None


def _moles(analysis_data: dict | None, values: dict[str, float]) -> tuple[dict[str, float], bool]:
    """Mols por grupo de UMA medição de gás; (mols, estimado?)."""
    comps = (analysis_data or {}).get("components") or []
    out: dict[str, float] = defaultdict(float)
    if comps:
        for row in comps:
            group, mass, mm = row.get("group"), row.get("mass_crom_g"), row.get("mm")
            if group in GROUP_MM and mass and mm:
                out[group] += mass / mm
        crom_total = sum(r.get("mass_crom_g") or 0 for r in comps)
        gas = values.get("gas_mass_g")
        # massa de gás editada em Condições experimentais: escala os componentes
        if out and gas and crom_total and abs(gas - crom_total) > 1e-9:
            factor = gas / crom_total
            out = defaultdict(float, {k: v * factor for k, v in out.items()})
        if out:
            return dict(out), False
    gas = values.get("gas_mass_g")
    comp = {g: values.get(f"comp_{g}") for g in GROUP_MM}
    comp = {g: v for g, v in comp.items() if v}
    if not gas or not comp:
        return {}, True
    mean_mm = sum(v / 100 * GROUP_MM[g] for g, v in comp.items()) / (sum(comp.values()) / 100)
    total = gas / mean_mm
    return {g: total * v / sum(comp.values()) for g, v in comp.items()}, True


def build(session: Session, project_id: int, mode: str = "padrao") -> dict:
    data = results.load(session, project_id)
    by_sample = results._values_by_sample(data, mode)
    samples = {sid: s for sid, s in data.samples.items() if results._sample_ok(s, mode)}

    # COT inicial e Rock-Eval "antes": rocha original
    before_vals: dict[str, list[float]] = defaultdict(list)
    before_codes = []
    for s in samples.values():
        if s.fraction == FRACTION_ORIGINAL and s.temperature_c is None:
            vals = by_sample.get(s.id, {})
            if any(f"rockeval.{p}" in vals for p in ROCK_PARAMS):
                before_codes.append(s.code)
            for p in ROCK_PARAMS:
                before_vals[p] += vals.get(f"rockeval.{p}", [])
    before = {p: _mean(v) for p, v in before_vals.items() if v}
    toc0 = before.get("TOC")

    # ---- gás, por experimento → por temperatura
    gas_by_temp: dict[float, list[dict]] = defaultdict(list)
    analyses_by_sample: dict[int, list] = defaultdict(list)
    for a in data.analyses.values():
        if a.technique == "gas_balanco" and results._analysis_ok(a, mode):
            analyses_by_sample[a.sample_id].append(a)
    values_by_analysis: dict[int, dict[str, float]] = defaultdict(dict)
    for v in data.values:
        if v.analysis_id in data.analyses and data.analyses[v.analysis_id].technique == "gas_balanco":
            values_by_analysis[v.analysis_id][v.parameter] = v.value
    any_estimated = False
    for s in samples.values():
        if s.fraction != FRACTION_GAS or s.temperature_c is None or not analyses_by_sample.get(s.id):
            continue
        a = max(analyses_by_sample[s.id], key=lambda x: x.id)  # medição mais recente da corrida
        vals = values_by_analysis.get(a.id, {})
        try:
            adata = json.loads(a.data_json) if a.data_json else None
        except ValueError:
            adata = None
        moles, estimated = _moles(adata, vals)
        exp = data.experiments.get(s.experiment_id) if s.experiment_id else None
        rock = vals.get("initial_mass_g") or (exp.initial_mass_g if exp else None)
        basis = (rock * toc0 / 100) if (rock and toc0) else rock
        yields = {g: (m * 1e6 / basis) for g, m in moles.items()} if basis else {}
        pool = sum(moles.get(g, 0) for g in GROUPS)
        any_estimated = any_estimated or (estimated and bool(moles))
        gas_by_temp[s.temperature_c].append(
            {
                "code": (exp.code if exp else s.code).replace(" (gás)", ""),
                "yields": yields,
                "mole_pct": {g: vals.get(f"comp_{g}") for g in ("H2", "C1", "CO2")},
                "h2_share": 100 * moles["H2"] / pool if pool and moles.get("H2") is not None else None,
                "gas_mass_g": vals.get("gas_mass_g"),
                "rock_g": rock,
                "water_g": _water_mass(exp),
            }
        )
    gas = []
    for temp in sorted(gas_by_temp):
        runs = gas_by_temp[temp]
        gas.append(
            {
                "temperature_c": temp,
                "experiments": [r["code"] for r in runs],
                "yields": {g: _stats([r["yields"].get(g) for r in runs]) for g in GROUPS},
                "mole_pct": {g: _stats([r["mole_pct"].get(g) for r in runs]) for g in ("H2", "C1", "CO2")},
                "h2_share": _stats([r["h2_share"] for r in runs]),
                "gas_mass_g": _stats([r["gas_mass_g"] for r in runs]),
                "rock_g": _stats([r["rock_g"] for r in runs]),
                "water_g": _stats([r["water_g"] for r in runs]),
            }
        )

    # ---- resíduo (Rock-Eval da rocha hidropirolisada: H e SE)
    residue_by_temp: dict[float, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    residue_codes: dict[float, list[str]] = defaultdict(list)
    h_group = {FRACTION_H, "SE"}
    for s in samples.values():
        if s.fraction not in h_group or s.temperature_c is None:
            continue
        vals = by_sample.get(s.id, {})
        if not any(f"rockeval.{p}" in vals for p in ROCK_PARAMS):
            continue
        residue_codes[s.temperature_c].append(s.code)
        for p in ROCK_PARAMS:
            m = _mean(vals.get(f"rockeval.{p}", []))
            if m is not None:
                residue_by_temp[s.temperature_c][p].append(m)
    residue = []
    for temp in sorted(residue_by_temp):
        after = {p: _stats(v) for p, v in residue_by_temp[temp].items()}
        s2, hi = after.get("S2", {}).get("mean"), after.get("HI", {}).get("mean")
        s20, hi0 = before.get("S2"), before.get("HI")
        residue.append(
            {
                "temperature_c": temp,
                "samples": sorted(residue_codes[temp]),
                "after": after,
                "s2_depletion": 100 * (s20 - s2) / s20 if s20 and s2 is not None else None,
                "transformation_rate": 100 * (hi0 - hi) / hi0 if hi0 and hi is not None else None,
            }
        )

    return {
        "mode": mode,
        "toc0": toc0,
        "toc0_samples": sorted(before_codes),
        "yield_unit": "µmol/g COT₀" if toc0 else "µmol/g rocha",
        "yields_estimated": any_estimated,
        "before": before,
        "gas": gas,
        "residue": residue,
    }

