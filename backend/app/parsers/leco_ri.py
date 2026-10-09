"""LECO — Resíduo Insolúvel: "planilha de massas das amostras" do laboratório
(modelo definido pelo mantenedor em 09/10/2026).

Lida pelo CABEÇALHO, em dois layouts (vale a primeira aba reconhecida,
preferindo o agrupado; a outra aba fica de fora, com aviso):

* **agrupado** (aba "Dados"): uma linha de grupos — "Data", "Amostra",
  "Massa do cadinho (g)", "Massa da amostra (g)", "Massa do cadinho com
  amostra (g)", "Massa após tratamento (g)", "Resíduo Insolúvel",
  "Observações" — e, embaixo, a réplica de cada coluna (1, 2, 3...);
* **plano** (aba "Tabela"): "Data", "Amostra", "Cadinho 1..n", "Amostra 1..n",
  "Após 1..n", "Observações".

Por réplica: resíduo insolúvel (g) = (cadinho + amostra) − massa após o
tratamento — a mesma conta da planilha (coluna "Resíduo Insolúvel" = I − L);
as fórmulas da planilha não são lidas, a conta é refeita com as massas.
Resíduo insolúvel (%) = resíduo (g) ÷ massa da amostra (g) × 100.

Códigos escritos com espaços viram sugestão no formato do módulo
(app/services/codes.py): "HP 320 H" → HP320H, "HP 280 sem extração" →
HP280SE, "HP 280 E1" → HP280E.1 (alíquota). A pessoa confere na prévia.
"""

from __future__ import annotations

import re
from datetime import date, datetime

from app.parsers.common import ParseError, ParseResult, Record, Value, to_float
from app.services.codes import parse_sample_code, strip_accents

TECHNIQUE = "leco_ri"
LABEL = "LECO - Resíduo Insolúvel"

# grupo (texto normalizado do cabeçalho) -> campo
_GROUPS = (
    ("massadocadinhocomamostra", "total"),  # antes de "massadocadinho"
    ("massadocadinho", "crucible"),
    ("massadaamostra", "sample"),
    ("massaaposotratamento", "after"),
    ("massaapostratamento", "after"),
    ("residuoinsoluvel", "ri_sheet"),
)
_FLAT = (("cadinho", "crucible"), ("amostra", "sample"), ("apos", "after"))
_SEM_EXTRACAO_RE = re.compile(r"\s*[-–]?\s*SEM\s+EXTRA[CÇ][AÃ]O\s*$", re.IGNORECASE)
_ALIQUOT_RE = re.compile(r"^(.*?\d[A-Z]*?)(E|H)(\d)$")


def _norm(cell) -> str:
    text = strip_accents(str(cell or "")).lower()
    text = re.sub(r"\(.*?\)", "", text)  # tira "(g)"
    return re.sub(r"[^a-z0-9]", "", text)


def _rep_number(cell) -> int | None:
    n = to_float(cell)
    return int(n) if n is not None and float(n).is_integer() and 0 < n < 50 else None


def _grouped_layout(ws) -> tuple[int, dict] | None:
    """Linha de grupos + linha de réplicas embaixo."""
    rows = list(ws.iter_rows(min_row=1, max_row=8, values_only=True))
    for r, row in enumerate(rows[:-1]):
        names = [_norm(c) for c in row]
        if "amostra" not in names or not any(n.startswith("massadaamostra") for n in names):
            continue
        sub = rows[r + 1]
        cols: dict = {"date": None, "name": None, "notes": None, "reps": {}}
        current = None
        for i in range(max(len(row), len(sub))):
            name = names[i] if i < len(names) else ""
            if name:
                current = None
                if name == "data":
                    cols["date"] = i
                elif name == "amostra":
                    cols["name"] = i
                elif name.startswith("observa"):
                    cols["notes"] = i
                else:
                    current = next((field for key, field in _GROUPS if name.startswith(key)), None)
            rep = _rep_number(sub[i]) if i < len(sub) else None
            if current and rep:
                cols["reps"].setdefault(rep, {})[current] = i
        if cols["name"] is not None and _complete(cols):
            return r + 3, cols  # 1ª linha de dados (1-based)
    return None


def _flat_layout(ws) -> tuple[int, dict] | None:
    for r, row in enumerate(ws.iter_rows(min_row=1, max_row=6, values_only=True), start=1):
        cols: dict = {"date": None, "name": None, "notes": None, "reps": {}}
        for i, cell in enumerate(row):
            name = _norm(cell)
            m = re.match(r"^([a-z]+)(\d+)$", name)
            if name == "data":
                cols["date"] = i
            elif name == "amostra":
                cols["name"] = i
            elif name.startswith("observa"):
                cols["notes"] = i
            elif m:
                field = dict(_FLAT).get(m.group(1))
                if field:
                    cols["reps"].setdefault(int(m.group(2)), {})[field] = i
        if cols["name"] is not None and _complete(cols):
            return r + 1, cols
    return None


def _complete(cols: dict) -> bool:
    return bool(cols["reps"]) and all({"crucible", "sample", "after"} <= set(c) for c in cols["reps"].values())


def find_layout(wb):
    """(aba, 1ª linha de dados, colunas, layout) — agrupado tem preferência."""
    for finder, kind in ((_grouped_layout, "agrupado"), (_flat_layout, "plano")):
        for ws in wb.worksheets:
            found = finder(ws)
            if found:
                return ws, found[0], found[1], kind
    return None


def is_ri_workbook(wb) -> bool:
    return find_layout(wb) is not None


def code_suggestion(raw: str) -> str | None:
    """Código no formato do módulo quando a planilha escreve diferente."""
    text = raw.strip()
    if _SEM_EXTRACAO_RE.search(text):
        candidate = _SEM_EXTRACAO_RE.sub("", text).replace(" ", "").upper() + "SE"
        return candidate if parse_sample_code(candidate).recognized else None
    if parse_sample_code(text).recognized:
        return None
    compact = re.sub(r"[\s_\-]+", "", text.upper())
    m = _ALIQUOT_RE.match(compact)
    candidates = [f"{m.group(1)}{m.group(2)}.{m.group(3)}"] if m else []
    candidates += [compact, re.sub(r"\.(?=[A-Z]+$)", "", compact)]
    for candidate in candidates:
        if candidate != text and parse_sample_code(candidate).recognized:
            return candidate
    return None


def _date(value) -> str:
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    return str(value or "").strip()


def parse_workbook(wb, filename: str = "") -> ParseResult:
    found = find_layout(wb)
    if not found:
        raise ParseError("Planilha de massas do LECO (Resíduo Insolúvel) não reconhecida.")
    ws, first_row, cols, kind = found
    result = ParseResult(TECHNIQUE, LABEL)
    others = [w.title for w in wb.worksheets if w.title != ws.title]
    if others:
        result.warnings.append(f"Lida a aba \"{ws.title}\"; a(s) aba(s) {', '.join(others)} ficou(aram) de fora.")
    incomplete = 0
    for n, row in enumerate(ws.iter_rows(min_row=first_row, values_only=True), start=first_row):
        def cell(i, _row=row):
            return _row[i] if i is not None and i < len(_row) else None

        name = str(cell(cols["name"]) or "").strip()
        if not name:
            continue
        values: list[Value] = []
        for rep, c in sorted(cols["reps"].items()):
            crucible, sample, after = (to_float(cell(c[k])) for k in ("crucible", "sample", "after"))
            if crucible is None or sample is None or after is None:
                if any(v is not None for v in (crucible, sample, after)):
                    incomplete += 1
                continue
            residue = crucible + sample - after
            values.append(Value("RI", round(residue, 6), "g", rep))
            if sample > 0:
                values.append(Value("RI_pct", round(100 * residue / sample, 4), "%", rep))
            values.append(Value("sample_mass", sample, "g", rep))
        if not values:
            result.warnings.append(f"{name}: nenhuma réplica com as três massas — linha ignorada.")
            continue
        notes = str(cell(cols["notes"]) or "").strip()
        result.records.append(
            Record(
                key=f"ri:{ws.title}:{n}:{name}",
                raw_name=name,
                technique=TECHNIQUE,
                analyzed_at=_date(cell(cols["date"])),
                instrument="LECO",
                method="Resíduo insolúvel (massas)",
                values=values,
                extra={"sheet": ws.title, "layout": kind, "notes": notes} if notes else {"sheet": ws.title, "layout": kind},
                code_hint=code_suggestion(name),
            )
        )
    if incomplete:
        result.warnings.append(f"{incomplete} réplica(s) com massa faltando foram ignoradas.")
    if not result.records:
        raise ParseError("Nenhuma amostra com massas completas na planilha de Resíduo Insolúvel.")
    return result
