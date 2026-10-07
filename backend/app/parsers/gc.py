"""Cromatografia do gás — planilhas do laboratório (ESPECIFICACAO.md, 3.4).

* "... Dados FID ....xlsx" / "... Dados TCD ....xlsx" (aba "Dados FID"/"Dados TCD"):
  B2 = amostra; cabeçalho "ID | Átomos Carbono | Analito | TR | Replicatas..."
  e, na linha de baixo, "Rep_1 | Rep_2 | Rep_3 | Media | DSV%" para a área e
  para "%Ai = Ai/ATOTAL * 100". Linha sem analito = fim.
* "... Planilha cálculo gás.xlsx" (aba "Dados FID-TCD"): condições do
  experimento (rótulo na coluna A, valor na B, unidade na C), resultados
  (rótulo na I, valor na K, unidade na L) e composição média FID (A–C) e TCD
  (D–E) a partir da linha "Componente". Tudo lido por RÓTULO.

O código do experimento vem da pasta (dentro do .zip), do nome do arquivo e
da célula da planilha — nessa ordem de confiança (a célula às vezes vem com
"EXPXXXXX" ou com o código de outro experimento).
"""

from __future__ import annotations

import re

from app.parsers.common import ExperimentInfo, ParseError, ParseResult, Record, Value, clean_label, to_float
from app.services.codes import (
    FRACTION_GAS,
    atmosphere_from_gas_name,
    experiment_code_from_text,
    normalize_code,
    parse_experiment_code,
    strip_accents,
)

_CARBON_NAMES = [
    ("metano", 1),
    ("eteno", 2),
    ("etileno", 2),
    ("etano", 2),
    ("propeno", 3),
    ("propileno", 3),
    ("propano", 3),
    ("buteno", 4),
    ("butano", 4),
    ("pentano", 5),
    ("penteno", 5),
    ("hexano", 6),
    ("hexeno", 6),
    ("heptano", 7),
    ("octano", 8),
]


def carbon_number(name, declared=None) -> int | str | None:
    """Nº de carbonos do componente (ou "H2"/"CO2")."""
    if isinstance(declared, (int, float)) and not isinstance(declared, bool):
        return int(declared)
    text = strip_accents(clean_label(name)).lower()
    decl = clean_label(declared).upper() if declared else ""
    for gas in ("H2", "CO2", "CO", "N2", "O2"):
        if decl == gas or text.upper() == gas:
            return gas
    m = re.match(r"^c\s*(\d+)", text)
    if m:
        return int(m.group(1))
    for key, n in _CARBON_NAMES:
        if key in text:
            return n
    return None


def group_of(carbon) -> str | None:
    if carbon in ("H2", "CO2"):
        return str(carbon)
    if isinstance(carbon, int):
        return f"C{carbon}" if carbon < 5 else "C5p"
    return None


def _experiment_code(path_hint: str, filename: str, cell) -> tuple[str | None, list[str]]:
    warnings: list[str] = []
    folders = [p for p in re.split(r"[\\/]", path_hint or "") if p]
    chosen = experiment_code_from_text(*reversed(folders), filename, clean_label(cell) if cell else None)
    cell_code = experiment_code_from_text(clean_label(cell)) if cell else None
    folder_code = experiment_code_from_text(*reversed(folders)) if folders else None
    file_code = experiment_code_from_text(filename)
    if folder_code and file_code and folder_code != file_code:
        warnings.append(f"A pasta indica {folder_code} e o nome do arquivo indica {file_code} — usei {chosen}; confira na prévia.")
    if chosen and cell and cell_code != chosen:
        warnings.append(
            f"A célula da amostra diz \"{clean_label(cell)}\", mas a pasta/nome do arquivo indica {chosen} — usei {chosen}; confira."
        )
    return chosen, warnings


def _experiment_info(code: str) -> ExperimentInfo:
    parts = parse_experiment_code(code)
    return ExperimentInfo(
        code=code,
        temperature_c=parts["temperature_c"],
        atmosphere=parts["atmosphere"],
        replicate_letter=parts["replicate_letter"],
    )


# ---------------------------------------------------------------- FID / TCD


def parse_detector(wb, sheet_name: str, filename: str, path_hint: str) -> ParseResult:
    detector = "FID" if "FID" in sheet_name.upper() else "TCD"
    technique = "gc_fid" if detector == "FID" else "gc_tcd"
    ws = wb[sheet_name]
    rows = [list(r) for r in ws.iter_rows(min_row=1, max_row=min(ws.max_row or 200, 300), values_only=True)]
    result = ParseResult(technique, f"GC-{detector} — planilha \"Dados {detector}\"")

    cell = None
    for row in rows[:6]:
        if row and clean_label(row[0]).upper().startswith("AMOSTRA"):
            cell = row[1] if len(row) > 1 else None
    header_i = next(
        (i for i, r in enumerate(rows) if r and clean_label(r[0]) == "ID" and any(clean_label(c) == "Analito" for c in r)),
        None,
    )
    if header_i is None or header_i + 1 >= len(rows):
        raise ParseError(f"Não achei o cabeçalho \"ID | Átomos Carbono | Analito\" na aba \"{sheet_name}\".")
    head, sub = rows[header_i], rows[header_i + 1]
    col_name = next(i for i, c in enumerate(head) if clean_label(c) == "Analito")
    col_carbon = next((i for i, c in enumerate(head) if "carbono" in strip_accents(clean_label(c)).lower()), None)
    col_rt = next((i for i, c in enumerate(head) if clean_label(c).upper().startswith("TR")), None)

    def block(start_label: str) -> dict[str, int]:
        start = next((i for i, c in enumerate(head) if clean_label(c).startswith(start_label)), None)
        if start is None:
            return {}
        out: dict[str, int] = {}
        for i in range(start, min(start + 7, len(sub))):
            label = clean_label(sub[i])
            if label and label not in out:
                out[label] = i
        return out

    area = block("Replicatas")
    pct = block("%Ai")
    if not pct:
        raise ParseError(f"A aba \"{sheet_name}\" não tem o bloco \"%Ai = Ai/ATOTAL * 100\".")

    code, warns = _experiment_code(path_hint, filename, cell)
    result.warnings += warns
    if not code:
        raise ParseError(
            "Não consegui descobrir o experimento (HPxxxN<letra>) desta planilha: nem a célula da amostra, "
            "nem o nome do arquivo/pasta trazem o código."
        )

    components = []
    for row in rows[header_i + 2 :]:
        name = clean_label(row[col_name]) if col_name < len(row) else ""
        if not name:
            break
        carbon = carbon_number(name, row[col_carbon] if col_carbon is not None else None)
        reps = [to_float(row[pct[k]]) for k in ("Rep_1", "Rep_2", "Rep_3") if k in pct]
        components.append(
            {
                "name": name,
                "carbon": carbon,
                "group": group_of(carbon),
                "rt_min": to_float(row[col_rt]) if col_rt is not None else None,
                "area_mean": to_float(row[area["Media"]]) if "Media" in area else None,
                "pct_mean": to_float(row[pct["Media"]]) if "Media" in pct else None,
                "pct_reps": reps,
            }
        )
    if not components:
        raise ParseError(f"A aba \"{sheet_name}\" não tem nenhum analito.")

    values: list[Value] = []
    n_reps = max(len(c["pct_reps"]) for c in components)
    for rep in range(n_reps):
        sums: dict[str, float] = {}
        for comp in components:
            v = comp["pct_reps"][rep] if rep < len(comp["pct_reps"]) else None
            if v is None or comp["group"] is None:
                continue
            sums[comp["group"]] = sums.get(comp["group"], 0.0) + v
        for group, total in sums.items():
            values.append(Value(f"pct_{group}", round(total, 6), "% área", rep + 1))
    unknown = [c["name"] for c in components if c["group"] is None]
    if unknown:
        result.warnings.append(f"Componentes sem nº de carbonos reconhecido (fora dos grupos): {', '.join(unknown)}.")

    result.records.append(
        Record(
            key=normalize_code(code),
            raw_name=code,
            technique=technique,
            instrument=f"GC-{detector}",
            values=values,
            data={"components": components},
            extra={"sheet_sample_cell": clean_label(cell) if cell else ""},
            code_hint=code,
            fraction_hint=FRACTION_GAS,
            experiment=_experiment_info(code),
        )
    )
    return result


# ---------------------------------------------------------- planilha de gás


def _norm(label) -> str:
    return re.sub(r"[^a-z0-9%]+", " ", strip_accents(clean_label(label)).lower()).strip()


def _find(block: dict[str, dict], *words: str) -> dict | None:
    for label, entry in block.items():
        norm = _norm(label)
        if all(w in norm for w in words):
            return entry
    return None


def parse_gas_balance(wb, sheet_name: str, filename: str, path_hint: str) -> ParseResult:
    ws = wb[sheet_name]
    rows = [list(r) + [None] * 14 for r in ws.iter_rows(min_row=1, max_row=min(ws.max_row or 200, 300), values_only=True)]
    result = ParseResult("gas_balanco", "Planilha cálculo gás — aba \"Dados FID-TCD\"")
    left: dict[str, dict] = {}
    right: dict[str, dict] = {}
    comp_i = None
    for i, row in enumerate(rows):
        a = clean_label(row[0])
        if a == "Componente":
            comp_i = i
            break
        if a and row[1] is not None and not a.isupper():
            left.setdefault(a.rstrip(": →").strip(), {"value": row[1], "unit": clean_label(row[2])})
    for row in rows:
        label = clean_label(row[8])
        if label and row[10] is not None:
            suffix = clean_label(row[9])
            key = f"{label} ({suffix})" if suffix else label
            right.setdefault(key, {"value": row[10], "unit": clean_label(row[11])})
    if not left and not right:
        raise ParseError("A aba \"Dados FID-TCD\" não tem os rótulos esperados (condições e resultados do experimento).")

    fid: list[dict] = []
    tcd: list[dict] = []
    if comp_i is not None:
        for row in rows[comp_i + 1 :]:
            a, d = clean_label(row[0]), clean_label(row[3])
            if not a and not d:
                break
            if a and to_float(row[1]) is not None:
                carbon = carbon_number(a)
                fid.append({"name": a, "carbon": carbon, "group": group_of(carbon), "mix_pct": to_float(row[1]), "hc_pct": to_float(row[2])})
            if d and to_float(row[4]) is not None:
                carbon = carbon_number(d, d if d in ("H2", "CO2") else None)
                tcd.append({"name": d, "carbon": carbon, "group": group_of(carbon), "mix_pct": to_float(row[4])})
    else:
        result.warnings.append("Não achei a linha \"Componente\" — composição do gás não lida.")

    exp_cell = (_find(left, "experimento") or {}).get("value")
    code, warns = _experiment_code(path_hint, filename, exp_cell)
    result.warnings += warns
    if not code:
        raise ParseError("Não consegui descobrir o experimento (HPxxxN<letra>) desta planilha de cálculo de gás.")

    def num(entry) -> float | None:
        return to_float(entry["value"]) if entry else None

    if num(_find(right, "massa de gas gerada")) is None:
        result.warnings.append(
            "\"Massa de gás gerada\" está vazia na planilha (fórmula sem valor calculado?) — "
            "abra a planilha no Excel, salve e importe de novo."
        )

    initial_mass = num(_find(left, "massa", "inicial", "amostra"))
    gas_mass = num(_find(right, "massa de gas gerada"))
    weighed = num(_find(left, "massa de gas apos pesagem"))
    closure = num(_find(right, "fechamento", "pressao"))
    values: list[Value] = []
    for key, value, unit in (
        ("initial_mass_g", initial_mass, "g"),
        ("gas_mass_g", gas_mass, "g"),
        ("weighed_gas_g", weighed, "g"),
        ("pressure_closure_pct", closure, "%"),
    ):
        if value is not None:
            values.append(Value(key, value, unit))

    # composição normalizada (sem o gás de enchimento): H2 e CO2 do TCD,
    # hidrocarbonetos da mistura do FID (ou do TCD, se o FID faltar)
    groups: dict[str, float] = {}
    for comp in tcd:
        if comp["group"] in ("H2", "CO2"):
            groups[comp["group"]] = groups.get(comp["group"], 0.0) + comp["mix_pct"]
    hc_source = fid if fid else [c for c in tcd if c["group"] not in ("H2", "CO2")]
    for comp in hc_source:
        if comp["group"] and comp["group"] not in ("H2", "CO2"):
            groups[comp["group"]] = groups.get(comp["group"], 0.0) + comp["mix_pct"]
    total = sum(groups.values())
    if total > 0:
        for group, value in groups.items():
            values.append(Value(f"comp_{group}", round(100 * value / total, 6), "%"))

    gas_name = (_find(left, "selecione o gas") or {}).get("value")
    reactor = (_find(left, "reator utilizado") or {}).get("value")
    info = _experiment_info(code)
    info.reactor = clean_label(reactor) if reactor else None
    info.initial_mass_g = initial_mass
    gas_atm = atmosphere_from_gas_name(gas_name)
    if gas_atm:
        if info.atmosphere and gas_atm != info.atmosphere:
            result.warnings.append(
                f"O código {code} indica atmosfera de {info.atmosphere}, mas a planilha diz \"{clean_label(gas_name)}\" — confira."
            )
        info.atmosphere = info.atmosphere or gas_atm
    info.conditions = {
        "condicoes": {k: {"value": _jsonable(v["value"]), "unit": v["unit"]} for k, v in left.items()},
        "resultados": {k: {"value": _jsonable(v["value"]), "unit": v["unit"]} for k, v in right.items()},
        "gas_enchimento": clean_label(gas_name) if gas_name else "",
    }
    result.records.append(
        Record(
            key=normalize_code(code),
            raw_name=code,
            technique="gas_balanco",
            instrument="Planilha cálculo gás",
            values=values,
            data={"fid": fid, "tcd": tcd},
            code_hint=code,
            fraction_hint=FRACTION_GAS,
            experiment=info,
        )
    )
    return result


def _jsonable(value):
    if isinstance(value, (int, float, str)) or value is None:
        return value
    return str(value)
