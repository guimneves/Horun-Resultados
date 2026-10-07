"""CHNSO — EuroVector, PDFs de relatório (ESPECIFICACAO.md, 3.1).

* "Results Summary for Element %": a corrida inteira, uma linha por posição:
  `# | Type (Byp/Std/Smp) | Name | N% | C% | H% | S% | O% | W (mg)`.
* "Single Sample Result (N-Type-Name)": uma amostra só (mesma informação).

O pypdf entrega UMA PALAVRA POR LINHA; nomes podem ter várias palavras e vêm
quebrados ("HP280-" "1"). Uma linha da tabela começa com o nº inteiro da
posição seguido do tipo; os 6 últimos itens da linha são os valores (número
com ponto decimal ou "-").
"""

from __future__ import annotations

import io
import re
from datetime import datetime

from app.parsers.common import NotResultsFile, ParseError, ParseResult, Record, Value, to_float

TECHNIQUE = "chnso"
ROW_TYPES = {"Byp": "bypass", "Std": "standard", "Smp": "sample", "Blk": "blank"}
COLUMNS = [("N", "%"), ("C", "%"), ("H", "%"), ("S", "%"), ("O", "%"), ("W", "mg")]
ELEMENTS = {"Nitrogen": "N", "Carbon": "C", "Hydrogen": "H", "Sulphur": "S", "Sulfur": "S", "Oxygen": "O"}

_DATE_RE = re.compile(r"(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) - (\d{2}):(\d{2}):(\d{2})")
_VALUE_RE = re.compile(r"^(?:-|[-+]?\d+\.\d+)$")

# Outros relatórios do mesmo aparelho: reconhecidos, mas não são o que se importa.
_OTHER_REPORTS = [
    ("Results Summary for Element Micrograms", "o resumo em microgramas"),
    ("Results Summary for Area %", "o resumo de Área %"),
    ("Results Summary for Area", "o resumo de Área"),
    ("Results Summary for K- Factor", "o resumo de K-Factor"),
    ("Results Summary for K-Factor", "o resumo de K-Factor"),
    ("Calibration Results", "o relatório de calibração"),
    ("Instrument and Data Processing Parameters", "o relatório de parâmetros do instrumento"),
]


def _pages_tokens(content: bytes) -> list[list[str]]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover — dependência do Dockerfile
        raise ParseError("Leitor de PDF (pypdf) não instalado no servidor.") from exc
    try:
        reader = PdfReader(io.BytesIO(content))
        return [[t.strip() for t in (page.extract_text() or "").split("\n") if t.strip()] for page in reader.pages]
    except Exception as exc:  # noqa: BLE001
        raise ParseError(f"Não foi possível ler o PDF ({exc.__class__.__name__}).") from exc


def is_eurovector(first_page_text: str) -> bool:
    return "EuroVector" in first_page_text and "AutoRun" in first_page_text


def _join_name(tokens: list[str]) -> str:
    out = ""
    for tok in tokens:
        if not out:
            out = tok
        elif out.endswith("-"):
            out += tok
        else:
            out += " " + tok
    return out.strip()


def _printed_at(tokens: list[str]) -> str:
    """Data de impressão (1ª linha do PDF, "28 Sep 2026 - 14:28:16") em ISO."""
    m = _DATE_RE.match(tokens[0]) if tokens else None
    if not m:
        return ""
    try:
        return datetime.strptime(m.group(0), "%d %b %Y - %H:%M:%S").isoformat()
    except ValueError:
        return ""


def _header(tokens: list[str]) -> tuple[str, str]:
    """(nome da corrida AutoRun, data da análise ISO) a partir do cabeçalho."""
    try:
        start = tokens.index("Group") + 1
    except ValueError:
        return "", ""
    text = " ".join(tokens[start : start + 40])
    m = _DATE_RE.search(text)
    if not m:
        return "", ""
    name = re.sub(r"-\s+", "-", text[: m.start()].strip())
    try:
        when = datetime.strptime(" ".join(m.groups()[:3]) + " " + ":".join(m.groups()[3:]), "%d %b %Y %H:%M:%S")
        iso = when.strftime("%Y-%m-%d %H:%M")
    except ValueError:
        iso = m.group(0)
    return name, iso


def parse(content: bytes, filename: str = "") -> ParseResult:
    pages = _pages_tokens(content)
    if not pages or not pages[0]:
        raise ParseError("PDF sem texto legível (é um PDF escaneado?).")
    first = " ".join(pages[0])
    if not is_eurovector(first):
        raise ParseError("Este PDF não é um relatório do analisador elementar EuroVector (CHNSO).")
    if "Results Summary for Element %" in first:
        return _parse_summary(pages)
    if "Single Sample Result" in first:
        return _parse_single(pages[0])
    for marker, what in _OTHER_REPORTS:
        if marker in first:
            raise NotResultsFile(
                f"Este PDF do CHNSO é {what}, não os resultados. "
                "Importe o \"Results Summary for Element %\" (ou os \"Single Sample Result\")."
            )
    raise NotResultsFile("Relatório do CHNSO de um tipo que não traz os resultados em %.")


def _parse_summary(pages: list[list[str]]) -> ParseResult:
    run_name, analyzed_at = _header(pages[0])
    result = ParseResult(TECHNIQUE, "CHNSO — Results Summary for Element %", priority=10, tiebreak=_printed_at(pages[0]))
    body: list[str] = []
    for index, tokens in enumerate(pages):
        start = None
        for i in range(len(tokens) - 1):
            if tokens[i] == "W" and tokens[i + 1] == "(mg)":
                start = i + 2
                break
        if start is None:
            # páginas seguintes: pula "data | Page | n | of | m"
            start = 0
            for i in range(len(tokens) - 3):
                if tokens[i] == "Page" and tokens[i + 2] == "of":
                    start = i + 4
                    break
        if index == 0 and start == 0:
            raise ParseError("Não achei a tabela \"# | Type | Name | N% ... W (mg)\" neste PDF do CHNSO.")
        body.extend(tokens[start:])

    starts = [i for i in range(len(body) - 1) if body[i].isdigit() and body[i + 1] in ROW_TYPES]
    if not starts:
        raise ParseError("A tabela do CHNSO está vazia.")
    bypass = 0
    for n, i in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(body)
        row = body[i:end]
        position, row_type = row[0], ROW_TYPES[row[1]]
        rest = row[2:]
        if row_type == "bypass":
            bypass += 1
            continue
        if len(rest) < 7 or not all(_VALUE_RE.match(t) for t in rest[-6:]):
            result.warnings.append(f"Posição {position}: linha incompleta no PDF, ignorada.")
            continue
        name = _join_name(rest[:-6])
        values = [
            Value(param, v, unit)
            for (param, unit), tok in zip(COLUMNS, rest[-6:], strict=True)
            if (v := to_float(tok)) is not None
        ]
        result.records.append(
            Record(
                key=f"{run_name}:{position}",
                raw_name=name,
                technique=TECHNIQUE,
                kind=row_type,
                analyzed_at=analyzed_at,
                instrument="EuroVector EA",
                method=run_name,
                values=values,
                extra={"position": int(position), "run": run_name},
            )
        )
    if bypass:
        result.warnings.append(f"{bypass} posição(ões) Bypass ignorada(s).")
    return result


def _after(tokens: list[str], *seq: str) -> int | None:
    n = len(seq)
    for i in range(len(tokens) - n + 1):
        if tuple(tokens[i : i + n]) == seq:
            return i + n
    return None


def _parse_single(tokens: list[str]) -> ParseResult:
    run_name, analyzed_at = _header(tokens)
    result = ParseResult(TECHNIQUE, "CHNSO — Single Sample Result", priority=1, tiebreak=_printed_at(tokens))
    name_start = _after(tokens, "Sample", "Name")
    pos_start = _after(tokens, "Sample", "Position", "#")
    if name_start is None or pos_start is None:
        raise ParseError("Não achei \"Sample Name\" / \"Sample Position\" neste PDF de uma amostra do CHNSO.")
    name = _join_name(tokens[name_start : pos_start - 3])
    position = tokens[pos_start]
    type_at = _after(tokens, "Type")
    row_type = ROW_TYPES.get(tokens[pos_start + 2] if tokens[pos_start + 1] == "Type" else "", "sample")
    if type_at is None:
        row_type = "sample"
    if row_type == "bypass":
        raise NotResultsFile("PDF de uma posição Bypass do CHNSO (sem amostra).")
    values: list[Value] = []
    weight_at = _after(tokens, "Sample", "Weight", "(mg)")
    if weight_at is not None and (w := to_float(tokens[weight_at])) is not None:
        values.append(Value("W", w, "mg"))
    # a tabela de resultados vem depois de "... End (sec)"; os "Std Values"
    # (valores teóricos do padrão) vêm antes e são ignorados
    table_at = None
    for i in range(len(tokens) - 1):
        if tokens[i] == "End" and tokens[i + 1] == "(sec)":
            table_at = i + 2
    if table_at is None:
        raise ParseError("Não achei a tabela de elementos neste PDF de uma amostra do CHNSO.")
    table = tokens[table_at:]
    for i, tok in enumerate(table[:-1]):
        param = ELEMENTS.get(tok)
        if param and (v := to_float(table[i + 1])) is not None and _VALUE_RE.match(table[i + 1]):
            values.append(Value(param, v, "%"))
    result.records.append(
        Record(
            key=f"{run_name}:{position}",
            raw_name=name,
            technique=TECHNIQUE,
            kind=row_type,
            analyzed_at=analyzed_at,
            instrument="EuroVector EA",
            method=run_name,
            values=values,
            extra={"position": int(position) if position.isdigit() else position, "run": run_name},
        )
    )
    return result
