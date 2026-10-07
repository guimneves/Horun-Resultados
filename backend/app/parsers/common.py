"""Tipos comuns dos leitores de arquivo (ESPECIFICACAO.md, seção 3)."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field


class ParseError(Exception):
    """Arquivo que deveria ser de resultados mas não pôde ser lido — a
    mensagem (em português) vai direto para a pessoa."""


class NotResultsFile(ParseError):
    """Arquivo reconhecido que NÃO é de resultados (relatório de configuração,
    calibração, diagnóstico...). Fica como "ignorado", com o motivo."""


@dataclass
class Value:
    parameter: str
    value: float
    unit: str = ""
    replicate: int | None = None


@dataclass
class ExperimentInfo:
    code: str
    temperature_c: float | None = None
    atmosphere: str | None = None
    replicate_letter: str | None = None
    reactor: str | None = None
    initial_mass_g: float | None = None
    conditions: dict = field(default_factory=dict)


@dataclass
class Record:
    """Uma medição encontrada no arquivo (vira uma `Analysis`)."""

    key: str  # chave natural dentro da técnica (dedupe ao reimportar)
    raw_name: str  # nome da amostra como veio no arquivo
    technique: str
    kind: str = "sample"  # sample | standard | blank | other
    analyzed_at: str = ""
    instrument: str = ""
    method: str = ""
    values: list[Value] = field(default_factory=list)
    data: dict | None = None  # curvas / tabelas (JSON)
    extra: dict = field(default_factory=dict)
    # Sugestões que o leitor sabe melhor que o código (ex. gás → fração G,
    # experimento lido da pasta)
    code_hint: str | None = None
    fraction_hint: str | None = None
    experiment: ExperimentInfo | None = None


@dataclass
class ParseResult:
    technique: str
    format_label: str
    records: list[Record] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # Prioridade quando duas fontes trazem a mesma medição no mesmo lote
    # (o resumo do CHNSO vale mais que o PDF de uma amostra só).
    priority: int = 0
    # Desempate com a mesma prioridade: vale o maior (ex. a data de
    # impressão do relatório — a impressão mais nova do mesmo relatório).
    tiebreak: str = ""


_NUM_RE = re.compile(r"[-+]?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?")


def to_float(raw) -> float | None:
    """Número de célula/texto: aceita "21.0 %", "0.2515 g", 3, "1,5".
    Vazio, "-", "NaN", "ND", "NA" → None."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
        return None if math.isnan(value) or math.isinf(value) else value
    text = str(raw).strip().replace("\xa0", " ")
    if not text or text in {"-", "—"} or text.lower() in {"nan", "nd", "na", "n/a", "nan %"}:
        return None
    m = _NUM_RE.search(text)
    if not m:
        return None
    try:
        value = float(m.group(0).replace(",", "."))
    except ValueError:
        return None
    return None if math.isnan(value) else value


def clean_label(text) -> str:
    return re.sub(r"\s+", " ", str(text or "").replace("\xa0", " ")).strip()
