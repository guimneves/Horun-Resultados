"""MEV-EDS — exportação do Oxford AZtec (ESPECIFICACAO.md, 3.11).

Cada espectro vira uma pasta `.../<amostra>/[<região>/]eds/Sample 1/Spectrum NN/`
com vários arquivos. Só o "Spectrum NN Quantity analysis.csv" é de resultados:

    AV;20000                 ← metadados "CHAVE;valor"
    ...
    (linha em branco)
    Element,Atomic %,Weight %
    Carbon,55.00%,45.00%

O "Spectrum NN Spectrum.csv" ("Energy [eV];Counts"), o `.msa` (EMSA) e as
imagens são o espectro bruto / figuras → "ignorado", com o motivo.

A amostra NÃO está no arquivo: vem das pastas (`path_hint` do .zip). Ex.
"MEV/produto x/externo/eds/Sample 1/Spectrum 12" → amostra "produto x",
região "externo", espectro 12 (= réplica). Sem pastas, o nome é o do
arquivo ("Spectrum 12") e a pessoa liga à amostra na prévia.
"""

from __future__ import annotations

import re

from app.parsers.common import NotResultsFile, ParseError, ParseResult, Record, Value, clean_label, to_float
from app.services.catalog import EDS_ELEMENTS
from app.services.codes import strip_accents

TECHNIQUE = "mev_eds"
_SYMBOLS = {sym.lower(): sym for sym, _name in EDS_ELEMENTS}
_NAMES = {name.lower(): sym for sym, name in EDS_ELEMENTS}
_NAMES.update({"aluminum": "Al", "sulphur": "S"})
_EDS_DIR_RE = re.compile(r"^eds\d*$", re.IGNORECASE)
_SPECTRUM_RE = re.compile(r"^spectrum\s*(\d+)$", re.IGNORECASE)
_SAMPLE_DIR_RE = re.compile(r"^sample\s*\d+$", re.IGNORECASE)
# pastas que são REGIÃO da amostra (folha externa, miolo...), não a amostra
_REGION_RE = re.compile(r"\b(extern[oa]s?|intern[oa]s?|miolo|capa|capote|talo|borda|centro|superficie|cinzas?)\b", re.IGNORECASE)


def is_eds_dir(name: str) -> bool:
    return bool(_EDS_DIR_RE.match(name.strip()))


def looks_like_eds_quantity(text: str) -> bool:
    return bool(re.search(r"^Element,\s*Atomic %,\s*Weight %", text[:5000], re.MULTILINE))


def looks_like_eds_spectrum(text: str) -> bool:
    head = text[:3000]
    return "Energy [eV];Counts" in head or ("#FORMAT" in head and "EMSA" in head)


def reject_spectrum() -> None:
    raise NotResultsFile(
        "Espectro bruto do EDS (energia × contagens) — não traz a composição. Importe o \"... Quantity analysis.csv\" "
        "da mesma pasta (os espectros podem vir junto no .zip, são ignorados)."
    )


def symbol(name: str) -> str | None:
    key = strip_accents(clean_label(name)).lower()
    return _NAMES.get(key) or _SYMBOLS.get(key)


def where_from_path(path_hint: str, filename: str) -> dict:
    """Amostra, região, pasta do EDS e espectro a partir das pastas."""
    parts = [p.strip() for p in path_hint.replace("\\", "/").split("/") if p.strip()]
    spectrum = None
    m = re.match(r"^(spectrum\s*\d+)", filename.strip(), re.IGNORECASE)
    if m:
        spectrum = m.group(1)
    for p in reversed(parts):
        if _SPECTRUM_RE.match(p):
            spectrum = spectrum or p
            break
    i_eds = next((i for i in range(len(parts) - 1, -1, -1) if _EDS_DIR_RE.match(parts[i])), None)
    sample, region = None, ""
    if i_eds is not None and i_eds >= 1:
        before = parts[:i_eds]
        if len(before) >= 2 and _REGION_RE.search(strip_accents(before[-1])):
            region, sample = before[-1], before[-2]
        else:
            sample = before[-1]
        if sample.lower().endswith(".zip") or sample.upper() == "MEV":
            sample = None
    n = _SPECTRUM_RE.match(spectrum or "")
    return {
        "sample": sample,
        "region": region,
        "eds_dir": parts[i_eds] if i_eds is not None else "",
        "spectrum": spectrum or re.sub(r"\s*quantity analysis\.csv$", "", filename, flags=re.IGNORECASE),
        "spectrum_n": int(n.group(1)) if n else None,
    }


def _voltage(raw: str | None) -> str:
    v = to_float(raw)
    if v is None:
        return ""
    return f"{v / 1000:g} kV" if v >= 1000 else f"{v:g} kV"


def parse(content: bytes, filename: str = "", path_hint: str = "") -> ParseResult:
    text = content.decode("utf-8-sig", errors="replace")
    if looks_like_eds_spectrum(text):
        reject_spectrum()
    if not looks_like_eds_quantity(text):
        raise ParseError("Este CSV não é um \"Quantity analysis\" do EDS (Oxford AZtec).")
    lines = text.splitlines()
    meta: dict[str, str] = {}
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^Element,\s*Atomic %,\s*Weight %", line):
            start = i
            break
        if ";" in line:
            k, v = line.split(";", 1)
            meta[k.strip()] = v.strip()
    values: list[Value] = []
    unknown: list[str] = []
    for line in lines[(start or 0) + 1 :]:
        if not line.strip():
            break
        cells = [c.strip() for c in line.split(",")]
        if len(cells) < 3:
            continue
        sym = symbol(cells[0])
        if sym is None:
            unknown.append(cells[0])
            continue
        at, wt = to_float(cells[1]), to_float(cells[2])
        if wt is not None:
            values.append(Value(f"wt_{sym}", wt, "% massa"))
        if at is not None:
            values.append(Value(f"at_{sym}", at, "% atômica"))
    if not values:
        raise ParseError("Nenhum elemento encontrado no \"Quantity analysis\" do EDS.")

    where = where_from_path(path_hint, filename)
    result = ParseResult(TECHNIQUE, "MEV-EDS — Quantity analysis (Oxford AZtec)")
    if unknown:
        result.warnings.append(f"Elemento(s) fora do catálogo, não importados: {', '.join(unknown)}.")
    if not where["sample"]:
        result.warnings.append(
            "Sem as pastas do MEV (amostra/região/eds/...) — o nome é o do espectro; ligue à amostra na prévia. "
            "Dica: envie o .zip com as pastas."
        )
    raw_name = where["sample"] or where["spectrum"]
    key = "|".join(x for x in (where["sample"] or "", where["region"], where["eds_dir"], where["spectrum"]) if x)
    result.records.append(
        Record(
            key=key,
            raw_name=raw_name,
            technique=TECHNIQUE,
            instrument="MEV-EDS (Oxford AZtec)",
            method=_voltage(meta.get("AV")),
            values=values,
            extra={
                "region": where["region"],
                "spectrum": where["spectrum"],
                "eds_dir": where["eds_dir"],
                "replicate_hint": where["spectrum_n"],
                "counts": to_float(meta.get("Total number of counts")),
            },
        )
    )
    return result
