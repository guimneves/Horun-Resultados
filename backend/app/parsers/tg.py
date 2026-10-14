"""TG — termogravimetria, Shimadzu TGA-50 / TA-60, exportação ASCII (ESPECIFICACAO.md, 3.10).

Duas variantes vistas (mesma estrutura de seções):
* UTF-16 com BOM, começa por "File Name:" (exportação do TA-60 nova);
* texto cp1252 começando por "[TA Ascii File]" (os "-Corrected.txt", com
  `[DataCorrectHistory]`).

Seções lidas por rótulo: `[File Information]` ("Sample Name:", "Sample
Weight:\\t8.000[mg]", "Atmosphere:", "Acquire Date"/"Acquisition Date"
aa/mm/dd) e `[Data]`: linha de cabeçalho (`Time\\tTemp\\tTGA`), linha de
unidades (`sec\\tC\\t%` ou `sec\\tC\\tmg`) e as linhas numéricas até a linha
em branco. A massa vira % da massa inicial (em mg → ÷ 1º valor).

Parâmetros (pontos percentuais da massa inicial):
* `loss_150` = 100 − m(150 °C) (umidade); `loss_150_400`, `loss_400_600`,
  `loss_600_900` = m(início) − m(fim) da faixa; m(T) = 1º ponto com
  temperatura ≥ T (faixa não alcançada → sem valor);
* `residue_pct` = massa no ponto de temperatura máxima; `t_final_c` = essa
  temperatura; `mass_mg` = "Sample Weight";
* `dtg_peak_c` = temperatura da maior taxa de perda (mínimo de dm/dT, curva
  suavizada por média móvel; trechos quase isotérmicos ficam de fora).

O arquivo binário do TA-60 (.tad, começa por "TA-60 FILE") não é lido: fica
"ignorado" com o pedido de exportar em ASCII.
"""

from __future__ import annotations

import re

from app.parsers.common import NotResultsFile, ParseError, ParseResult, Record, Value, clean_label, to_float

TECHNIQUE = "tg"
MAX_CURVE_POINTS = 800
SMOOTH_WINDOW = 15  # pontos (≈ 15 s a 1 ponto/s)
DTG_SPAN = 5  # derivada central em ±5 pontos
RANGES = (("loss_150_400", 150, 400), ("loss_400_600", 400, 600), ("loss_600_900", 600, 900))


def is_binary_tad(content: bytes) -> bool:
    return content[:10] == b"TA-60 FILE"


def decode(content: bytes) -> str:
    if content[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return content.decode("utf-16", errors="replace")
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("latin-1")


def looks_like_tg(text: str) -> bool:
    head = text[:20000]
    return "[Data]" in head and ("Sample Weight" in head or "[TA Ascii File]" in head) and ("TGA" in head)


def _info(lines: list[str]) -> dict[str, str]:
    info: dict[str, str] = {}
    for line in lines:
        if line.strip() == "[Data]":
            break
        m = re.match(r"^([A-Za-z][A-Za-z ./]*?)\s*:?\t(.*)$", line)
        if m:
            info.setdefault(m.group(1).strip().rstrip(":").strip(), m.group(2).strip())
    return info


def _date(info: dict[str, str]) -> str:
    raw = info.get("Acquire Date") or info.get("Acquisition Date") or ""
    time = (info.get("Acquire Time") or info.get("Acquisition Time") or "")[:5]
    m = re.match(r"^(\d{2})/(\d{2})/(\d{2})$", raw.strip())
    if not m:
        return raw.strip()
    return f"20{m.group(1)}-{m.group(2)}-{m.group(3)}" + (f" {time}" if re.match(r"^\d{2}:\d{2}$", time) else "")


def _data(lines: list[str]) -> tuple[list[str], list[str], list[list[float]]]:
    try:
        start = next(i for i, line in enumerate(lines) if line.strip() == "[Data]")
    except StopIteration as exc:
        raise ParseError("Arquivo do TG sem a seção [Data].") from exc
    header = [clean_label(h) for h in lines[start + 1].split("\t")] if start + 1 < len(lines) else []
    units = [clean_label(u) for u in lines[start + 2].split("\t")] if start + 2 < len(lines) else []
    rows: list[list[float]] = []
    for line in lines[start + 3 :]:
        if not line.strip():
            if rows:
                break
            continue
        cells = [to_float(c) for c in line.split("\t")]
        if any(c is None for c in cells[: len(header)]):
            break
        rows.append([c for c in cells if c is not None])
    return header, units, rows


def _smooth(values: list[float], window: int) -> list[float]:
    half = window // 2
    out = []
    acc = [0.0]
    for v in values:
        acc.append(acc[-1] + v)
    for i in range(len(values)):
        a, b = max(0, i - half), min(len(values), i + half + 1)
        out.append((acc[b] - acc[a]) / (b - a))
    return out


def _dtg(temps: list[float], mass: list[float]) -> list[float | None]:
    """dm/dT (%/°C) da curva suavizada; None onde a temperatura quase não muda."""
    sm = _smooth(mass, SMOOTH_WINDOW)
    st = _smooth(temps, SMOOTH_WINDOW)
    out: list[float | None] = []
    n = len(sm)
    for i in range(n):
        a, b = max(0, i - DTG_SPAN), min(n - 1, i + DTG_SPAN)
        dt = st[b] - st[a]
        out.append((sm[b] - sm[a]) / dt if dt > 0.5 else None)
    return out


def _mass_at(temps: list[float], mass: list[float], t: float) -> float | None:
    for temp, m in zip(temps, mass, strict=True):
        if temp >= t:
            return m
    return None


def _display_name(sample_name: str, filename: str) -> str:
    """O nome do ARQUIVO costuma trazer a réplica ("Produto X - rep 2
    (Triplicata).txt") e o "Sample Name" nem sempre ("PX-Produto X
    (triturado)"): vale o do arquivo quando ele traz réplica."""
    stem = re.sub(r"\.(txt|csv|tad)$", "", filename.strip(), flags=re.IGNORECASE)
    stem = re.sub(r"\((?:triplicata|duplicata)\)", " ", stem, flags=re.IGNORECASE)
    stem = re.sub(r"[\s_-]*corrected\s*$", "", stem.strip(), flags=re.IGNORECASE)
    stem = re.sub(r"\s+", " ", stem).strip()
    if re.search(r"(?:\brep\.?\s*\d{1,2}|[\s_-]\d{1,2})$", stem, re.IGNORECASE):
        return stem
    return sample_name or stem


def parse(content: bytes, filename: str = "") -> ParseResult:
    if is_binary_tad(content):
        raise NotResultsFile(
            "Arquivo nativo do TA-60 (binário, .tad) — não dá para ler. No TA-60, exporte a curva em texto "
            "(File → Export → ASCII) e importe o .txt."
        )
    text = decode(content)
    if not looks_like_tg(text):
        raise ParseError("Este arquivo não parece ser uma exportação ASCII do TG (Shimadzu TGA-50/TA-60).")
    lines = text.splitlines()
    info = _info(lines)
    header, units, rows = _data(lines)
    try:
        i_temp = header.index("Temp")
        i_mass = header.index("TGA")
    except ValueError as exc:
        raise ParseError("A seção [Data] do TG não tem as colunas \"Temp\" e \"TGA\".") from exc
    i_time = header.index("Time") if "Time" in header else None
    rows = [r for r in rows if len(r) > max(i_temp, i_mass)]
    if len(rows) < 20:
        raise ParseError("Curva do TG com poucos pontos (ou vazia) na seção [Data].")
    unit = units[i_mass].lower() if i_mass < len(units) else ""
    temps = [r[i_temp] for r in rows]
    raw_mass = [r[i_mass] for r in rows]
    weight = to_float(info.get("Sample Weight"))

    result = ParseResult(TECHNIQUE, "TG — exportação ASCII (Shimadzu TGA-50/TA-60)")
    if unit == "mg":
        m0 = raw_mass[0] if raw_mass[0] > 0 else weight
        if not m0:
            raise ParseError("Curva do TG em mg sem massa inicial — não dá para calcular a %.")
        mass = [m / m0 * 100 for m in raw_mass]
        result.warnings.append("Curva em mg: convertida para % da massa do 1º ponto.")
    elif unit in ("%", ""):
        mass = raw_mass
    else:
        raise ParseError(f'Unidade da massa do TG não reconhecida ("{unit}").')

    values: list[Value] = []

    def add(key: str, value: float | None, unit_: str) -> None:
        if value is not None:
            values.append(Value(key, round(value, 4), unit_))

    m150 = _mass_at(temps, mass, 150)
    add("loss_150", mass[0] - m150 if m150 is not None else None, "%")
    for key, a, b in RANGES:
        ma, mb = _mass_at(temps, mass, a), _mass_at(temps, mass, b)
        add(key, ma - mb if ma is not None and mb is not None else None, "%")
    i_max = max(range(len(temps)), key=temps.__getitem__)
    add("residue_pct", mass[i_max], "%")
    add("t_final_c", temps[i_max], "°C")
    add("mass_mg", weight, "mg")
    dtg = _dtg(temps, mass)
    candidates = [(d, temps[i]) for i, d in enumerate(dtg) if d is not None and i <= i_max and temps[i] > temps[0] + 10]
    if candidates:
        add("dtg_peak_c", min(candidates)[1], "°C")
    if temps[i_max] < 900:
        result.warnings.append(f"A corrida vai só até {temps[i_max]:.0f} °C — faixas acima disso ficam sem valor.")

    step = max(1, -(-len(rows) // MAX_CURVE_POINTS))
    curve = {
        "time_s": [round(r[i_time], 1) for r in rows[::step]] if i_time is not None else None,
        "temperature": [round(t, 2) for t in temps[::step]],
        "mass_pct": [round(m, 3) for m in mass[::step]],
        "dtg": [round(d, 5) if d is not None else None for d in dtg[::step]],
        "points": len(rows[::step]),
    }
    sample_name = clean_label(info.get("Sample Name", ""))
    name = _display_name(sample_name, filename)
    date = _date(info)
    result.records.append(
        Record(
            key=f"{sample_name or name}|{date}",
            raw_name=name,
            technique=TECHNIQUE,
            analyzed_at=date,
            instrument=clean_label(info.get("Detector") or info.get("Detector Type") or "TGA-50"),
            method=" / ".join(x for x in (info.get("Atmosphere", ""), info.get("Gas Flow") or info.get("Flow Rate") or "") if x),
            values=values,
            data=curve,
            extra={"sample_name": sample_name, "atmosphere": info.get("Atmosphere", ""), "mass_unit": unit or "%"},
        )
    )
    return result
