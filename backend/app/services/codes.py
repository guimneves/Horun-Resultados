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

# Tipos de produto dos projetos de tabaco (pedido do usuário, 19/10/2026): a
# "fração" de uma amostra de tabaco é o tipo do produto. Só estes aparecem
# nos projetos de tabaco (e nenhum deles nos de rocha) — FractionType.sample_type.
FRACTION_CIGAR = "CHA"  # charuto
FRACTION_CIGARETTE = "CIG"  # cigarro
FRACTION_HOOKAH = "NAR"  # essência de narguilé
FRACTION_TOBACCO = "TAB"  # tabaco cujo tipo não veio no nome — a pessoa define
TOBACCO_TYPES = (FRACTION_CIGAR, FRACTION_CIGARETTE, FRACTION_HOOKAH)
TOBACCO_FRACTIONS: list[tuple[str, str, str]] = [
    (FRACTION_CIGAR, "Charuto", "Charutos (nomes com Charuto, Ch_, Cha_, Char_)."),
    (FRACTION_CIGARETTE, "Cigarro", "Cigarros (nomes com Cigarro, Cig_)."),
    (FRACTION_HOOKAH, "Essência de Narguilé", "Essências de narguilé (nomes com Narguilé, Essência, Nar_, Ess_)."),
    (FRACTION_TOBACCO, "Tabaco — tipo a definir", "O nome não diz se é charuto, cigarro ou essência — escolha o tipo na amostra."),
]

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


# ------------------------------------------------------------------ tabaco
#
# Projetos de tabaco (perfil "tabaco", docs/PERFIS_DE_PROJETO.md): a amostra é
# um PRODUTO (charuto, cigarro, folha...) e cada equipamento escreve o nome do
# seu jeito — "Ch_Produto_X_1" (CHNS), "Produto X - rep 2" (TG),
# "PRODUTO X" (LECO), "CHARUTO_PRODUTOX" (Rock-Eval). O leitor tira o
# que é ruído (réplica no fim, "(Triplicata)", "-Corrected", data, número da
# corrida, prefixo do tipo de produto "Ch_"/"Charuto") e a comparação usa
# `normalize_code` (sem acento, caixa e espaços), para o mesmo produto casar
# entre as técnicas. O que não casar a pessoa liga na prévia e o nome fica
# lembrado (SampleAlias). Sem fração (X) e sem temperatura.

_TOBACCO_NOISE_RE = re.compile(r"\((?:triplicata|duplicata|triturad[oa]|moid[oa])\)", re.IGNORECASE)
_TOBACCO_CORRECTED_RE = re.compile(r"[\s_-]*corrected\s*$", re.IGNORECASE)
_TOBACCO_DATE_RE = re.compile(r"\s+\d{4}-\d{2}-\d{2}(?:\s+C?h\d+)?\s*$", re.IGNORECASE)
_TOBACCO_LEADING_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[\s_-]+")
# número da corrida ("2-Charuto...") ou sigla do produto ("PX-Produto X", "P - Produto", "7P - 7 produtos");
# sigla colada só antes de palavra com minúsculas (não corta marcas como "XYZ-AMARELO")
_TOBACCO_RUN_RE = re.compile(r"^(?:\d{1,2}-(?=\D)|[A-Z0-9]{1,3}(?:\s+-\s+|-(?=[A-ZÀ-Ý][a-zà-ÿ])))")
_TOBACCO_TYPE_RE = re.compile(r"^(?:charuto[\s_-]*|(?:char|cha|ch)_)", re.IGNORECASE)
_TOBACCO_REP_RE = re.compile(r"^(?P<base>.*?\S)\s*-?\s*\brep\.?\s*(?P<rep>\d{1,2})$", re.IGNORECASE)
_TOBACCO_TAIL_RE = re.compile(r"^(?P<base>.*?[^\s_-])[\s_-]+(?P<rep>\d{1,2})$")
_TOBACCO_GLUED_RE = re.compile(r"^(?P<base>.*[A-Za-z]{2})(?P<rep>\d)$")  # "MARCA_SABOR1"
_TOBACCO_BLANKS = ("blank", "branco", "brancos")
_SPECTRUM_RE = re.compile(r"^spectrum\s*\d+$", re.IGNORECASE)


_TOBACCO_KIND_RES = (
    (FRACTION_CIGAR, re.compile(r"charut|^(?:\d{1,2}-)?(?:ch|cha|char)_|^(?:\d{1,2}-)?ch\s")),
    (FRACTION_CIGARETTE, re.compile(r"cigarr|^(?:\d{1,2}-)?cig[_\s-]")),
    (FRACTION_HOOKAH, re.compile(r"narguil|essenc|hookah|^(?:\d{1,2}-)?(?:nar|ess)[_\s-]")),
)


def tobacco_type(*names: str) -> str:
    """Tipo do produto pelo nome (o primeiro nome que disser): charuto,
    cigarro, essência de narguilé — ou "TAB" (a definir)."""
    for name in names:
        plain = strip_accents(name or "").lower().strip()
        for code, rx in _TOBACCO_KIND_RES:
            if rx.search(plain):
                return code
    return FRACTION_TOBACCO


def parse_tobacco_code(raw: str) -> CodeInfo:
    """Nome no arquivo → produto (base) + réplica. Ver o bloco acima."""
    raw = (raw or "").strip()
    text = _TOBACCO_NOISE_RE.sub(" ", raw)
    text = _TOBACCO_CORRECTED_RE.sub("", text.strip())
    text = _TOBACCO_DATE_RE.sub("", text.strip())
    text = _TOBACCO_LEADING_DATE_RE.sub("", text.strip())
    text = re.sub(r"\s+", " ", text).strip()
    plain = strip_accents(text).lower()
    if plain in _TOBACCO_BLANKS or any(plain == s or plain.startswith(s + " ") for s in _STANDARDS):
        kind = "blank" if plain in _TOBACCO_BLANKS else "standard"
        return CodeInfo(raw=raw, base_code=text, fraction=FRACTION_STANDARD if kind == "standard" else FRACTION_OTHER, kind=kind, recognized=True)
    if _SPECTRUM_RE.match(text):  # espectro do EDS enviado sem pastas: o nome é o rótulo, sem réplica
        return CodeInfo(raw=raw, base_code=text, fraction=FRACTION_OTHER)

    rep = None
    for rx in (_TOBACCO_REP_RE, _TOBACCO_TAIL_RE, _TOBACCO_GLUED_RE):
        m = rx.match(text)
        if m:
            text, rep = m.group("base"), int(m.group("rep"))
            break
    text = _TOBACCO_RUN_RE.sub("", text.strip()).strip()
    stripped = _TOBACCO_TYPE_RE.sub("", text).strip()
    if stripped and re.search(r"[A-Za-z]", stripped):
        text = stripped
    base = re.sub(r"\s+", " ", text.replace("_", " ")).strip(" -")
    return CodeInfo(raw=raw, base_code=base or raw, fraction=tobacco_type(raw), replicate=rep, recognized=bool(base))
