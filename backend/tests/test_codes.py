"""Códigos de amostra — todos os exemplos de ESPECIFICACAO.md, seção 2, com
as respostas do mantenedor (07/10/2026): SE = sem extração (linha de H nas
séries); .1/.2 = alíquotas da MESMA amostra; N = atmosfera de nitrogênio e
A/B/C = réplicas do experimento (número no fim faz parte do código)."""

from __future__ import annotations

import pytest

from app.services.codes import (
    atmosphere_from_gas_name,
    experiment_code_from_text,
    normalize_code,
    parse_experiment_code,
    parse_sample_code,
)

N2 = "nitrogênio"

# código → (amostra base, fração, temperatura, experimento, atmosfera, réplica exp., réplica análise, alíquota, tipo)
CASES = {
    "HP320": ("HP320", "HP", 320, None, None, None, None, None, "sample"),
    "HP320-1": ("HP320", "HP", 320, None, None, None, 1, None, "sample"),
    "HP280-1": ("HP280", "HP", 280, None, None, None, 1, None, "sample"),
    "HP320H": ("HP320H", "H", 320, None, None, None, None, None, "sample"),
    "HP320H-2": ("HP320H", "H", 320, None, None, None, 2, None, "sample"),
    "HP320E": ("HP320E", "E", 320, None, None, None, None, None, "sample"),
    "HP355E-1": ("HP355E", "E", 355, None, None, None, 1, None, "sample"),
    "HP320E.1": ("HP320E", "E", 320, None, None, None, None, 1, "sample"),
    "HP320E.2": ("HP320E", "E", 320, None, None, None, None, 2, "sample"),
    "HP280SE": ("HP280SE", "SE", 280, None, None, None, None, None, "sample"),
    "HP330SE": ("HP330SE", "SE", 330, None, None, None, None, None, "sample"),
    "HP300NA": ("HP300NA", "HP", 300, "HP300NA", N2, "A", None, None, "sample"),
    "HP280NB": ("HP280NB", "HP", 280, "HP280NB", N2, "B", None, None, "sample"),
    "HP320NC": ("HP320NC", "HP", 320, "HP320NC", N2, "C", None, None, "sample"),
    "HP320NA2": ("HP320NA2", "HP", 320, "HP320NA2", N2, "A", None, None, "sample"),
    "HP355NB": ("HP355NB", "HP", 355, "HP355NB", N2, "B", None, None, "sample"),
    "HP355NBE": ("HP355NBE", "E", 355, "HP355NB", N2, "B", None, None, "sample"),
    "RO-1": ("RO", "O", None, None, None, None, 1, None, "sample"),
    "ROA": ("ROA", "O", None, None, None, None, None, None, "sample"),
    "Rocha virgem 80 mesh": ("Rocha virgem 80 mesh", "O", None, None, None, None, None, None, "sample"),
    "Rocha virgem 80 mesh-2": ("Rocha virgem 80 mesh", "O", None, None, None, None, 2, None, "sample"),
    "Sulphanilamide": ("Sulphanilamide", "STD", None, None, None, None, None, None, "standard"),
    "sulphanilamide": ("sulphanilamide", "STD", None, None, None, None, None, None, "standard"),
    "Sulfanilamida": ("Sulfanilamida", "STD", None, None, None, None, None, None, "standard"),
    "Cistina": ("Cistina", "STD", None, None, None, None, None, None, "standard"),
    "BBOT": ("BBOT", "STD", None, None, None, None, None, None, "standard"),
    "Ácido Sulfanílico": ("Ácido Sulfanílico", "STD", None, None, None, None, None, None, "standard"),
    "C28": ("C28", "X", None, None, None, None, None, None, "sample"),
    "CF": ("CF", "X", None, None, None, None, None, None, "sample"),
    "CF-3": ("CF", "X", None, None, None, None, 3, None, "sample"),
    "C30 2104-1": ("C30 2104", "X", None, None, None, None, 1, None, "sample"),
}


@pytest.mark.parametrize("code", list(CASES))
def test_every_example_code(code):
    base, frac, temp, exp, atm, letter, rep, aliquot, kind = CASES[code]
    info = parse_sample_code(code)
    assert info.base_code == base
    assert info.fraction == frac
    assert info.temperature_c == (float(temp) if temp is not None else None)
    assert info.experiment_code == exp
    assert info.atmosphere == atm
    assert info.experiment_replicate == letter
    assert info.replicate == rep
    assert info.aliquot == aliquot
    assert info.kind == kind


def test_aliquots_map_to_the_same_sample():
    assert parse_sample_code("HP320E.1").base_code == parse_sample_code("HP320E.2").base_code == "HP320E"


def test_tolerant_to_spaces_case_and_exp_prefix():
    assert parse_sample_code("hp 320 h").base_code == "HP320H"
    assert parse_sample_code("HP 320 NA").experiment_code == "HP320NA"
    assert parse_sample_code("EXPHP330NB").experiment_code == "HP330NB"
    assert normalize_code(" hp320 e ") == normalize_code("HP320E")


def test_unknown_code_is_free_sample():
    info = parse_sample_code("Amostra misteriosa")
    assert info.fraction == "X" and not info.recognized


def test_experiment_parts():
    assert parse_experiment_code("HP355NB") == {"code": "HP355NB", "temperature_c": 355.0, "atmosphere": N2, "replicate_letter": "B"}
    assert parse_experiment_code("HP320NA2")["replicate_letter"] == "A"


def test_experiment_code_from_folder_and_file_names():
    assert experiment_code_from_text("HP320NA2 - LF", "HP 320 NA - Dados FID.xlsx") == "HP320NA2"
    assert experiment_code_from_text(None, "Modelo - EXPHP330NB- Dados FID.xlsx") == "HP330NB"
    assert experiment_code_from_text("EXPXXXXX") is None


def test_atmosphere_from_gas_sheet():
    assert atmosphere_from_gas_name("Nitrogênio") == N2
    assert atmosphere_from_gas_name(None) is None
