"""Gás — "Tabela final consolidada de composição de gás" (modelo alternativo à
"Planilha cálculo gás" de cada experimento; definido pelo mantenedor em
09/10/2026). Um arquivo com TODOS os experimentos.

Abas lidas por RÓTULO:

* **"Detalhe"** (a fonte de verdade — "Tabela final" é só SOMASES dela):
  cabeçalho "Amostra | Linha na planilha original | Componente (original) |
  Componente (agrupado) | MM (g/mol) | mol% (final, sem N2) | % mássico |
  Massa gerada - cromatografia (g) | ... (mg/g amostra) | Massa gerada -
  pressão/pesagem (g) | ... (mg/g amostra)"; uma linha por pico. "Amostra" =
  código do experimento (HP300NA, HP320NA2...). Linhas sem código de
  experimento (notas, "Fonte: ...") são puladas.
* **"Resumo"** (opcional): uma coluna por experimento; "Massa inicial de
  amostra (g)", "Pressão inicial (psi g)", "Pressão de abertura do reator
  (psi g)".

Vira uma medição "Balanço de gás" (`gas_balanco`) por experimento, com a
MESMA chave da "Planilha cálculo gás" (o código do experimento): importar um
e depois o outro atualiza a mesma medição em vez de duplicar.

* `comp_H2`, `comp_CO2`, `comp_C1`... `comp_C5p` = mol% (sem N2) somado por
  grupo (C5+ = todos os componentes com 5 ou mais carbonos), normalizado a 100;
* `gas_mass_g` = soma da massa gerada por cromatografia (g);
  `gas_mass_pressure_g` = soma da massa por pressão/pesagem (g);
* `initial_mass_g` (do Resumo) — com ela, `gas_yield_mg_g` e
  `gas_yield_pressure_mg_g` (mg de gás por g de rocha).
"""

from __future__ import annotations

import re

from app.parsers.common import ParseError, ParseResult, Record, Value, clean_label, to_float
from app.parsers.gc import _experiment_info, carbon_number, group_of
from app.services.codes import FRACTION_GAS, normalize_code, parse_experiment_code, strip_accents

TECHNIQUE = "gas_balanco"
LABEL = "Tabela consolidada de composição de gás (aba \"Detalhe\")"

_COLUMNS = (  # (campo, palavras que o cabeçalho normalizado precisa ter)
    ("sample", ("amostra",)),
    ("group", ("componente", "agrupado")),
    ("original", ("componente", "original")),
    ("mm", ("mm",)),
    ("mol", ("mol",)),
    ("mass_pct", ("massico",)),
    ("crom_g", ("cromatografia", "(g)")),
    ("crom_mgg", ("cromatografia", "mg/g")),
    ("press_g", ("pressao", "(g)")),
    ("press_mgg", ("pressao", "mg/g")),
)


def _norm(cell) -> str:
    return re.sub(r"\s+", " ", strip_accents(clean_label(cell)).lower())


def _header(row) -> dict[str, int] | None:
    names = [_norm(c) for c in row]
    cols: dict[str, int] = {}
    for field, words in _COLUMNS:
        for i, name in enumerate(names):
            if i in cols.values() or not name:
                continue
            if field == "sample" and name != "amostra":
                continue
            if all(w in name for w in words):
                cols[field] = i
                break
    if {"sample", "mol"} <= set(cols) and ("group" in cols or "original" in cols):
        return cols
    return None


def find_detail(wb):
    for ws in wb.worksheets:
        for r, row in enumerate(ws.iter_rows(min_row=1, max_row=5, values_only=True), start=1):
            cols = _header(row)
            if cols:
                return ws, r, cols
    return None


def is_consolidated_gas_workbook(wb) -> bool:
    return find_detail(wb) is not None


def _is_experiment(code: str) -> bool:
    return bool(code) and len(code) <= 30 and parse_experiment_code(code)["temperature_c"] is not None


def _summary(wb) -> dict[str, dict[str, float]]:
    """Aba de resumo: {código: {"initial_mass_g": ..., "p_inicial": ..., "p_abertura": ...}}."""
    out: dict[str, dict[str, float]] = {}
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(min_row=1, max_row=40, values_only=True))
        header = None
        for row in rows:
            codes = [clean_label(c) for c in row]
            if header is None and sum(_is_experiment(c) for c in codes[1:]) >= 1 and _norm(row[0]).startswith("parametro"):
                header = codes
                continue
            if header is None:
                continue
            label = _norm(row[0])
            key = (
                "initial_mass_g"
                if "massa inicial" in label
                else "p_inicial"
                if "pressao inicial" in label
                else "p_abertura"
                if "pressao de abertura" in label
                else None
            )
            if not key:
                continue
            for code, value in zip(header[1:], row[1:]):
                v = to_float(value)
                if _is_experiment(code) and v is not None:
                    out.setdefault(code.upper(), {})[key] = v
        if out:
            return out
    return out


def parse_workbook(wb, filename: str = "") -> ParseResult:
    found = find_detail(wb)
    if not found:
        raise ParseError("Não achei a aba \"Detalhe\" (Amostra | Componente | mol%...) da tabela consolidada de gás.")
    ws, header_row, cols = found
    result = ParseResult(TECHNIQUE, LABEL)
    per_exp: dict[str, dict] = {}
    order: list[str] = []
    skipped = 0
    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        def cell(field, _row=row):
            i = cols.get(field)
            return _row[i] if i is not None and i < len(_row) else None

        code = clean_label(cell("sample")).upper().replace(" ", "")
        if not code:
            continue
        if not _is_experiment(code):
            skipped += 1
            continue
        name = clean_label(cell("group")) or clean_label(cell("original"))
        carbon = carbon_number(name)
        group = group_of(carbon)
        entry = per_exp.get(code)
        if entry is None:
            entry = per_exp[code] = {"groups": {}, "crom_g": 0.0, "press_g": 0.0, "has_crom": False, "has_press": False, "rows": []}
            order.append(code)
        mol = to_float(cell("mol"))
        if group and mol is not None:
            entry["groups"][group] = entry["groups"].get(group, 0.0) + mol
        for field, flag in (("crom_g", "has_crom"), ("press_g", "has_press")):
            v = to_float(cell(field))
            if v is not None:
                entry[field] += v
                entry[flag] = True
        entry["rows"].append(
            {
                "component": name,
                "original": clean_label(cell("original")),
                "group": group,
                "mm": to_float(cell("mm")),
                "mol_pct": mol,
                "mass_pct": to_float(cell("mass_pct")),
                "mass_crom_g": to_float(cell("crom_g")),
                "mass_pressure_g": to_float(cell("press_g")),
            }
        )
    if not per_exp:
        raise ParseError("A aba \"Detalhe\" não tem linhas com código de experimento (ex.: HP300NA).")

    summary = _summary(wb)
    unknown = sorted({r["component"] for e in per_exp.values() for r in e["rows"] if not r["group"] and r["mol_pct"]})
    if unknown:
        result.warnings.append(f"Componente(s) sem grupo conhecido, fora da composição: {', '.join(unknown)}.")

    for code in order:
        entry = per_exp[code]
        info_sum = summary.get(code, {})
        initial = info_sum.get("initial_mass_g")
        values: list[Value] = []
        if initial is not None:
            values.append(Value("initial_mass_g", initial, "g"))
        if entry["has_crom"]:
            values.append(Value("gas_mass_g", round(entry["crom_g"], 8), "g"))
        if entry["has_press"]:
            values.append(Value("gas_mass_pressure_g", round(entry["press_g"], 8), "g"))
            if initial:
                values.append(Value("gas_yield_pressure_mg_g", round(1000 * entry["press_g"] / initial, 6), "mg/g"))
        total = sum(entry["groups"].values())
        if total > 0:
            for group, value in entry["groups"].items():
                values.append(Value(f"comp_{group}", round(100 * value / total, 6), "%"))
        info = _experiment_info(code)
        info.initial_mass_g = initial
        conditions = {k: v for k, v in (("Pressão inicial (psi g)", info_sum.get("p_inicial")), ("Pressão de abertura do reator (psi g)", info_sum.get("p_abertura"))) if v is not None}
        if conditions:
            info.conditions = {"tabela_consolidada": conditions}
        result.records.append(
            Record(
                key=normalize_code(code),
                raw_name=code,
                technique=TECHNIQUE,
                instrument="Tabela consolidada de gás",
                values=values,
                data={"components": entry["rows"]},
                code_hint=code,
                fraction_hint=FRACTION_GAS,
                experiment=info,
            )
        )
    if skipped:
        result.warnings.append(f"{skipped} linha(s) da aba \"{ws.title}\" sem código de experimento (notas) foram puladas.")
    if not summary:
        result.warnings.append("Sem a aba de resumo (massa inicial): o gás por massa de rocha não pôde ser calculado.")
    return result
