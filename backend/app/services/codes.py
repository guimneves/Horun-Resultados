"""Leitura dos códigos de amostra do laboratório (ESPECIFICACAO.md, seção 2).

O parser SUGERE temperatura, experimento, fração e réplica a partir do código;
quem importa confirma ou corrige na prévia. Código que não segue o padrão vira
amostra livre (fração "X"). Exemplos (todos cobertos por tests/test_codes.py):

    HP320 / HP320-1        hidropirólise a 320 °C, sem sufixo; "-1" = réplica de análise
    HP320H, HP320H-2       rocha hidropirolisada (H)
    HP320E, HP355E-1       rocha extraída (E)
    HP320E.1, HP320E.2     alíquotas .1/.2 da MESMA amostra HP320E (confirmado 07/10/2026)
    HP280SE                SE = "sem extração": hidropirolisada, não extraída (confirmado);
                           nos gráficos de série entra na mesma linha de H
    HP300NA, HP320NA2      experimento: N = atmosfera de nitrogênio, A/B/C = réplica do
                           experimento (corridas independentes na mesma temperatura);
                           número no fim (NA2) = 2º lote/análise da réplica A, faz parte
                           do código do experimento (confirmado)
    HP355NB, HP355NBE      rocha do experimento HP355NB; E = extraída
    RO-1, ROA, Rocha virgem 80 mesh   rocha original
    Sulphanilamide, Cistina, BBOT...  padrões
    C28, CF, C30 2104-1...            outras amostras (fora da série)
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass

# Frações (códigos curtos). Os significados ficam na tabela editável
# `FractionType` (db/models.py) — aqui só os códigos que o parser sugere.
FRACTION_ORIGINAL = "O"
FRACTION_PLAIN = "HP"  # HPxxx sem sufixo — significado a confirmar com o laboratório
FRACTION_H = "H"
FRACTION_E = "E"
FRACTION_SE = "SE"
FRACTION_GAS = "G"
FRACTION_STANDARD = "STD"
FRACTION_OTHER = "X"

# Fração → linha da série em que entra por padrão (SE = sem extração = H).
DEFAULT_SERIES_GROUP = {FRACTION_SE: FRACTION_H}

# Atmosfera do reator, pela letra logo após a temperatura no código do
# experimento (HP300NA → N). Catálogo pequeno: somar letras novas aqui.
ATMOSPHERES = {"N": "nitrogênio"}

DEFAULT_FRACTIONS: list[tuple[str, str, str]] = [
    (FRACTION_ORIGINAL, "Rocha original", "Rocha não aquecida (RO, ROA, rocha virgem)."),
    (FRACTION_PLAIN, "HP sem sufixo", "Código HPxxx sem letra de fração — significado a confirmar."),
    (FRACTION_H, "Hidropirolisada (sem extração)", "Rocha só hidropirolisada (sufixo H)."),
    (FRACTION_E, "Extraída", "Rocha hidropirolisada e extraída (sufixo E)."),
    (FRACTION_SE, "SE — sem extração", "Sufixo SE = sem extração: hidropirolisada, não extraída (mesma linha de H nas séries)."),
    (FRACTION_GAS, "Gás", "Gás gerado no reator (cromatografia GC-FID/TCD)."),
    (FRACTION_STANDARD, "Padrão", "Padrão de calibração ou de controle (fora das séries)."),
    (FRACTION_OTHER, "Outra", "Amostra que não segue o padrão de códigos (fora das séries)."),
]

# Padrões químicos conhecidos (comparação sem acento e sem caixa).
_STANDARDS = (
    "sulphanilamide",
    "sulfanilamide",
    "sulfanilamida",
    "cistina",
    "cystine",
    "bbot",
    "acido sulfanilico",
    "sulfanilic acid",
    "acetanilide",
    "acetanilida",
    "atropine",
    "metionina",
    "methionine",
    "padrao",
    "standard",
)

_ATM = "".join(sorted(ATMOSPHERES))
_HP_RE = re.compile(
    rf"""^(?:EXP)?HP
        (?P<temp>\d{{3}})
        (?P<exp>(?P<atm>[{_ATM}])(?P<letter>[A-Z])(?P<batch>\d*))?
        (?P<frac>SE|H|E)?
        (?:\.(?P<aliquot>\d+))?
        (?:[-_](?P<rep>\d+))?$""",
    re.VERBOSE,
)
_RO_RE = re.compile(r"^RO(?P<letter>[A-Z])?(?:[-_](?P<rep>\d+))?$")
_TRAILING_REP_RE = re.compile(r"^(?P<base>.*?\S)\s*-\s*(?P<rep>\d{1,2})$")
_EXPERIMENT_IN_TEXT_RE = re.compile(rf"HP\s*(\d{{3}})\s*([{_ATM}]\s*[A-Z]\s*\d*)", re.IGNORECASE)


@dataclass
class CodeInfo:
    """Sugestão lida do código. `base_code` é a amostra (sem a réplica de
    análise nem a alíquota); `replicate` é a réplica de análise (-1, -2...);
    `aliquot` é a alíquota (.1, .2) — fica na análise, não vira amostra."""

    raw: str
    base_code: str
    fraction: str
    temperature_c: float | None = None
    experiment_code: str | None = None
    atmosphere: str | None = None  # "nitrogênio" (letra N)
    experiment_replicate: str | None = None  # A, B, C
    replicate: int | None = None
    aliquot: int | None = None
    kind: str = "sample"  # sample | standard
    recognized: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


def strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def normalize_code(code: str) -> str:
    """Chave de comparação: sem acento, maiúsculas, sem espaços — "hp 320 h"
    e "HP320H" casam com a mesma amostra."""
    text = strip_accents(code or "").upper().replace("\xa0", " ")
    return re.sub(r"\s+", "", text)


def _compact(code: str) -> str:
    return normalize_code(code)


def parse_sample_code(raw: str) -> CodeInfo:
    raw = (raw or "").strip()
    compact = _compact(raw)

    m = _HP_RE.match(compact)
    if m:
        temp = float(m.group("temp"))
        exp = m.group("exp")
        frac_suffix = m.group("frac")
        aliquot = m.group("aliquot")
        rep = m.group("rep")
        base = f"HP{m.group('temp')}{exp or ''}{frac_suffix or ''}"
        fraction = {"H": FRACTION_H, "E": FRACTION_E, "SE": FRACTION_SE}.get(frac_suffix or "", FRACTION_PLAIN)
        return CodeInfo(
            raw=raw,
            base_code=base,
            fraction=fraction,
            temperature_c=temp,
            experiment_code=f"HP{m.group('temp')}{exp}" if exp else None,
            atmosphere=ATMOSPHERES.get(m.group("atm") or ""),
            experiment_replicate=m.group("letter"),
            replicate=int(rep) if rep else None,
            aliquot=int(aliquot) if aliquot else None,
            recognized=True,
        )

    m = _RO_RE.match(compact)
    if m:
        base = f"RO{m.group('letter') or ''}"
        return CodeInfo(
            raw=raw,
            base_code=base,
            fraction=FRACTION_ORIGINAL,
            replicate=int(m.group("rep")) if m.group("rep") else None,
            recognized=True,
        )

    # Réplica de análise no fim ("Rocha virgem 80 mesh-1", "C30 2104-1").
    base_text, rep = raw, None
    tail = _TRAILING_REP_RE.match(raw)
    if tail:
        base_text, rep = tail.group("base").rstrip(" -"), int(tail.group("rep"))

    plain = strip_accents(base_text).lower()
    if "rocha virgem" in plain or "rocha original" in plain:
        return CodeInfo(raw=raw, base_code=base_text, fraction=FRACTION_ORIGINAL, replicate=rep, recognized=True)
    if any(plain == s or plain.startswith(s + " ") for s in _STANDARDS):
        return CodeInfo(
            raw=raw, base_code=base_text, fraction=FRACTION_STANDARD, replicate=rep, kind="standard", recognized=True
        )
    return CodeInfo(raw=raw, base_code=base_text or raw, fraction=FRACTION_OTHER, replicate=rep)


def parse_experiment_code(code: str) -> dict:
    """Partes de um código de experimento (HP355NB → 355 °C, nitrogênio, réplica B)."""
    info = parse_sample_code(code)
    return {
        "code": info.experiment_code or info.base_code,
        "temperature_c": info.temperature_c,
        "atmosphere": info.atmosphere,
        "replicate_letter": info.experiment_replicate,
    }


def atmosphere_from_gas_name(name: str | None) -> str | None:
    """"Nitrogênio" (campo "Selecione o gás" da planilha) → "nitrogênio"."""
    if not name:
        return None
    plain = strip_accents(str(name)).strip().lower()
    for label in ATMOSPHERES.values():
        if strip_accents(label) in plain:
            return label
    return plain or None


def experiment_code_from_text(*texts: str | None) -> str | None:
    """Primeiro código de experimento (HPxxxN<letra>[n]) achado nos textos
    (nome da pasta, do arquivo, célula da planilha), na ordem dada."""
    for text in texts:
        if not text:
            continue
        m = _EXPERIMENT_IN_TEXT_RE.search(strip_accents(text))
        if m:
            run = re.sub(r"\s+", "", m.group(2)).upper()
            return f"HP{m.group(1)}{run}"
    return None
