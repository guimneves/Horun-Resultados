"""Tabela consolidada de composição de gás (modelo alternativo à planilha de
cálculo de gás de cada experimento). Planilha sintética, valores inventados."""

import pytest

from app.parsers import parse_file
from tests import synthetic as syn
from tests.conftest import PESQ, confirm, upload

EXPS = {
    "HP300NA": [
        ("H2", 4.0, 0.01, 0.012),
        ("CO2", 76.0, 2.0, 2.4),
        ("Metano", 10.0, 0.10, 0.12),
        ("Eteno", 1.0, 0.01, 0.012),
        ("Etano", 3.0, 0.05, 0.06),
        ("Propano", 2.0, 0.04, 0.048),
        ("n-Butano", 1.0, 0.03, 0.036),
        ("C4 (não identificado)", 0.5, None, None),
        ("n-Pentano", 1.0, 0.02, 0.024),
        ("C6 (não identificados)", 1.0, 0.02, 0.024),
        ("n-Heptano", 0.5, None, None),
    ],
    "HP320NA2": [("H2", 5.0, 0.01, 0.01), ("CO2", 75.0, 2.0, 2.0), ("Metano", 20.0, 0.2, 0.2)],
}


def test_parser_groups_and_masses():
    r = parse_file("Tabela_final_consolidada.xlsx", syn.gas_consolidated_xlsx(EXPS, {"HP300NA": 150.0, "HP320NA2": 100.0}))
    assert r.technique == "gas_balanco"
    by = {rec.raw_name: {v.parameter: v.value for v in rec.values} for rec in r.records}
    assert set(by) == {"HP300NA", "HP320NA2"}
    v = by["HP300NA"]
    assert v["comp_H2"] == pytest.approx(4.0)
    assert v["comp_C2"] == pytest.approx(4.0)  # eteno + etano
    assert v["comp_C4"] == pytest.approx(1.5)  # n-butano + C4 não identificado
    assert v["comp_C5p"] == pytest.approx(2.5)  # C5 + C6 + C7
    assert sum(val for k, val in v.items() if k.startswith("comp_")) == pytest.approx(100.0)
    assert v["gas_mass_g"] == pytest.approx(2.28)
    assert v["gas_mass_pressure_g"] == pytest.approx(2.736)
    assert v["initial_mass_g"] == 150.0
    assert v["gas_yield_mg_g"] == pytest.approx(1000 * 2.28 / 150)
    assert v["gas_yield_pressure_mg_g"] == pytest.approx(1000 * 2.736 / 150)
    rec = next(x for x in r.records if x.raw_name == "HP320NA2")
    assert rec.experiment.temperature_c == 320 and rec.experiment.conditions["tabela_consolidada"]["Pressão inicial (psi g)"] == 25
    assert any("sem código de experimento" in w for w in r.warnings)


def test_without_summary_warns():
    r = parse_file("t.xlsx", syn.gas_consolidated_xlsx({"HP300NA": EXPS["HP300NA"]}))
    values = {v.parameter for v in r.records[0].values}
    assert "gas_yield_mg_g" not in values and "gas_mass_g" in values
    assert any("massa inicial" in w for w in r.warnings)


def test_same_key_as_gas_sheet_updates_instead_of_duplicating(client, project):
    pid = project["id"]
    confirm(client, pid, upload(client, pid, {"HP300NA - Planilha cálculo gás.xlsx": syn.gas_xlsx("HP300NA", gas_mass=1.0)}))
    confirm(client, pid, upload(client, pid, {"consolidada.xlsx": syn.gas_consolidated_xlsx(EXPS, {"HP300NA": 150.0, "HP320NA2": 100.0})}))
    samples = {s["code"]: s for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    gas = samples["HP300NA (gás)"]
    assert gas["values"]["gas_balanco.gas_mass_g"]["n"] == 1  # uma medição só, atualizada
    assert gas["values"]["gas_balanco.gas_mass_g"]["mean"] == pytest.approx(2.28)
    assert gas["temperature_c"] == 300
    assert "HP320NA2 (gás)" in samples
