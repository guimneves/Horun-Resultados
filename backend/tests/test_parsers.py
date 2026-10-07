"""Leitores de cada formato (ESPECIFICACAO.md, seção 3) com arquivos sintéticos."""

from __future__ import annotations

import pytest

from app.parsers import NotResultsFile, ParseError, parse_file
from tests import synthetic as syn


def _vals(record, param):
    return [v.value for v in record.values if v.parameter == param]


# ---------------------------------------------------------------- CHNSO

ROWS = [
    (1, "Byp", "Bypass", None, None, None, None, None, None),
    (2, "Std", "Sulphanilamide", 16.2, 41.8, 4.6, 18.6, None, 0.8),
    (3, "Smp", "HP300H-1", 0.7, 20.0, 2.0, 3.0, None, 1.0),
    (4, "Smp", "HP300H-2", 0.7, 22.0, 2.2, 3.1, None, 1.0),
    (5, "Smp", "Rocha virgem 80 mesh-1", 0.5, 25.0, 2.5, 2.0, None, 1.0),
    (6, "Smp", "C30 2104-1", 3.0, 33.0, 4.4, 1.3, None, 0.7),
    (7, "Smp", "HP300H-3", 0.6, 21.0, 2.1, 3.2, None, 1.1),
]


def test_chnso_summary_multipage_names_and_bypass():
    result = parse_file("Results Summary for Element %.pdf", syn.chnso_summary_pdf(ROWS, per_page=3))
    assert result.technique == "chnso" and result.priority == 10
    names = [r.raw_name for r in result.records]
    assert names == ["Sulphanilamide", "HP300H-1", "HP300H-2", "Rocha virgem 80 mesh-1", "C30 2104-1", "HP300H-3"]
    assert result.records[0].kind == "standard"
    assert any("Bypass" in w for w in result.warnings)
    rec = result.records[1]
    assert rec.key == "000001-Teste Sintetico:3"
    assert rec.analyzed_at == "2026-03-05 09:30"
    assert _vals(rec, "C") == [20.0] and _vals(rec, "O") == []  # "-" = sem valor
    # H/C atômica = (H/1,008)/(C/12,011)
    assert _vals(rec, "HC_at")[0] == pytest.approx((2.0 / 1.008) / (20.0 / 12.011))


def test_chnso_single_sample_ignores_standard_theoretical_values():
    pdf = syn.chnso_single_pdf(2, "Std", "Sulphanilamide", {"Nitrogen": 16.1, "Carbon": 41.7})
    result = parse_file("Single Sample Result (2-Standard-Sulphanilamide).pdf", pdf)
    rec = result.records[0]
    assert rec.kind == "standard" and rec.key.endswith(":2")
    assert _vals(rec, "N") == [16.1] and _vals(rec, "C") == [41.7]
    assert result.priority < 10


@pytest.mark.parametrize(
    "title, expected",
    [
        ("Calibration Results for Carbon", "calibração"),
        ("Results Summary for Area %", "Área %"),
        ("Results Summary for K- Factor", "K-Factor"),
        ("Instrument and Data Processing Parameters", "parâmetros do instrumento"),
        ("Results Summary for Element Micrograms", "microgramas"),
    ],
)
def test_chnso_other_reports_are_refused_with_clear_message(title, expected):
    with pytest.raises(NotResultsFile, match=expected):
        parse_file("x.pdf", syn.chnso_other_pdf(title))


def test_unknown_pdf_and_leco_diagnostic_pdf():
    with pytest.raises(ParseError, match="PDF não reconhecido"):
        parse_file("x.pdf", syn.plain_pdf("Relatório qualquer de outra coisa"))
    with pytest.raises(NotResultsFile, match="diagnóstico do LECO"):
        parse_file("SC832DR.pdf", syn.leco_diagnostic_pdf())


# ---------------------------------------------------------------- LECO

LECO_SETS = [
    {"name": "HP300H", "set_id": "00A1", "reps": [(20.0, 4.0, 0.25, "Included"), (21.0, 4.2, 0.25, "Included"), (22.0, 4.1, 0.25, "Included")]},
    {"name": "HP320E.1", "set_id": "00A2", "reps": [(15.0, 3.0, 0.25, "Included"), (99.0, 9.9, 0.25, "Excluded")]},
    {"name": "Padrao LECO", "type": "Standard", "set_id": "00A3", "reps": [(12.0, 1.0, 0.2, "Included")]},
]


def test_leco_mixed_headers_replicates_and_units():
    result = parse_file("Leco Transports.csv", syn.leco_csv(LECO_SETS))
    assert [r.raw_name for r in result.records] == ["HP300H", "HP320E.1", "Padrao LECO"]
    first = result.records[0]
    assert sorted(_vals(first, "C")) == [20.0, 21.0, 22.0]
    assert sorted(v.replicate for v in first.values if v.parameter == "C") == [1, 2, 3]
    assert _vals(first, "mass") == [0.25, 0.25, 0.25]
    assert first.analyzed_at.startswith("2026-05-03")
    # réplica excluída no aparelho não entra
    assert _vals(result.records[1], "C") == [15.0]
    assert any("excluída" in w for w in result.warnings)
    assert result.records[2].kind == "standard"


def test_leco_csv_with_bom_and_crlf():
    content = "﻿".encode() + syn.leco_csv(LECO_SETS[:1])
    assert parse_file("x.csv", content).records[0].raw_name == "HP300H"


def test_random_csv_is_refused():
    with pytest.raises(ParseError, match="Formato não reconhecido"):
        parse_file("x.csv", b"a,b,c\n1,2,3\n")


# ---------------------------------------------------------------- Rock-Eval


def test_rockeval_table_and_curves():
    htm = syn.rockeval_htm(
        [
            {"analysis": "2026-01-01_HP300NA_1", "sample": "HP300NA", "toc": 10.0, "tmax": 440, "s1": 1.0, "s2": 40.0, "hi": 400, "oi": 10},
            {"analysis": "2026-01-01_HP300NA_2", "sample": "HP300NA", "toc": 11.0, "tmax": 441, "s1": 1.2, "s2": 42.0, "hi": 380, "oi": 12},
            {"analysis": "2026-01-01_ROA_1", "sample": "ROA", "toc": 12.0, "tmax": 435, "s1": 2.0, "s2": 60.0, "hi": 500, "oi": 8, "curves": False},
        ]
    )
    result = parse_file("Cinetica.htm", htm)
    assert result.technique == "rockeval" and len(result.records) == 3
    rec = result.records[0]
    assert rec.key == "2026-01-01_HP300NA_1" and rec.raw_name == "HP300NA"
    assert rec.extra["replicate_hint"] == 1
    assert _vals(rec, "TOC") == [10.0] and _vals(rec, "Tmax") == [440.0] and _vals(rec, "S1S") == [0.01]
    assert _vals(rec, "PI")[0] == pytest.approx(1.0 / 41.0)
    assert set(rec.data["pyro"]["series"]) >= {"Time", "Temp", "HC"}
    assert result.records[2].data is None
    assert any("sem curvas" in w for w in result.warnings)


def test_html_that_is_not_rockeval():
    with pytest.raises(ParseError, match="Rock-Eval"):
        parse_file("pagina.htm", b"<html><body>nada</body></html>")


# ---------------------------------------------------------------- GC-FID / TCD / gás

FID = [
    (1, "Metano", [100, 100, 100], [60.0, 61.0, 59.0]),
    (2, "Etano", [30, 30, 30], [20.0, 19.0, 21.0]),
    (3, "Propano", [10, 10, 10], [10.0, 10.0, 10.0]),
    (4, "n-Butano", [5, 5, 5], [6.0, 6.0, 6.0]),
    (5, "n-pentano", [5, 5, 5], [2.0, 2.0, 2.0]),
    (6, "C6 NI1*", [5, 5, 5], [2.0, 2.0, 2.0]),
]


def test_gc_fid_groups_by_carbon_and_reads_experiment_from_folder():
    content = syn.gc_xlsx("FID", "EXPXXXXX", FID)
    result = parse_file("Modelo - Dados FID 20260101.xlsx", content, path_hint="lote.zip/HP300NA - Fulano")
    rec = result.records[0]
    assert result.technique == "gc_fid"
    assert rec.code_hint == "HP300NA" and rec.fraction_hint == "G"
    assert rec.experiment.atmosphere == "nitrogênio" and rec.experiment.replicate_letter == "A"
    assert sorted(_vals(rec, "pct_C1")) == [59.0, 60.0, 61.0]
    assert sorted(_vals(rec, "pct_C5p")) == [4.0, 4.0, 4.0]  # pentano + C6
    assert len(rec.data["components"]) == 6
    assert any("EXPXXXXX" in w for w in result.warnings)


def test_gc_tcd_h2_co2_and_cell_code():
    tcd = [("H2", "H2", [1, 1, 1], [5.0, 5.0, 5.0]), (1, "Metano", [1, 1, 1], [15.0, 15.0, 15.0]), ("CO2", "CO2", [1, 1, 1], [80.0, 80.0, 80.0])]
    result = parse_file("Dados TCD.xlsx", syn.gc_xlsx("TCD", "HP280NB", tcd))
    rec = result.records[0]
    assert result.technique == "gc_tcd" and rec.code_hint == "HP280NB"
    assert _vals(rec, "pct_H2") == [5.0, 5.0, 5.0] and _vals(rec, "pct_CO2") == [80.0, 80.0, 80.0]


def test_gc_without_any_experiment_code_is_an_error():
    with pytest.raises(ParseError, match="experimento"):
        parse_file("Dados FID.xlsx", syn.gc_xlsx("FID", "EXPXXXXX", FID))


def test_gas_balance_by_label():
    result = parse_file("HP320NC - Planilha cálculo gás.xlsx", syn.gas_xlsx("HP320NC", initial_mass=150.0, gas_mass=1.5))
    rec = result.records[0]
    assert result.technique == "gas_balanco"
    assert _vals(rec, "gas_mass_g") == [1.5] and _vals(rec, "initial_mass_g") == [150.0]
    assert _vals(rec, "gas_yield_mg_g")[0] == pytest.approx(10.0)
    assert _vals(rec, "pressure_closure_pct") == [1.5]
    comp = {p: _vals(rec, f"comp_{p}")[0] for p in ("H2", "CO2", "C1", "C2", "C3", "C4", "C5p")}
    assert sum(comp.values()) == pytest.approx(100.0)
    assert comp["CO2"] > comp["C1"] > comp["H2"]
    exp = rec.experiment
    assert exp.code == "HP320NC" and exp.atmosphere == "nitrogênio" and exp.reactor == "Reator X" and exp.initial_mass_g == 150.0
    assert "condicoes" in exp.conditions


def test_gas_balance_warns_on_empty_generated_mass():
    result = parse_file("HP300NA - Planilha cálculo gás.xlsx", syn.gas_xlsx("HP300NA", gas_mass=None))
    assert any("vazia" in w for w in result.warnings)
    assert not _vals(result.records[0], "gas_mass_g")


def test_excel_temp_file_is_ignored():
    with pytest.raises(NotResultsFile, match="temporário"):
        parse_file("~$Planilha.xlsx", b"qualquer")


# ---------------------------------------------------------------- Py-GC-MS


def test_pygcms_ratios_and_cpi():
    peaks = [(f"n-C{n}", 100.0 if n % 2 else 80.0) for n in range(10, 36)]
    peaks.insert(8, ("Pristano", 50.0))
    peaks.insert(10, ("Fitano", 25.0))
    content = syn.pygcms_xlsx({"HP300": peaks, "HP355": []})
    result = parse_file("Dados de Py-GC-MS Rocha.xlsx", content)
    assert [r.raw_name for r in result.records] == ["HP300"]
    rec = result.records[0]
    assert _vals(rec, "pr_ph") == [2.0]
    assert _vals(rec, "pr_nc17") == [0.5]
    assert _vals(rec, "ph_nc18") == [25.0 / 80.0]
    assert _vals(rec, "cpi")[0] == pytest.approx(100.0 / 80.0)
    assert any("HP355" in w for w in result.warnings)


def test_literature_table_is_recognized_but_not_imported():
    with pytest.raises(NotResultsFile, match="literatura"):
        parse_file("Table_6.xlsx", syn.literature_xlsx())
