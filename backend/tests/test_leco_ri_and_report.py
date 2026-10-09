"""LECO - Resíduo Insolúvel (leitor novo) e o relatório em Excel do botão
"Exportar". Planilhas sintéticas, códigos genéricos."""

import io

import openpyxl
import pytest

from app.parsers import parse_file
from app.parsers.common import ParseError
from app.parsers.leco_ri import code_suggestion
from tests import synthetic as syn
from tests.conftest import IC, PESQ, confirm, upload

# (dia, amostra, cadinho x3, amostra x3, após o tratamento x3, observações) — massas inventadas
ROWS = [
    (1, "HP 300 H", (40.0, 39.0, 38.0), (0.25, 0.25, 0.25), (40.15, 39.14, 38.16), ""),
    (2, "HP 320 sem extração", (40.0, 39.0, 38.0), (0.20, 0.25, 0.25), (40.10, 39.15, None), "réplica 3 perdida"),
    (3, "HP 280 E1", (40.0, 39.0, 38.0), (0.25, 0.25, 0.25), (40.05, 39.05, 38.05), ""),
    (4, "Rocha teste", (40.0, 39.0, 38.0), (0.25, 0.25, 0.25), (40.20, 39.20, 38.20), ""),
    (5, "HP 340 H", (None, None, None), (None, None, None), (None, None, None), ""),  # vazia: ignorada
]


def test_parser_computes_grams_and_percent_from_masses():
    r = parse_file("planilha_massas.xlsx", syn.leco_ri_xlsx(ROWS, flat_copy=True))
    assert r.technique == "leco_ri" and r.format_label == "LECO - Resíduo Insolúvel"
    assert any('Lida a aba "Dados"' in w for w in r.warnings)  # a aba plana repetida fica de fora
    by_name = {rec.raw_name: rec for rec in r.records}
    assert set(by_name) == {"HP 300 H", "HP 320 sem extração", "HP 280 E1", "Rocha teste"}
    hp300 = by_name["HP 300 H"]
    ri = {v.replicate: v.value for v in hp300.values if v.parameter == "RI"}
    pct = {v.replicate: v.value for v in hp300.values if v.parameter == "RI_pct"}
    # resíduo (g) = cadinho + amostra − após; % = g / amostra × 100
    assert ri == {1: pytest.approx(0.10), 2: pytest.approx(0.11), 3: pytest.approx(0.09)}
    assert pct == {1: pytest.approx(40.0), 2: pytest.approx(44.0), 3: pytest.approx(36.0)}
    assert {v.unit for v in hp300.values if v.parameter == "RI"} == {"g"}
    assert hp300.analyzed_at == "2026-01-01"
    # réplica sem a massa final não entra
    assert sum(v.parameter == "RI" for v in by_name["HP 320 sem extração"].values) == 2
    assert by_name["HP 320 sem extração"].code_hint == "HP320SE"
    assert by_name["HP 280 E1"].code_hint == "HP280E.1"
    assert by_name["HP 320 sem extração"].extra["notes"] == "réplica 3 perdida"


def test_flat_layout_alone_is_read():
    r = parse_file("tabela.xlsx", syn.leco_ri_flat_xlsx(ROWS[:1]))
    assert r.technique == "leco_ri"
    pct = sorted(v.value for v in r.records[0].values if v.parameter == "RI_pct")
    assert pct == [pytest.approx(36.0), pytest.approx(40.0), pytest.approx(44.0)]


def test_code_suggestions():
    assert code_suggestion("HP 330 sem extração") == "HP330SE"
    assert code_suggestion("HP 320 E2") == "HP320E.2"
    assert code_suggestion("HP 320 H") is None  # o próprio código já é lido (HP320H)
    assert code_suggestion("Rocha araripe 80mesh") is None


def test_sheet_without_masses_is_error():
    with pytest.raises(ParseError):
        parse_file("x.xlsx", syn.leco_ri_xlsx([ROWS[-1]]))


def test_import_shows_percent_and_grams(client, project):
    pid = project["id"]
    confirm(client, pid, upload(client, pid, {"planilha_massas.xlsx": syn.leco_ri_xlsx(ROWS[:3])}))
    samples = {s["code"]: s for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    assert samples["HP320SE"]["fraction"] == "SE"
    values = samples["HP300H"]["values"]
    assert values["leco_ri.RI_pct"]["n"] == 3 and values["leco_ri.RI_pct"]["mean"] == pytest.approx(40.0)
    assert values["leco_ri.RI"]["mean"] == pytest.approx(0.10)


def _report(client, pid, body, who=PESQ):
    r = client.post(f"projects/{pid}/export/report", json=body, headers=who)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    return openpyxl.load_workbook(io.BytesIO(r.content))


def test_report_has_summary_first_and_one_sheet_per_technique(client, project):
    pid = project["id"]
    confirm(client, pid, upload(client, pid, {"Resíduo Insolúvel.xlsx": syn.leco_ri_xlsx(ROWS[:3])}))
    confirm(
        client,
        pid,
        upload(client, pid, {"leco.csv": syn.leco_csv([{"name": "HP300H", "set_id": "S1", "reps": [(10.0, 1.0, 0.2, "Included"), (12.0, 1.2, 0.2, "Included")]}])}),
    )
    wb = _report(client, pid, {"techniques": [], "mode": "padrao"}, who=IC)  # IC do projeto também exporta
    assert wb.sheetnames[0] == "Resumo geral"
    assert "LECO - Resíduo Insolúvel" in wb.sheetnames and "LECO" in wb.sheetnames

    summary = wb["Resumo geral"]
    text = [str(c.value) for row in summary.iter_rows() for c in row if c.value is not None]
    assert any("Projeto Teste" in t for t in text)
    assert "Resumo por técnica" in text

    ri = wb["LECO - Resíduo Insolúvel"]
    cells = [[c.value for c in row] for row in ri.iter_rows()]
    # bloco "Todas as réplicas": uma linha por réplica (3 + 2 + 3)
    start = next(i for i, row in enumerate(cells) if row[0] == "Todas as réplicas")
    reps = [row for row in cells[start + 2 :] if row[0]]
    assert len(reps) == 8
    assert {row[0] for row in reps} == {"HP300H", "HP320SE", "HP280E"}


def test_report_only_chosen_techniques_and_samples(client, project):
    pid = project["id"]
    confirm(client, pid, upload(client, pid, {"Resíduo Insolúvel.xlsx": syn.leco_ri_xlsx(ROWS[:3])}))
    samples = {s["code"]: s["id"] for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    wb = _report(client, pid, {"techniques": ["leco_ri"], "sample_ids": [samples["HP300H"]], "mode": "todas"})
    assert wb.sheetnames == ["Resumo geral", "LECO - Resíduo Insolúvel"]
    codes = {c.value for row in wb["LECO - Resíduo Insolúvel"].iter_rows() for c in row[:1]}
    assert "HP300H" in codes and "HP320SE" not in codes


def test_report_rejects_unknown_technique(client, project):
    r = client.post(f"projects/{project['id']}/export/report", json={"techniques": ["xyz"]}, headers=PESQ)
    assert r.status_code == 400
