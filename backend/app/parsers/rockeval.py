"""Rock-Eval — relatório HTML do GeoWorks ("Job report", .htm) (ESPECIFICACAO.md, 3.3).

O HTML traz, num <script>, variáveis JavaScript cujo valor é JSON válido:
* `dataTableHeader` — colunas (com \\xa0 nos nomes): Analysis, Sample, Date,
  Quantity (mg), Method, Cycle, TpkS2 (°C), Tmax (°C), TOC (%), ... HI, OI, S index;
* `dataTableArray` — uma linha por análise/réplica;
* `pyroDataN` / `oxiDataN` — curvas (listas de séries: tempo, temperatura, HC,
  CO, CO2, SO2...; `null` quando o canal não existe), com os nomes em
  `pyroCurveLegend` / `oxiCurveLegend`;
* `curveData` — liga cada Analysis às suas curvas (`null` sem oxidação).

Relatório "multiheating" (projeto de tabaco, 14/10/2026): sem a coluna
"Analysis" (nem Date/Method), colunas Q1–Q5 (mg/g), PC, RC, Total HC
Gas/Liquid (%). O `curveData` vem na MESMA ORDEM das linhas da tabela, com
o nome da corrida ("AAAA-MM-DD-AMOSTRA") — sem "Analysis", as curvas são
ligadas pela posição e esse nome vira a chave da medição.
"""

from __future__ import annotations

import json
import re
from datetime import datetime

from app.parsers.common import ParseError, ParseResult, Record, Value, clean_label, to_float

TECHNIQUE = "rockeval"
MAX_CURVE_POINTS = 600
DEFAULT_PYRO_LEGEND = ["Time", "Temp", "HC", "CO", "CO2", "SO2", "C1", "C4", "H2", "H2O", "T°"]
DEFAULT_OXI_LEGEND = ["Time", "Temp", "CO", "CO2", "SO2", "C1", "C4", "H2", "H2O", "T°"]
TEXT_COLUMNS = {"Analysis", "Sample", "Date", "Method", "Cycle"}
_DECODER = json.JSONDecoder()


def looks_like_rockeval(text: str) -> bool:
    return "dataTableHeader" in text and "dataTableArray" in text


def _js_value(text: str, name: str):
    m = re.search(r"\bvar\s+" + re.escape(name) + r"\s*=\s*", text)
    if not m:
        return None
    try:
        value, _end = _DECODER.raw_decode(text, m.end())
    except json.JSONDecodeError:
        return None
    return value


def _legend(text: str, name: str, default: list[str]) -> list[str]:
    m = re.search(r"\bvar\s+" + re.escape(name) + r"\s*=\s*(\[[^\]]*\])", text)
    if not m:
        return default
    try:
        return json.loads(m.group(1).replace("'", '"'))
    except json.JSONDecodeError:
        return default


def _param_key(label: str) -> tuple[str, str]:
    """"S1 S (%)" → ("S1S", "%"); "Quantity (mg)" → ("quantity", "mg")."""
    label = clean_label(label)
    unit_m = re.search(r"\(([^)]*)\)\s*$", label)
    unit = unit_m.group(1) if unit_m else ""
    name = re.sub(r"\s*\([^)]*\)\s*$", "", label).replace(" ", "")
    if name.lower() == "quantity":
        name = "quantity"
    return name, unit


def _date(raw: str) -> str:
    raw = clean_label(raw)
    try:
        return datetime.strptime(raw, "%m/%d/%y - %Hh%M").strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return raw


def _downsample(series: list, step: int) -> list:
    return [round(v, 5) if isinstance(v, float) else v for v in series[::step]]


def _curves(text: str, var: str | None, legend: list[str]) -> dict | None:
    if not var:
        return None
    data = _js_value(text, var)
    if not isinstance(data, list) or not data or not isinstance(data[0], list):
        return None
    n = len(data[0])
    step = max(1, -(-n // MAX_CURVE_POINTS))
    series = {}
    for name, values in zip(legend, data, strict=False):
        if isinstance(values, list) and values:
            series[name] = _downsample(values, step)
    return {"legend": [k for k in series], "series": series, "points": len(next(iter(series.values()), []))}


def parse(content: bytes, filename: str = "") -> ParseResult:
    text = content.decode("utf-8-sig", errors="replace")
    if not looks_like_rockeval(text):
        raise ParseError("Este arquivo HTML não é um relatório do Rock-Eval (GeoWorks) — faltam as tabelas de dados.")
    header = _js_value(text, "dataTableHeader")
    rows = _js_value(text, "dataTableArray")
    if not isinstance(header, list) or not isinstance(rows, list):
        raise ParseError("Não consegui ler a tabela de dados do relatório do Rock-Eval.")
    labels = [clean_label(h) for h in header]
    if "Sample" not in labels:
        raise ParseError("O relatório do Rock-Eval não tem a coluna \"Sample\".")
    i_sample = labels.index("Sample")
    i_analysis = labels.index("Analysis") if "Analysis" in labels else None

    links: dict[str, tuple[str | None, str | None]] = {}
    ordered: list[tuple[str, str | None, str | None]] = []
    for m in re.finditer(r'\[\s*"([^"]+)"\s*,\s*(pyroData\d+|null)\s*,\s*(oxiData\d+|null)\s*\]', text):
        link = (None if m.group(2) == "null" else m.group(2), None if m.group(3) == "null" else m.group(3))
        links[m.group(1)] = link
        ordered.append((m.group(1), *link))
    pyro_legend = _legend(text, "pyroCurveLegend", DEFAULT_PYRO_LEGEND)
    oxi_legend = _legend(text, "oxiCurveLegend", DEFAULT_OXI_LEGEND)
    title = clean_label(_js_value(text, "reportTitle") or "")

    fmt_label = "Rock-Eval — Job report (GeoWorks)" if i_analysis is not None else "Rock-Eval — relatório multiheating (GeoWorks)"
    result = ParseResult(TECHNIQUE, fmt_label)
    if not rows:
        raise ParseError("O relatório do Rock-Eval não tem nenhuma análise.")
    by_order = i_analysis is None and len(ordered) == len(rows)
    if i_analysis is None and ordered and not by_order:
        result.warnings.append(
            f"Relatório sem a coluna \"Analysis\" e com {len(ordered)} curva(s) para {len(rows)} linha(s): curvas não ligadas."
        )
    used_keys: set[str] = set()
    for i_row, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != len(labels):
            result.warnings.append("Linha da tabela do Rock-Eval com nº de colunas diferente do cabeçalho, ignorada.")
            continue
        cells = dict(zip(labels, row, strict=True))
        sample = clean_label(row[i_sample])
        if i_analysis is not None:
            analysis = clean_label(row[i_analysis])
            pyro_var, oxi_var = links.get(analysis, (None, None))
        elif by_order:
            analysis, pyro_var, oxi_var = ordered[i_row]
        else:
            analysis, pyro_var, oxi_var = f"{sample}#{i_row + 1}", None, None
        if analysis in used_keys:  # nome de corrida repetido no relatório
            analysis = f"{analysis}#{i_row + 1}"
        used_keys.add(analysis)
        values = []
        for label, raw in cells.items():
            if label in TEXT_COLUMNS:
                continue
            key, unit = _param_key(label)
            value = to_float(raw)
            if value is not None:
                values.append(Value(key, value, unit))
        rep_m = re.search(r"_(\d+)$", analysis) if i_analysis is not None else None
        run_date = re.match(r"^(\d{4}-\d{2}-\d{2})", analysis)
        curves = {"pyro": _curves(text, pyro_var, pyro_legend), "oxi": _curves(text, oxi_var, oxi_legend)}
        result.records.append(
            Record(
                key=analysis,
                raw_name=sample,
                technique=TECHNIQUE,
                analyzed_at=_date(cells.get("Date", "")) or (run_date.group(1) if run_date else ""),
                instrument="Rock-Eval",
                method=" / ".join(x for x in (clean_label(cells.get("Method", "")), clean_label(cells.get("Cycle", ""))) if x),
                values=values,
                data=curves if any(curves.values()) else None,
                extra={"analysis": analysis, "report": title, "replicate_hint": int(rep_m.group(1)) if rep_m else None},
            )
        )
    no_curves = sum(1 for r in result.records if r.data is None)
    if no_curves:
        result.warnings.append(f"{no_curves} análise(s) sem curvas no relatório.")
    return result
