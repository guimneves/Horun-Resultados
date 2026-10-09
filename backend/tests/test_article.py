"""Séries → Artigo: dados das figuras do artigo de hidropirólise a partir do
gás (tabela consolidada ou planilha de cálculo) e do Rock-Eval. Sintético."""

import pytest

from tests import synthetic as syn
from tests.conftest import PESQ, confirm, upload


def _rock(name, toc, s2, hi, tmax, n):
    return {"analysis": f"A{n}", "sample": name, "toc": toc, "tmax": tmax, "s1": 1.0, "s2": s2, "hi": hi, "oi": 20, "curves": False}


@pytest.fixture
def data(client, project):
    pid = project["id"]
    htm = syn.rockeval_htm(
        [
            _rock("RO", 10.0, 60.0, 600, 415, 1),  # rocha original: COT0 = 10 %
            _rock("HP300H", 10.0, 45.0, 450, 426, 2),
            _rock("HP320H", 9.0, 15.0, 150, 439, 3),
        ]
    )
    confirm(client, pid, upload(client, pid, {"rockeval.htm": htm}))
    gas = syn.gas_consolidated_xlsx(
        {
            # componente, mol%, massa cromatografia (g), massa pressão (g) — MM vem nula no sintético
            "HP300NA": [("H2", 5.0, 0.02016, None), ("CO2", 80.0, 0.88018, None), ("Metano", 15.0, 0.16043, None)],
            "HP320NA": [("H2", 10.0, 0.04032, None), ("CO2", 60.0, 0.88018, None), ("Metano", 30.0, 0.32086, None)],
        },
        {"HP300NA": 100.0, "HP320NA": 100.0},
    )
    confirm(client, pid, upload(client, pid, {"consolidada.xlsx": gas}))
    return pid


def test_article_data(client, data):
    r = client.get(f"projects/{data}/article", headers=PESQ)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["toc0"] == pytest.approx(10.0)
    assert out["yield_unit"] == "µmol/g COT₀"
    temps = [g["temperature_c"] for g in out["gas"]]
    assert temps == [300, 320]
    g300 = out["gas"][0]
    # sem massa molar na planilha sintética → mols estimados pela composição e massa total
    assert out["yields_estimated"] is True
    assert g300["mole_pct"]["H2"]["mean"] == pytest.approx(5.0)
    assert g300["yields"]["H2"]["mean"] > 0 and g300["yields"]["CO2"]["mean"] > g300["yields"]["H2"]["mean"]
    assert g300["h2_share"]["mean"] == pytest.approx(5.0, rel=1e-3)
    assert g300["rock_g"]["mean"] == 100.0
    res = {r_["temperature_c"]: r_ for r_ in out["residue"]}
    assert out["before"]["S2"] == pytest.approx(60.0)
    assert res[300]["s2_depletion"] == pytest.approx(25.0)
    assert res[320]["transformation_rate"] == pytest.approx(75.0)
    assert res[320]["after"]["Tmax"]["mean"] == 439


def test_exact_moles_with_molar_mass(client, project):
    pid = project["id"]
    import io

    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(syn.gas_consolidated_xlsx({"HP300NA": [("H2", 50.0, 2.016, None), ("Metano", 50.0, 16.043, None)]}, {"HP300NA": 100.0})))
    det = wb["Detalhe"]
    for row in det.iter_rows(min_row=2):
        if row[3].value == "H2":
            row[4].value = 2.016
        if row[3].value == "Metano":
            row[4].value = 16.043
    buf = io.BytesIO()
    wb.save(buf)
    confirm(client, pid, upload(client, pid, {"c.xlsx": buf.getvalue()}))
    out = client.get(f"projects/{pid}/article", headers=PESQ).json()
    assert out["yields_estimated"] is False
    assert out["yield_unit"] == "µmol/g rocha"  # sem rocha original no projeto
    # 1 mol de H2 e 1 mol de CH4 em 100 g de rocha → 10 000 µmol/g
    assert out["gas"][0]["yields"]["H2"]["mean"] == pytest.approx(10000.0)
    assert out["gas"][0]["yields"]["C1"]["mean"] == pytest.approx(10000.0)
    assert out["gas"][0]["h2_share"]["mean"] == pytest.approx(50.0)
