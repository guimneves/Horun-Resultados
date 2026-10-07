"""Parâmetros derivados, calculados na importação e gravados como valores
comuns (por réplica, quando a medição tem réplicas):

* CHNSO: razões atômicas H/C = (H%/1,008)/(C%/12,011); N/C, S/C, O/C idem;
* Rock-Eval: PI = S1/(S1+S2);
* GC-FID: umidade do gás = (C2..C5+)/(C1..C5+) × 100;
* Balanço de gás: gás gerado por massa de rocha (mg/g);
* Py-GC-MS: calculados no próprio leitor (precisam dos picos).
"""

from __future__ import annotations

from collections import defaultdict

from app.parsers.common import Record, Value

ATOMIC_MASS = {"H": 1.008, "C": 12.011, "N": 14.007, "S": 32.06, "O": 15.999}


def _by_replicate(values: list[Value]) -> dict[int | None, dict[str, float]]:
    out: dict[int | None, dict[str, float]] = defaultdict(dict)
    for v in values:
        out[v.replicate][v.parameter] = v.value
    return out


def add_derived(record: Record) -> None:
    present = {v.parameter for v in record.values}
    new: list[Value] = []
    for rep, vals in _by_replicate(record.values).items():
        if record.technique == "chnso":
            c = vals.get("C")
            if c and c > 0:
                for el, key in (("H", "HC_at"), ("N", "NC_at"), ("S", "SC_at"), ("O", "OC_at")):
                    if vals.get(el) is not None and key not in present:
                        new.append(Value(key, (vals[el] / ATOMIC_MASS[el]) / (c / ATOMIC_MASS["C"]), "", rep))
        elif record.technique == "rockeval":
            s1, s2 = vals.get("S1"), vals.get("S2")
            if s1 is not None and s2 is not None and s1 + s2 > 0 and "PI" not in present:
                new.append(Value("PI", s1 / (s1 + s2), "", rep))
        elif record.technique == "gc_fid":
            groups = [vals.get(k) for k in ("pct_C1", "pct_C2", "pct_C3", "pct_C4", "pct_C5p")]
            total = sum(g for g in groups if g)
            if total > 0 and "wetness" not in present:
                new.append(Value("wetness", 100 * (total - (groups[0] or 0)) / total, "%", rep))
        elif record.technique == "gas_balanco":
            gas, mass = vals.get("gas_mass_g"), vals.get("initial_mass_g")
            if gas is not None and mass and "gas_yield_mg_g" not in present:
                new.append(Value("gas_yield_mg_g", 1000 * gas / mass, "mg/g", rep))
    record.values.extend(new)
