"""Py-GC-MS da rocha — planilha com uma aba por amostra (ESPECIFICACAO.md, 3.5).

Cada aba (`HP280`, `HP320`...): na linha do cabeçalho, "Tempo de retenção |
m/z | Area | Area % | Altura | Altura% | Area/Altura | Identificação"; abaixo,
um pico por linha (n-C10..., Pristano, Fitano...).

Derivados (pela área): Pristano/Fitano, Pristano/n-C17, Fitano/n-C18 e CPI
(C24–C34, Bray & Evans: média de Σímpares(25–33)/Σpares(24–32) e
Σímpares(25–33)/Σpares(26–34)) quando todos os n-alcanos do intervalo existem.
"""

from __future__ import annotations

import re

from app.parsers.common import ParseError, ParseResult, Record, Value, clean_label, to_float
from app.services.codes import strip_accents

TECHNIQUE = "pygcms"
_NALK_RE = re.compile(r"^n-?C\s*(\d+)$", re.IGNORECASE)


def _header_row(rows: list[list]) -> int | None:
    for i, row in enumerate(rows[:10]):
        labels = [strip_accents(clean_label(c)).lower() for c in row]
        if any(lbl.startswith("tempo de retencao") for lbl in labels) and any(lbl.startswith("identificacao") for lbl in labels):
            return i
    return None


def is_pygcms_workbook(wb) -> bool:
    for ws in wb.worksheets[:5]:
        rows = [list(r) for r in ws.iter_rows(min_row=1, max_row=10, values_only=True)]
        if _header_row(rows) is not None:
            return True
    return False


def n_alkane_carbon(name: str) -> int | None:
    m = _NALK_RE.match(clean_label(name).replace(" ", ""))
    return int(m.group(1)) if m else None


def derived(peaks: list[dict]) -> dict[str, float]:
    area: dict[str, float] = {}
    for p in peaks:
        if p["area"] is None:
            continue
        key = p["id"].lower()
        area[key] = area.get(key, 0.0) + p["area"]
    nalk = {n: area[k] for k in area if (n := n_alkane_carbon(k)) is not None}
    pr = next((v for k, v in area.items() if k.startswith("pristan")), None)
    ph = next((v for k, v in area.items() if k.startswith("fitan") or k.startswith("phytan")), None)
    out: dict[str, float] = {}
    if pr and ph:
        out["pr_ph"] = pr / ph
    if pr and nalk.get(17):
        out["pr_nc17"] = pr / nalk[17]
    if ph and nalk.get(18):
        out["ph_nc18"] = ph / nalk[18]
    if all(nalk.get(n) for n in range(24, 35)):
        odd = sum(nalk[n] for n in range(25, 34, 2))
        even_low = sum(nalk[n] for n in range(24, 33, 2))
        even_high = sum(nalk[n] for n in range(26, 35, 2))
        out["cpi"] = 0.5 * (odd / even_low + odd / even_high)
    return out


def parse_workbook(wb, filename: str = "") -> ParseResult:
    result = ParseResult(TECHNIQUE, "Py-GC-MS — uma aba por amostra")
    for ws in wb.worksheets:
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        hi = _header_row(rows)
        if hi is None:
            result.warnings.append(f"Aba \"{ws.title}\" sem o cabeçalho de picos, ignorada.")
            continue
        head = [strip_accents(clean_label(c)).lower() for c in rows[hi]]

        def col(prefix: str, _head: list[str] = head) -> int | None:
            return next((i for i, lbl in enumerate(_head) if lbl == prefix), None) or next(
                (i for i, lbl in enumerate(_head) if lbl.startswith(prefix)), None
            )

        c_rt, c_mz, c_area, c_area_pct = col("tempo de retencao"), col("m/z"), col("area"), col("area %")
        c_height, c_id = col("altura"), col("identificacao")
        peaks = []
        for row in rows[hi + 1 :]:
            ident = clean_label(row[c_id]) if c_id is not None and c_id < len(row) else ""
            rt = to_float(row[c_rt]) if c_rt is not None and c_rt < len(row) else None
            if not ident and rt is None:
                continue
            peaks.append(
                {
                    "rt_min": rt,
                    "mz": to_float(row[c_mz]) if c_mz is not None else None,
                    "area": to_float(row[c_area]) if c_area is not None else None,
                    "area_pct": to_float(row[c_area_pct]) if c_area_pct is not None else None,
                    "height": to_float(row[c_height]) if c_height is not None else None,
                    "id": ident,
                    "n_carbon": n_alkane_carbon(ident),
                }
            )
        if not peaks:
            result.warnings.append(f"Aba \"{ws.title}\" sem picos, ignorada.")
            continue
        values = [Value(k, v) for k, v in derived(peaks).items()]
        values.append(Value("n_peaks", float(len(peaks))))
        result.records.append(
            Record(
                key=f"{clean_label(ws.title)}",
                raw_name=clean_label(ws.title),
                technique=TECHNIQUE,
                instrument="Py-GC-MS",
                values=values,
                data={"peaks": peaks},
                extra={"sheet": ws.title, "workbook": filename},
            )
        )
    if not result.records:
        raise ParseError("Nenhuma aba desta planilha de Py-GC-MS tem picos.")
    return result
