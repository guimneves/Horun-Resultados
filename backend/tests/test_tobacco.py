"""Projeto de tabaco (14/10/2026): leitores novos (TG, MEV-EDS, LECO sinal
bruto, Rock-Eval "multiheating"), leitor de códigos de tabaco e o fluxo de
importação com o perfil "tabaco". Tudo com arquivos SINTÉTICOS."""

from __future__ import annotations

import pytest

from app.parsers import NotResultsFile, ParseError, parse_file
from app.services.codes import normalize_code, parse_tobacco_code
from tests import synthetic as syn
from tests.conftest import COORD, PESQ, add_members, confirm, upload
from tests.test_parsers import ROWS


def _vals(record) -> dict[str, float]:
    return {v.parameter: v.value for v in record.values}


# ---------------------------------------------------------------- TG


@pytest.mark.parametrize("encoding, unit", [("utf-16", "%"), ("cp1252", "mg"), ("utf-16", "mg"), ("cp1252", "%")])
def test_tg_both_encodings_and_units(encoding, unit):
    r = parse_file("Produto Alfa - rep 2 (Triplicata).txt", syn.tg_txt("PA-Produto Alfa (triturado)", 8.0, unit, encoding))
    assert r.technique == "tg"
    rec = r.records[0]
    # o nome do ARQUIVO traz a réplica → vale ele
    assert rec.raw_name == "Produto Alfa - rep 2"
    assert rec.extra["sample_name"] == "PA-Produto Alfa (triturado)"
    assert rec.analyzed_at.startswith("2026-05-04")
    v = _vals(rec)
    assert set(v) == {"loss_150", "loss_150_400", "loss_400_600", "loss_600_900", "residue_pct", "dtg_peak_c", "t_final_c", "mass_mg"}
    assert v["mass_mg"] == 8.0
    assert 6 < v["loss_150"] < 10  # umidade inventada: 8 %
    assert 45 < v["loss_150_400"] < 55
    assert 30 < v["residue_pct"] < 34
    assert 300 < v["dtg_peak_c"] < 340  # maior perda na etapa de ~320 °C
    assert v["t_final_c"] == pytest.approx(1000, abs=1)
    assert rec.data["points"] <= 800 and len(rec.data["temperature"]) == len(rec.data["mass_pct"]) == len(rec.data["dtg"])
    assert rec.data["mass_pct"][0] == pytest.approx(100, abs=0.01)
    if unit == "mg":
        assert any("mg" in w for w in r.warnings)


def test_tg_name_without_replicate_uses_sample_name_and_short_run():
    r = parse_file("3-Charuto Produto Beta (folha externa) 2026-05-04 Ch1-Corrected.txt", syn.tg_txt("3-Charuto Produto Beta (folha externa)", encoding="cp1252", unit="mg", t_end=700))
    rec = r.records[0]
    assert rec.raw_name == "3-Charuto Produto Beta (folha externa)"
    v = _vals(rec)
    assert "loss_600_900" not in v  # a corrida não chega a 900 °C
    assert any("700" in w for w in r.warnings)


def test_tg_binary_tad_is_ignored():
    with pytest.raises(NotResultsFile, match="ASCII"):
        parse_file("Produto Alfa - rep 2", b"TA-60 FILE VER2.00\x00\x00\x9a\x0b")


# ---------------------------------------------------------------- MEV-EDS

ELEMENTS = [("Carbon", 60.0, 50.0), ("Oxygen", 30.0, 33.0), ("Potassium", 5.0, 12.0), ("Aluminum", 1.0, 1.5), ("Sulphur", 0.5, 1.0)]


def test_eds_quantity_from_folders():
    path = "lote.zip/MEV/produto alfa/folha externa/eds/Sample 1/Spectrum 12"
    r = parse_file("Spectrum 12 Quantity analysis.csv", syn.eds_quantity_csv(ELEMENTS), path)
    assert r.technique == "mev_eds"
    rec = r.records[0]
    assert rec.raw_name == "produto alfa"
    assert rec.extra["region"] == "folha externa" and rec.extra["replicate_hint"] == 12
    assert "folha externa" in rec.key and "Spectrum 12" in rec.key
    v = _vals(rec)
    assert v["wt_C"] == 50.0 and v["at_C"] == 60.0 and v["wt_K"] == 12.0 and v["wt_Al"] == 1.5 and v["wt_S"] == 1.0
    assert rec.method == "20 kV"
    # sem região: a pasta antes de "eds1" é a amostra
    r = parse_file("Spectrum 3 Quantity analysis.csv", syn.eds_quantity_csv(ELEMENTS), "x.zip/MEV/produto beta/eds1/Sample 1/Spectrum 3")
    assert r.records[0].raw_name == "produto beta" and r.records[0].extra["region"] == ""


def test_eds_alone_uses_spectrum_name_and_raw_spectra_are_ignored():
    r = parse_file("Spectrum 7 Quantity analysis.csv", syn.eds_quantity_csv(ELEMENTS))
    assert r.records[0].raw_name == "Spectrum 7"
    assert any("pastas" in w for w in r.warnings)
    assert parse_tobacco_code("Spectrum 7").base_code == "Spectrum 7"  # o número não vira réplica
    for name, content in (("Spectrum 7 Spectrum.csv", syn.eds_spectrum_csv()), ("Spectrum 7 Spectrum.msa", syn.eds_msa())):
        with pytest.raises(NotResultsFile, match="Espectro bruto"):
            parse_file(name, content, "x.zip/MEV/produto/eds/Sample 1/Spectrum 7")
    with pytest.raises(NotResultsFile, match="Imagem"):
        parse_file("Electron Image 1.png", b"\x89PNG\r\n\x1a\n0000")
    with pytest.raises(NotResultsFile, match="MEV-EDS"):
        parse_file("relatorio.pdf", syn.plain_pdf("Relatorio de figuras"), "x.zip/MEV/produto/eds")


# ---------------------------------------------------------------- LECO sinal bruto


def test_leco_raw_integrates_and_subtracts_blank():
    content = syn.leco_raw_csv([("PRODUTO ALFA", 1, 100.0), ("PRODUTO ALFA", 2, 110.0)], blank_height=1.0)
    r = parse_file("Triplicata Produto.csv", content)
    assert r.technique == "leco_bruto"
    assert any("RELATIVAS" in w for w in r.warnings)
    samples = [x for x in r.records if x.kind == "sample"]
    blanks = [x for x in r.records if x.kind == "blank"]
    assert len(samples) == 2 and len(blanks) == 3
    v = _vals(samples[0])
    # 10 s com pico de 100 → 1000, menos o branco (10 s × 1 = 10)
    assert v["area_C"] == pytest.approx(990)
    assert v["area_S_low"] == pytest.approx(99)
    assert v["duration_s"] == 60
    assert samples[1].extra["replicate_hint"] == 2
    assert _vals(blanks[0])["area_C"] == pytest.approx(10)  # branco sem desconto
    assert samples[0].data["points"] <= 600 and "C" in samples[0].data
    # não é confundido com o CSV de resultados do LECO (e vice-versa)
    from tests.test_parsers import LECO_SETS

    assert parse_file("leco.csv", syn.leco_csv(LECO_SETS)).technique == "leco"


# ---------------------------------------------------------------- Rock-Eval multiheating


def test_rockeval_without_analysis_column_links_curves_by_order():
    rows = [
        {"sample": "CHARUTO_ALFA1", "run": "2026-05-01-CHARUTO_ALFA1", "toc": 40.0, "q1": 3.0},
        {"sample": "CHARUTO_ALFA2", "run": "2026-05-01-CHARUTO_ALFA2", "toc": 41.0, "q1": 3.5, "curves": False},
        {"sample": "CIGARRO_BETA", "run": "2026-05-02-CIGARRO_BETA", "toc": 45.0, "q1": 4.0},
    ]
    r = parse_file("multiheating.htm", syn.rockeval_multiheating_htm(rows))
    assert r.technique == "rockeval" and "multiheating" in r.format_label
    keys = [x.key for x in r.records]
    assert keys == [x["run"] for x in rows]
    first = r.records[0]
    assert first.raw_name == "CHARUTO_ALFA1" and first.analyzed_at == "2026-05-01"
    v = _vals(first)
    assert v["TOC"] == 40.0 and v["Q1"] == 3.0 and v["PC"] == 8.0 and v["RC"] == 40.0 and "Q5" not in v
    assert first.data["pyro"]["series"]["HC"][:3] == [0.0, 1.0, 2.0]
    assert r.records[1].data is None
    assert r.records[2].data["pyro"]["series"]["HC"][0] == 2.0  # curva da 3ª corrida, pela posição


# ---------------------------------------------------------------- códigos


@pytest.mark.parametrize(
    "raw, base, rep",
    [
        ("Ch_Produto_Alfa_1", "Produto Alfa", 1),
        ("Produto alfa 2", "Produto alfa", 2),
        ("Produto Alfa - rep 2", "Produto Alfa", 2),
        ("Beta- rep 3", "Beta", 3),
        ("Gama JOTA -1", "Gama JOTA", 1),
        ("Produto Alfa - 1 (Triplicata)", "Produto Alfa", 1),
        ("Produto Alfa-rep 2 (Triplicata)", "Produto Alfa", 2),
        ("2-Charuto Produto Alfa (folha externa) 2026-05-04 Ch1-Corrected", "Produto Alfa (folha externa)", None),
        ("PA-Produto Alfa (triturado)", "Produto Alfa", None),
        ("B - Beta (triturado)", "Beta", None),
        ("CHARUTO_PRODUTOALFA", "PRODUTOALFA", None),
        ("CHARUTO_PRODUTO_ALFA3", "PRODUTO ALFA", 3),
        ("CIGARRO_MARCA_X", "CIGARRO MARCA X", None),
        ("XYZ-AMARELO", "XYZ-AMARELO", None),  # marca em maiúsculas: a sigla fica
        ("AB-1000", "AB-1000", None),
    ],
)
def test_tobacco_code_reader(raw, base, rep):
    info = parse_tobacco_code(raw)
    assert info.base_code == base and info.replicate == rep
    assert info.fraction == "X" and info.temperature_c is None


def test_tobacco_names_match_across_techniques():
    names = ["Ch_Produto_Alfa_1", "Produto Alfa - rep 2", "PRODUTO ALFA", "CHARUTO_PRODUTOALFA", "PA-Produto Alfa (triturado)"]
    assert {normalize_code(parse_tobacco_code(n).base_code) for n in names} == {"PRODUTOALFA"}
    assert parse_tobacco_code("Blank").kind == "blank"
    assert parse_tobacco_code("Sulphanilamide").kind == "standard"


# ---------------------------------------------------------------- fluxo


def _tobacco_project(client) -> dict:
    r = client.post("projects", json={"name": "Tabaco sintético", "profile": {"sample_type": "tabaco"}}, headers=COORD)
    assert r.status_code == 201, r.text
    add_members(client, r.json()["id"], PESQ)
    return r.json()


def test_tobacco_profile_is_ready(client):
    p = _tobacco_project(client)
    prof = p["profile"]
    assert prof["sample_type"] == "tabaco" and prof["temperature_axis"] is False
    assert prof["recipes"] == ["chnso", "leco", "leco_bruto", "rockeval", "tg", "mev_eds"]
    assert prof["parameters"]["tg"] == ["loss_150", "loss_150_400", "loss_400_600", "residue_pct", "dtg_peak_c"]


def test_tobacco_import_groups_by_product(client):
    pid = _tobacco_project(client)["id"]
    files = {
        "Ch_Produto_Alfa_1.pdf": syn.chnso_single_pdf(1, "Smp", "Ch_Produto_Alfa_1", {"Nitrogen": 2.0, "Carbon": 40.0, "Hydrogen": 5.0}),
        "Ch_Produto_Alfa_2.pdf": syn.chnso_single_pdf(2, "Smp", "Ch_Produto_Alfa_2", {"Nitrogen": 2.1, "Carbon": 41.0, "Hydrogen": 5.1}),
        "Produto Alfa - 1.txt": syn.tg_txt("PA-Produto Alfa (triturado)"),
        "Produto Alfa - rep 2 (Triplicata).txt": syn.tg_txt("Produto Alfa - rep 2"),
        "Beta - 1.txt": syn.tg_txt("B-Beta (triturado)", encoding="cp1252", unit="mg"),
        "leco.csv": syn.leco_raw_csv([("PRODUTO ALFA", 1, 100.0), ("BETA", 1, 90.0)]),
    }
    pv = upload(client, pid, files)
    assert pv["counts"]["errors"] == 0, pv["files"]
    rows = {r["name"]: r for r in pv["rows"]}
    assert set(rows) == {"Produto Alfa", "Beta", "Blank"}
    alfa = rows["Produto Alfa"]
    assert set(alfa["techniques"]) == {"chnso", "tg", "leco_bruto"}
    assert alfa["replicates"] == [1, 2] and alfa["n_measurements"] == 5
    assert alfa["suggested"]["fraction"] == "X" and alfa["suggested"]["temperature_c"] is None and alfa["suggested"]["experiment_code"] is None
    assert alfa["action"] == "create"
    assert rows["Blank"]["kind"] == "blank" and rows["Blank"]["action"] == "skip"
    result = confirm(client, pid, pv)
    assert result["samples_created"] == 2 and result["analyses_created"] == 7
    table = {s["code"]: s for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    assert set(table) == {"Produto Alfa", "Beta"}
    assert table["Produto Alfa"]["fraction"] == "X"

    # EDS de outra importação: a pasta "produto alfa" cai na mesma amostra
    eds = syn.zip_of({"MEV/produto alfa/externo/eds/Sample 1/Spectrum 5/Spectrum 5 Quantity analysis.csv": syn.eds_quantity_csv(ELEMENTS),
                      "MEV/produto alfa/externo/eds/Sample 1/Spectrum 5/Spectrum 5 Spectrum.csv": syn.eds_spectrum_csv()})  # fmt: skip
    pv = upload(client, pid, {"mev.zip": eds})
    assert pv["counts"]["ignored"] == 1 and pv["counts"]["ok"] == 1
    row = pv["rows"][0]
    assert row["action"] == "link" and row["sample_code"] == "Produto Alfa"
    assert row["measurements"][0]["region"] == "externo" and row["replicates"] == [5]
    confirm(client, pid, pv)

    # curvas do TG para o gráfico
    sid = table["Produto Alfa"]["id"]
    curves = client.get(f"projects/{pid}/analysis-data?technique=tg&sample_ids={sid}", headers=PESQ).json()
    assert len(curves) == 2 and {"temperature", "mass_pct", "dtg"} <= set(curves[0]["data"])

    # amostra criada à mão num projeto de tabaco: réplica sai do código
    r = client.post(f"projects/{pid}/samples/bulk", json={"codes": ["Gama - rep 2"]}, headers=PESQ)
    assert r.status_code == 201
    codes = {s["code"] for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    assert codes == {"Produto Alfa", "Beta", "Gama"}


def test_rock_project_keeps_rock_codes(client, project):
    """Projeto de rocha (perfil padrão) continua lendo HP300H... como antes."""
    pv = upload(client, project["id"], {"run.pdf": syn.chnso_summary_pdf(ROWS)})
    hp = {r["name"]: r for r in pv["rows"]}["HP300H"]
    assert hp["suggested"]["fraction"] == "H" and hp["suggested"]["temperature_c"] == 300
    assert project["profile"]["temperature_axis"] is True


def test_unreadable_utf16_text_is_an_error():
    with pytest.raises(ParseError):
        parse_file("x.txt", "qualquer coisa".encode("utf-16"))
