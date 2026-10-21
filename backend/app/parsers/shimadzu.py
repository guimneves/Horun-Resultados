"""GC-FID (.gcd, GCsolution) e GC-MS (.qgd, GCMSsolution) da Shimadzu —
projetos de tabaco (pedido do mantenedor, 21/10/2026; formato conferido nos
arquivos de exemplo do laboratório, ESPECIFICACAO.md 3.10).

Os dois são arquivos compostos do Windows (OLE/CFB, assinatura D0 CF 11 E0),
com "fluxos" internos:

* `File Property` (nos dois): nome da amostra (campo de 64 bytes no byte 204),
  ID da amostra (268), data da corrida (FILETIME no byte 52), caminho do
  arquivo e do método (.qgm) como texto.
* `.gcd` — `GC Raw Data-1/Status` (intervalo entre pontos em ms e número de
  pontos) e `GC Raw Data-1/Intensity Data` (um double por ponto). O .gcd NÃO
  traz tabela de picos: o Horun integra os picos (`integrate`), decisão do
  mantenedor.
* `.qgd` — `GCMS Raw Data/Retention Time` (ms por varredura, int32) e
  `TIC Data` (int64), e a tabela de picos do processamento
  `GCMS Data Processing/MC Peak Table` (registros de 208 bytes: tempo, área,
  altura, início/fim, similaridade e o composto mais provável da biblioteca;
  a quantidade vem de `MC Peak Info`). Identificado = similaridade ≥ 80
  (decisão do mantenedor); a área de todos os picos conta no total.

Parâmetros (% da área total): nicotina, propilenoglicol, glicerol, furfural e
5-HMF (`TARGETS`), mais número de picos e área identificada.
"""

from __future__ import annotations

import io
import re
import struct
from collections import deque
from datetime import datetime, timedelta

from app.parsers.common import ParseError, ParseResult, Record, Value

CFB_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
TECH_FID = "gcfid_tab"
TECH_MS = "gcms_tab"
MIN_SIMILARITY = 80
MIN_REL_PROMINENCE = 0.05
_MS_REC = 208
_MAX_CURVE_POINTS = 3000  # pares mín/máx por faixa — o desenho guarda os picos

# Compostos de interesse → nomes da biblioteca NIST/Wiley que valem para ele
# (comparação sem caixa, sem espaços nas pontas; nomes exatos, para não pegar
# derivados como "nicotinic acid" ou "1,2-propanediol, 3-methoxy-").
TARGETS: dict[str, tuple[str, ...]] = {
    "pct_nicotine": ("nicotine", "nicotina", "pyridine, 3-(1-methyl-2-pyrrolidinyl)-, (s)-",
                     "pyridine, 3-(1-methyl-2-pyrrolidinyl)-", "(s)-3-(1-methyl-2-pyrrolidinyl)pyridine",
                     "3-(1-methyl-2-pyrrolidinyl)pyridine"),
    "pct_propylene_glycol": ("propylene glycol", "1,2-propanediol", "1,2-propanediol, (s)-", "1,2-propanediol, (r)-",
                             "propilenoglicol"),
    "pct_glycerol": ("glycerin", "glycerol", "1,2,3-propanetriol", "glicerol", "glicerina"),
    "pct_furfural": ("furfural", "2-furancarboxaldehyde", "2-furaldehyde", "furan-2-carbaldehyde"),
    "pct_hmf": ("5-hydroxymethylfurfural", "2-furancarboxaldehyde, 5-(hydroxymethyl)-", "5-(hydroxymethyl)furfural",
                "5-(hydroxymethyl)-2-furaldehyde", "5-(hydroxymethyl)-2-furancarboxaldehyde", "hmf"),
}
_TARGET_OF = {name: key for key, names in TARGETS.items() for name in names}


# o FID e o MS rodam juntos e cada um grava o nome com o sufixo do detector
# ("di-julia_FID_0", "di-julia_MS_0"): sem ele, as duas medições caem na mesma amostra
_DETECTOR_RE = re.compile(r"[_\s-]+(?:FID|MS|TIC|GCMS|GC-MS|GCFID|GC-FID)(?=$|[_\s-])", re.IGNORECASE)


def sample_name(raw: str) -> str:
    return _DETECTOR_RE.sub("", raw).strip(" _-") or raw


def is_shimadzu(content: bytes) -> bool:
    return content[:8] == CFB_MAGIC


# ---------------------------------------------------------------- File Property


def _cstr(b: bytes, off: int, size: int) -> str:
    return b[off: off + size].split(b"\x00", 1)[0].decode("cp1252", errors="replace").strip()


def file_info(fp: bytes) -> dict:
    """Nome e ID da amostra, data da corrida, método e caminho do arquivo."""
    info = {"sample_name": _cstr(fp, 204, 64) if len(fp) > 268 else "",
            "sample_id": _cstr(fp, 268, 32) if len(fp) > 300 else "", "acquired": "", "method": "", "path": ""}
    if len(fp) >= 60:
        ft = struct.unpack_from("<Q", fp, 52)[0]
        if 0x01C0000000000000 < ft < 0x0200000000000000:
            when = datetime(1601, 1, 1) + timedelta(microseconds=ft / 10)
            info["acquired"] = when.strftime("%Y-%m-%d %H:%M")
    texts = [m.group().decode("cp1252", errors="replace") for m in re.finditer(rb"[^\x00]{4,}", fp)]
    method = next((t for t in texts if t.lower().endswith(".qgm") or t.lower().endswith(".gcm")), "")
    info["method"] = method.replace("\\", "/").rsplit("/", 1)[-1]
    info["path"] = next((t for t in texts if re.search(r"\.(gcd|qgd)$", t, re.IGNORECASE)), "")
    return info


# ---------------------------------------------------------------- GC-FID


def decode_fid(status: bytes, intensity: bytes) -> tuple[float, list[float]]:
    """(intervalo entre pontos em s, sinal)."""
    if len(status) < 12:
        raise ParseError("GC-FID: bloco de status do cromatograma incompleto.")
    interval_ms, _x, n = struct.unpack_from("<3i", status, 0)
    if interval_ms <= 0 or n <= 0 or len(intensity) < 8 * n:
        raise ParseError("GC-FID: cromatograma vazio ou incompleto no arquivo.")
    return interval_ms / 1000.0, list(struct.unpack_from(f"<{n}d", intensity, 0))


def _moving_average(y: list[float], w: int) -> list[float]:
    if w <= 1:
        return list(y)
    half = w // 2
    acc = [0.0]
    for v in y:
        acc.append(acc[-1] + v)
    n = len(y)
    return [(acc[min(n, i + half + 1)] - acc[max(0, i - half)]) / (min(n, i + half + 1) - max(0, i - half)) for i in range(n)]


def _rolling_min(y: list[float], w: int) -> list[float]:
    half = w // 2
    out = [0.0] * len(y)
    dq: deque[int] = deque()
    n = len(y)
    j = 0
    for i in range(n):
        while j < n and j <= i + half:
            while dq and y[dq[-1]] >= y[j]:
                dq.pop()
            dq.append(j)
            j += 1
        while dq[0] < i - half:
            dq.popleft()
        out[i] = y[dq[0]]
    return out


def _median(v: list[float]) -> float:
    s = sorted(v)
    return s[len(s) // 2] if s else 0.0


def integrate(y: list[float], dt: float, *, baseline_window_s: float = 60.0, min_snr: float = 10.0) -> dict:
    """Picos do cromatograma: linha de base pelo mínimo móvel (janela de
    `baseline_window_s`, suavizado), ruído pela diferença entre pontos (MAD),
    pico = máximo local com proeminência ≥ `min_snr` × ruído e ≥ 5 % da altura; os limites são o
    vale até o pico vizinho (perpendicular) ou a volta à linha de base."""
    n = len(y)
    if n < 10:
        return {"peaks": [], "noise": 0.0, "baseline_window_s": baseline_window_s, "min_snr": min_snr}
    s = _moving_average(y, 7)
    w = max(3, int(round(baseline_window_s / dt)))
    base = _moving_average(_rolling_min(s, w), w)
    c = [a - b for a, b in zip(s, base)]
    diffs = [y[i + 1] - y[i] for i in range(n - 1)]
    md = _median(diffs)
    noise = 1.4826 * _median([abs(d - md) for d in diffs]) / (2 ** 0.5) or 1e-12
    thr = min_snr * noise
    maxima = [i for i in range(1, n - 1) if c[i] > thr and c[i] >= c[i - 1] and c[i] > c[i + 1]]

    # proeminência (como scipy.signal.peak_prominences), com busca limitada à janela
    kept: list[int] = []
    for i in maxima:
        h = c[i]
        lo = i
        left_min = h
        while lo > 0 and i - lo < w:
            lo -= 1
            if c[lo] > h:
                break
            left_min = min(left_min, c[lo])
        hi = i
        right_min = h
        while hi < n - 1 and hi - i < w:
            hi += 1
            if c[hi] > h:
                break
            right_min = min(right_min, c[hi])
        # proeminência mínima: acima do ruído E ≥ 5 % da altura — oscilação no
        # topo de um pico largo não vira um pico a mais
        if h - max(left_min, right_min) >= max(thr, MIN_REL_PROMINENCE * h):
            kept.append(i)

    peaks = []
    for k, i in enumerate(kept):
        # limites: vale até o vizinho (perpendicular) ou volta à linha de base
        left_stop = kept[k - 1] if k > 0 else max(0, i - w)
        right_stop = kept[k + 1] if k + 1 < len(kept) else min(n - 1, i + w)
        # limite: o ponto mais baixo até o pico vizinho (perpendicular no vale)
        # ou, antes disso, a volta à linha de base — pequenas oscilações no
        # caminho (que não viraram pico) não cortam a área
        lo = i
        best = i
        for j in range(i - 1, left_stop - 1, -1):
            if c[j] < c[best]:
                best = j
            if c[j] <= noise:
                best = j
                break
        lo = best
        hi = i
        best = i
        for j in range(i + 1, right_stop + 1):
            if c[j] < c[best]:
                best = j
            if c[j] <= noise:
                best = j
                break
        hi = best
        area = sum(max(0.0, c[j]) for j in range(lo, hi + 1)) * dt
        if area <= 0:
            continue
        peaks.append({"rt_min": round(i * dt / 60, 4), "start_min": round(lo * dt / 60, 4), "end_min": round(hi * dt / 60, 4),
                      "height": round(c[i], 4), "area": round(area, 4)})
    total = sum(p["area"] for p in peaks)
    for p in peaks:
        p["area_pct"] = round(100 * p["area"] / total, 4) if total else None
    return {"peaks": peaks, "noise": noise, "baseline_window_s": baseline_window_s, "min_snr": min_snr}


def decimate(t: list[float], y: list[float], buckets: int = _MAX_CURVE_POINTS) -> dict:
    """Mínimo e máximo de cada faixa — a curva fica leve e os picos não somem."""
    n = len(y)
    if n <= 2 * buckets:
        return {"t": [round(v, 5) for v in t], "y": [round(v, 3) for v in y]}
    step = n / buckets
    tt: list[float] = []
    yy: list[float] = []
    for b in range(buckets):
        a, z = int(b * step), int((b + 1) * step)
        seg = range(a, max(a + 1, z))
        i_min = min(seg, key=lambda i: y[i])
        i_max = max(seg, key=lambda i: y[i])
        for i in sorted({i_min, i_max}):
            tt.append(round(t[i], 5))
            yy.append(round(y[i], 3))
    return {"t": tt, "y": yy}


def parse_fid(streams: dict[str, bytes], filename: str) -> ParseResult:
    info = file_info(streams.get("File Property", b""))
    dt, y = decode_fid(streams["GC Raw Data-1/Status"], streams["GC Raw Data-1/Intensity Data"])
    res = integrate(y, dt)
    peaks = res["peaks"]
    name = sample_name(info["sample_name"] or filename.rsplit(".", 1)[0])
    values = [Value("n_peaks", float(len(peaks))), Value("total_area", sum(p["area"] for p in peaks), "sinal·s")]
    if peaks:
        top = max(peaks, key=lambda p: p["area"])
        values.append(Value("rt_main_peak", top["rt_min"], "min"))
    t = [i * dt / 60 for i in range(len(y))]
    result = ParseResult(technique=TECH_FID, format_label="GC-FID Shimadzu (.gcd)")
    result.records.append(Record(
        key=f"{name}|{info['acquired']}|fid", raw_name=name, technique=TECH_FID, analyzed_at=info["acquired"],
        instrument="GC-FID Shimadzu", method=info["method"], values=values,
        data={"kind": "chromatogram", "detector": "FID", "x_unit": "min", "y_unit": "sinal",
              "curve": decimate(t, y), "peaks": peaks,
              "integration": {"noise": res["noise"], "baseline_window_s": res["baseline_window_s"], "min_snr": res["min_snr"],
                              "points": len(y), "interval_s": dt}},
        extra={"sample_name": info["sample_name"], "sample_id": info["sample_id"], "file_path": info["path"]},
    ))
    if not peaks:
        result.warnings.append(f"{name}: nenhum pico acima do ruído no cromatograma do FID.")
    return result


# ---------------------------------------------------------------- GC-MS


def decode_ms_peaks(info: bytes, table: bytes) -> list[dict]:
    """Tabela de picos do GCMSsolution (MC Peak Table)."""
    count = struct.unpack_from("<H", info, 0)[0] if len(info) >= 2 else len(table) // _MS_REC
    count = min(count, len(table) // _MS_REC)
    peaks = []
    for k in range(count):
        r = table[k * _MS_REC: (k + 1) * _MS_REC]
        rt_ms = struct.unpack_from("<i", r, 4)[0]
        area, height = struct.unpack_from("<dd", r, 8)
        start_ms, end_ms = struct.unpack_from("<ii", r, 40)
        similarity = struct.unpack_from("<h", r, 60)[0]
        name = r[80:].split(b"\x00", 1)[0].decode("cp1252", errors="replace").strip()
        if rt_ms <= 0 or area <= 0:
            continue
        peaks.append({"rt_min": round(rt_ms / 60000, 4), "start_min": round(start_ms / 60000, 4), "end_min": round(end_ms / 60000, 4),
                      "area": area, "height": height, "similarity": int(similarity), "name": name})
    total = sum(p["area"] for p in peaks)
    for p in peaks:
        p["area_pct"] = round(100 * p["area"] / total, 4) if total else None
        p["identified"] = p["similarity"] >= MIN_SIMILARITY and bool(p["name"])
        p["target"] = _TARGET_OF.get(p["name"].lower().rstrip(" .")) if p["identified"] else None
    return peaks


def decode_tic(rt: bytes, tic: bytes) -> tuple[list[float], list[float]]:
    n = min(len(rt) // 4, len(tic) // 8)
    times = [v / 60000 for v in struct.unpack_from(f"<{n}i", rt, 0)]
    return times, [float(v) for v in struct.unpack_from(f"<{n}q", tic, 0)]


def ms_values(peaks: list[dict]) -> list[Value]:
    ident = [p for p in peaks if p["identified"]]
    values = [Value("n_peaks", float(len(peaks))), Value("n_identified", float(len(ident))),
              Value("pct_identified", sum(p["area_pct"] or 0 for p in ident), "% área")]
    for key in TARGETS:
        values.append(Value(key, sum(p["area_pct"] or 0 for p in ident if p["target"] == key), "% área"))
    return values


def parse_ms(streams: dict[str, bytes], filename: str) -> ParseResult:
    info = file_info(streams.get("File Property", b""))
    peaks = decode_ms_peaks(streams.get("GCMS Data Processing/MC Peak Info", b""),
                            streams.get("GCMS Data Processing/MC Peak Table", b""))
    times, tic = decode_tic(streams["GCMS Raw Data/Retention Time"], streams["GCMS Raw Data/TIC Data"])
    name = sample_name(info["sample_name"] or filename.rsplit(".", 1)[0])
    result = ParseResult(technique=TECH_MS, format_label="GC-MS Shimadzu (.qgd)")
    result.records.append(Record(
        key=f"{name}|{info['acquired']}|ms", raw_name=name, technique=TECH_MS, analyzed_at=info["acquired"],
        instrument="GCMS-QP2010 Shimadzu", method=info["method"], values=ms_values(peaks),
        data={"kind": "chromatogram", "detector": "MS (TIC)", "x_unit": "min", "y_unit": "TIC",
              "curve": decimate(times, tic), "peaks": peaks, "min_similarity": MIN_SIMILARITY},
        extra={"sample_name": info["sample_name"], "sample_id": info["sample_id"], "file_path": info["path"]},
    ))
    if not peaks:
        result.warnings.append(
            f"{name}: o .qgd não tem tabela de picos processada — integre e faça a busca na biblioteca no GCMSsolution e salve."
        )
    return result


# ---------------------------------------------------------------- entrada

_NEEDED_FID = ("File Property", "GC Raw Data-1/Status", "GC Raw Data-1/Intensity Data")
_NEEDED_MS = ("File Property", "GCMS Raw Data/Retention Time", "GCMS Raw Data/TIC Data",
              "GCMS Data Processing/MC Peak Info", "GCMS Data Processing/MC Peak Table")


def parse(content: bytes, filename: str = "") -> ParseResult:
    try:
        import olefile
    except ImportError as exc:  # pragma: no cover
        raise ParseError("Leitor de arquivos Shimadzu (olefile) não instalado no servidor.") from exc
    try:
        ole = olefile.OleFileIO(io.BytesIO(content))
    except Exception as exc:  # noqa: BLE001
        raise ParseError(f"Arquivo composto do Windows quebrado ({exc.__class__.__name__}).") from exc
    try:
        def read(names):
            return {n: ole.openstream(n).read() for n in names if ole.exists(n)}

        if ole.exists("GC Raw Data-1/Intensity Data"):
            return parse_fid(read(_NEEDED_FID), filename)
        if ole.exists("GCMS Raw Data/TIC Data"):
            return parse_ms(read(_NEEDED_MS), filename)
        if ole.exists("Workbook") or ole.exists("Book"):
            raise ParseError("Planilha do Excel no formato antigo (.xls) — salve como .xlsx e importe de novo.")
        raise ParseError(
            "Arquivo composto do Windows não reconhecido. Do GC, importe o .gcd (GCsolution, FID) ou o .qgd (GCMSsolution)."
        )
    finally:
        ole.close()
