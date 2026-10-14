"""LECO — sinal BRUTO do detector exportado do Cornerstone (ESPECIFICACAO.md, 3.12).

Não é a exportação de resultados (essa é o CSV de parsers/leco.py, com
"Name", "Set ID", "Carbon" em %). Aqui cada linha é UM SEGUNDO da corrida:

    "Set","Rep","Time","Carbon","Sulfur Low","Sulfur High","Furnace Power","Furnace Temperature"

com um conjunto ("Set") por amostra, réplicas 1..n ("Rep") e os brancos
("Blank"). Células vazias = 0. Sem massa da amostra e sem calibração no
arquivo, NÃO dá para chegar a % de C ou S: o leitor guarda ÁREAS RELATIVAS
(u.a.) = soma do sinal na corrida menos a média das áreas dos brancos do
MESMO arquivo, e a curva (tempo × C, S baixo, S alto) para o gráfico.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime

from app.parsers.common import ParseError, ParseResult, Record, Value, clean_label, to_float
from app.parsers.leco import decode

TECHNIQUE = "leco_bruto"
MAX_CURVE_POINTS = 600
CHANNELS = (("Carbon", "area_C", "C"), ("Sulfur Low", "area_S_low", "S_low"), ("Sulfur High", "area_S_high", "S_high"))
BLANK_NAMES = {"blank", "branco"}


def looks_like_leco_raw(text: str) -> bool:
    first = clean_label(text.lstrip("﻿").split("\n", 1)[0]).replace('"', "")
    cols = [c.strip() for c in first.split(",")]
    return {"Set", "Rep", "Time", "Carbon"} <= set(cols) and "Name" not in cols


def _time(raw: str) -> datetime | None:
    try:
        return datetime.strptime(raw.strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def parse(content: bytes, filename: str = "") -> ParseResult:
    text = decode(content)
    if not looks_like_leco_raw(text):
        raise ParseError("Este CSV não é o sinal bruto do LECO (colunas Set, Rep, Time, Carbon).")
    rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
    header = [clean_label(h) for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}
    runs: dict[tuple[str, str], dict] = {}
    for row in rows[1:]:
        if not row or not any(c.strip() for c in row):
            continue

        def col(name: str, _row: list[str] = row) -> str:
            i = idx.get(name)
            return _row[i].strip() if i is not None and i < len(_row) else ""

        key = (col("Set"), col("Rep"))
        run = runs.setdefault(key, {"times": [], "signals": {c: [] for c, _k, _s in CHANNELS}})
        run["times"].append(_time(col("Time")))
        for channel, _key, _short in CHANNELS:
            run["signals"][channel].append(to_float(col(channel)) or 0.0 if channel in idx else 0.0)
    if not runs:
        raise ParseError("O CSV do sinal bruto do LECO não tem nenhuma linha de dados.")

    def areas(run: dict) -> dict[str, float]:
        return {key: sum(run["signals"][channel]) for channel, key, _s in CHANNELS if channel in idx}

    blanks = [areas(r) for (name, _rep), r in runs.items() if name.strip().lower() in BLANK_NAMES]
    blank_mean = {k: sum(b[k] for b in blanks) / len(blanks) for k in blanks[0]} if blanks else {}

    result = ParseResult(TECHNIQUE, "LECO — sinal bruto do Cornerstone")
    result.warnings.append(
        "Sinal bruto do detector: as áreas são RELATIVAS (u.a., soma do sinal menos a média dos brancos), "
        "não são % de C ou S — falta a massa das amostras e a calibração."
    )
    if blanks:
        result.warnings.append(f"Branco descontado: média de {len(blanks)} corrida(s) \"Blank\" deste arquivo.")
    else:
        result.warnings.append("Nenhum branco (\"Blank\") no arquivo — áreas sem desconto do branco.")

    for (name, rep), run in runs.items():
        is_blank = name.strip().lower() in BLANK_NAMES
        times = [t for t in run["times"] if t is not None]
        start = times[0] if times else None
        duration = (times[-1] - times[0]).total_seconds() + 1 if len(times) > 1 else float(len(run["times"]))
        values = [Value("duration_s", duration, "s")]
        for key, area in areas(run).items():
            values.append(Value(key, round(area - (0 if is_blank else blank_mean.get(key, 0.0)), 4), "u.a."))
        n = len(run["times"])
        step = max(1, -(-n // MAX_CURVE_POINTS))
        elapsed = [((t - start).total_seconds() if t and start else float(i)) for i, t in enumerate(run["times"])]
        curve = {"time_s": elapsed[::step], "points": len(elapsed[::step])}
        for channel, _key, short in CHANNELS:
            if channel in idx:
                curve[short] = [round(v, 4) for v in run["signals"][channel][::step]]
        rep_n = to_float(rep)
        result.records.append(
            Record(
                key=f"{name}|{rep}|{start.isoformat() if start else filename}",
                raw_name=name,
                technique=TECHNIQUE,
                kind="blank" if is_blank else "sample",
                analyzed_at=start.strftime("%Y-%m-%d %H:%M") if start else "",
                instrument="LECO (Cornerstone)",
                method="sinal bruto",
                values=values,
                data=curve,
                extra={
                    "set": name,
                    "replicate_hint": int(rep_n) if rep_n is not None else None,
                    "blank_subtracted": bool(blanks) and not is_blank,
                    "blank_mean": {k: round(v, 4) for k, v in blank_mean.items()},
                },
            )
        )
    return result
