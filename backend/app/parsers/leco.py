"""LECO — CSV exportado do Cornerstone (ESPECIFICACAO.md, 3.2).

O arquivo mistura dois tipos de linha, cada um com o seu cabeçalho:
* réplica (58 colunas, cabeçalho "Date,Time,Set ID,Analysis Date,Analysis Time,Name,Type,..."):
  Name, Type, Repetition, Carbon ("12.3 %"), Sulfur, Sample Mass ("0.2000 g")...
* resumo do conjunto (36 colunas; dois cabeçalhos possíveis, "Date,..." ou
  "Name,Type,..."): Carbon Average, Carbon Std. Dev., Number of Replicates...

Lê pelo NOME da coluna. Atenção (visto no arquivo real): as linhas de resumo
dos dois layouts se alternam SEM repetir o cabeçalho — por isso, entre os
cabeçalhos já vistos com o mesmo nº de colunas, vale o que "encaixa" na linha
(coluna Date com cara de data e Name sem cara de data); empate → o último visto. Média e desvio saem das réplicas (o resumo do aparelho fica
guardado só para conferência).
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime

from app.parsers.common import NotResultsFile, ParseError, ParseResult, Record, Value, to_float

TECHNIQUE = "leco"
KINDS = {"sample": "sample", "standard": "standard", "blank": "blank", "check standard": "standard"}


def decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ParseError("Não consegui ler o texto do CSV (codificação desconhecida).")


def looks_like_leco_csv(text: str) -> bool:
    head = text[:4000]
    return ("Set ID" in head or "Repetition" in head) and "Name" in head and ("Carbon" in head or "Sulfur" in head)


def _is_header(row: list[str]) -> bool:
    return bool(row) and row[0].strip() in ("Date", "Name") and "Type" in row and "Name" in row


def _index(header: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for i, name in enumerate(header):
        out.setdefault(name.strip(), i)  # nomes repetidos ("Carbon Average"): vale o 1º
    return out


_DATE_CELL_RE = re.compile(r"^\d{1,2}/\d{1,2}/\d{4}")


def _pick_header(candidates: list[dict[str, int]], row: list[str]) -> dict[str, int] | None:
    best, best_score = None, -1
    for idx in candidates:  # do mais antigo ao mais novo: empate fica com o último
        score = 0
        d, n = idx.get("Date"), idx.get("Name")
        if d is not None and d < len(row) and _DATE_CELL_RE.match(row[d].strip()):
            score += 1
        if n is not None and n < len(row) and row[n].strip() and not _DATE_CELL_RE.match(row[n].strip()):
            score += 1
        if score >= best_score:
            best, best_score = idx, score
    return best


def _date(raw: str) -> str:
    raw = (raw or "").strip()
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            continue
    return raw


def parse(content: bytes, filename: str = "") -> ParseResult:
    text = decode(content)
    if not looks_like_leco_csv(text):
        raise ParseError("Este CSV não parece ser uma exportação de resultados do LECO (Cornerstone).")
    rows = list(csv.reader(io.StringIO(text)))
    headers: dict[int, list[dict[str, int]]] = {}
    sets: dict[str, dict] = {}
    order: list[str] = []
    result = ParseResult(TECHNIQUE, "LECO — CSV do Cornerstone")
    unknown = 0

    for row in rows:
        if not row or not any(c.strip() for c in row):
            continue
        if _is_header(row):
            index = _index(row)
            same = headers.setdefault(len(row), [])
            if index in same:
                same.remove(index)
            same.append(index)
            continue
        idx = _pick_header(headers.get(len(row), []), row)
        if idx is None:
            unknown += 1
            continue

        def col(name: str, _row: list[str] = row, _idx: dict[str, int] = idx) -> str:
            i = _idx.get(name)
            return _row[i].strip() if i is not None and i < len(_row) else ""

        name = col("Name")
        set_id = col("Set ID") or f"{name}:{col('Analysis Date')}"
        if set_id not in sets:
            sets[set_id] = {"name": name, "type": col("Type"), "replicates": [], "summary": None}
            order.append(set_id)
        entry = sets[set_id]
        if "Repetition" in idx:  # linha de réplica
            entry["replicates"].append(
                {
                    "rep": int(to_float(col("Repetition")) or len(entry["replicates"]) + 1),
                    "C": to_float(col("Carbon")),
                    "S": to_float(col("Sulfur")),
                    "mass": to_float(col("Sample Mass")),
                    "state": col("Include/Exclude State"),
                    "date": _date(col("Analysis Date")),
                    "method": col("Method"),
                    "instrument": col("Instrument Name"),
                }
            )
        else:  # linha de resumo do conjunto
            entry["summary"] = {
                "C_avg": to_float(col("Carbon Average")),
                "C_sd": to_float(col("Carbon Std. Dev.")),
                "S_avg": to_float(col("Sulfur Average")),
                "S_sd": to_float(col("Sulfur Std. Dev.")),
                "n": to_float(col("Number of Replicates")),
                "method": col("Method"),
                "instrument": col("Instrument Name"),
                "date": _date(col("Analysis Date")),
            }

    if not sets:
        raise ParseError("Nenhuma linha de resultado encontrada no CSV do LECO.")
    if unknown:
        result.warnings.append(f"{unknown} linha(s) sem cabeçalho correspondente foram ignoradas.")

    for set_id in order:
        entry = sets[set_id]
        summary = entry["summary"] or {}
        values: list[Value] = []
        excluded = 0
        date = summary.get("date", "")
        method = summary.get("method", "")
        instrument = summary.get("instrument", "")
        for rep in entry["replicates"]:
            if rep["state"].lower() == "excluded":
                excluded += 1
                continue
            for param, unit in (("C", "%"), ("S", "%"), ("mass", "g")):
                if rep[param] is not None:
                    values.append(Value(param, rep[param], unit, rep["rep"]))
            date = date or rep["date"]
            method = method or rep["method"]
            instrument = instrument or rep["instrument"]
        if not entry["replicates"] and summary:
            # só o resumo veio no arquivo: usa a média do aparelho
            for param in ("C", "S"):
                if summary.get(f"{param}_avg") is not None:
                    values.append(Value(param, summary[f"{param}_avg"], "%"))
            result.warnings.append(f"{entry['name']}: só o resumo do conjunto (sem réplicas) — usei a média do aparelho.")
        if excluded:
            result.warnings.append(f"{entry['name']}: {excluded} réplica(s) marcadas como excluídas no aparelho foram ignoradas.")
        if not values:
            result.warnings.append(f"{entry['name']}: conjunto sem valores, ignorado.")
            continue
        result.records.append(
            Record(
                key=f"{instrument or 'leco'}:{set_id}",
                raw_name=entry["name"],
                technique=TECHNIQUE,
                kind=KINDS.get(entry["type"].lower(), "sample"),
                analyzed_at=date,
                instrument=instrument or "LECO",
                method=method,
                values=values,
                extra={"set_id": set_id, "reported": summary},
            )
        )
    return result


_DIAGNOSTIC_RE = re.compile(r"Configuration|Parameter|SC832|Cornerstone|S/N", re.IGNORECASE)


def reject_if_diagnostic_pdf(text: str) -> None:
    """O PDF de diagnóstico do LECO vem com UMA LETRA POR LINHA no pypdf —
    compara sem espaços."""
    compact = re.sub(r"\s+", "", text[:3000])
    if ("SC832" in compact or "LECO" in compact.upper()) and _DIAGNOSTIC_RE.search(compact):
        raise NotResultsFile(
            "Este PDF é o relatório de configuração/diagnóstico do LECO, não resultados. "
            "Exporte os resultados do Cornerstone em CSV e importe o CSV."
        )


def is_diagnostic_zip(names: list[str]) -> bool:
    joined = "\n".join(names)
    return "MondoFiles/" in joined or ".lecodbfile" in joined or "Cornerstone.Configuration" in joined
