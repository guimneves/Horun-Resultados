"""LECO — Resíduo Insolúvel (planilha do laboratório, 09/10/2026).

Uma aba, uma linha por amostra, lida pelo CABEÇALHO (em qualquer das
primeiras linhas):

    Amostra | Cod. Experimento | RI1 | RI2 | RI3 | ... | Média

* `RI1`, `RI2`, `RI3`... = réplicas da medição (quantas vierem); a média e o
  desvio são calculados aqui, a coluna "Média" da planilha é ignorada.
* "Cod. Experimento" (opcional) = experimento de onde a amostra saiu — vira a
  sugestão de experimento quando o próprio código não traz (ex. HP300H).
* Linha sem nenhuma réplica preenchida é ignorada (com aviso); linha sem
  "Amostra" usa o código do experimento como nome.

Códigos escritos de outro jeito viram sugestão no formato do módulo
(app/services/codes.py): "HP355 - SEM EXTRAÇÃO" → HP355SE; "HP300NA_E" /
"HP355NB.E" → HP300NAE / HP355NBE. A pessoa confere tudo na prévia.
"""

from __future__ import annotations

import re

from app.parsers.common import ExperimentInfo, ParseError, ParseResult, Record, Value, to_float
from app.services.codes import parse_experiment_code, parse_sample_code, strip_accents

TECHNIQUE = "leco_ri"
LABEL = "LECO - Resíduo Insolúvel"

_RI_RE = re.compile(r"^R\.?\s*I\.?\s*(\d+)$", re.IGNORECASE)
_SEM_EXTRACAO_RE = re.compile(r"\s*[-–]?\s*SEM\s+EXTRA[CÇ][AÃ]O\s*$", re.IGNORECASE)
_SEPARATED_FRACTION_RE = re.compile(r"^(.*?[A-Z0-9])[\s_.\-]+([A-Z]{1,2})$")


def _norm(cell) -> str:
    return strip_accents(str(cell or "")).strip().lower().replace(".", "").replace(" ", "")


def _header(row: tuple) -> dict | None:
    """Índices das colunas se esta linha for o cabeçalho; senão None."""
    cols: dict = {"ri": []}
    for i, cell in enumerate(row):
        if cell is None:
            continue
        text = str(cell).strip()
        n = _norm(text)
        m = _RI_RE.match(text)
        if m:
            cols["ri"].append((int(m.group(1)), i))
        elif n == "amostra":
            cols["sample"] = i
        elif n.startswith("codexperimento") or n in ("experimento", "codigoexperimento", "codigodoexperimento"):
            cols["experiment"] = i
    return cols if cols["ri"] and "sample" in cols else None


def find_header(ws, max_rows: int = 6) -> tuple[int, dict] | None:
    for r, row in enumerate(ws.iter_rows(min_row=1, max_row=max_rows, values_only=True), start=1):
        cols = _header(row)
        if cols:
            return r, cols
    return None


def is_ri_workbook(wb) -> bool:
    return any(find_header(ws) for ws in wb.worksheets[:3])


def code_suggestion(raw: str) -> str | None:
    """Código no formato do módulo quando a planilha escreve diferente."""
    text = raw.strip()
    if _SEM_EXTRACAO_RE.search(text):
        candidate = _SEM_EXTRACAO_RE.sub("", text).replace(" ", "") + "SE"
        return candidate if parse_sample_code(candidate).recognized else None
    if parse_sample_code(text).recognized:
        return None
    m = _SEPARATED_FRACTION_RE.match(text.upper())
    if m:
        candidate = m.group(1).replace(" ", "") + m.group(2)
        if parse_sample_code(candidate).recognized:
            return candidate
    return None


def parse_workbook(wb, filename: str = "") -> ParseResult:
    result = ParseResult(TECHNIQUE, LABEL)
    for ws in wb.worksheets:
        found = find_header(ws)
        if not found:
            continue
        header_row, cols = found
        reps = sorted(cols["ri"])
        empty = 0
        for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
            def cell(i: int | None, _row=row):
                return _row[i] if i is not None and i < len(_row) else None

            name = str(cell(cols.get("sample")) or "").strip()
            exp = str(cell(cols.get("experiment")) or "").strip()
            values = [
                Value("RI", v, "", n) for n, i in reps if (v := to_float(cell(i))) is not None
            ]
            if not name and not exp:
                continue
            label = name or exp
            if not values:
                empty += 1
                continue
            # só código de experimento de verdade (HP280NB); "Rocha virgem" não é experimento
            exp_info = parse_experiment_code(exp.upper()) if exp else None
            experiment = ExperimentInfo(code=exp_info["code"]) if exp_info and exp_info["temperature_c"] is not None else None
            result.records.append(
                Record(
                    key=f"ri:{ws.title}:{label}",
                    raw_name=label,
                    technique=TECHNIQUE,
                    instrument="LECO",
                    method="Resíduo insolúvel",
                    values=values,
                    extra={"sheet": ws.title, "experiment_in_sheet": exp},
                    code_hint=code_suggestion(label),
                    experiment=experiment,
                )
            )
        if empty:
            result.warnings.append(f"{empty} linha(s) sem nenhuma réplica de RI preenchida foram ignoradas (aba {ws.title}).")
    if not result.records:
        raise ParseError("Nenhuma linha com valores de RI encontrada na planilha de Resíduo Insolúvel.")
    return result
