"""Fluxo de importação (ESPECIFICACAO.md, seção 5): prévia → confirmação,
idempotência, .zip, alíquotas, gás → experimento e o aviso aos coordenadores."""

from __future__ import annotations

from tests import synthetic as syn
from tests.conftest import COORD, PESQ, confirm, upload
from tests.test_parsers import FID, LECO_SETS, ROWS


def _by_code(preview):
    return {s["code"]: s for s in preview["samples"]}


def test_preview_groups_replicates_and_suggests(client, project):
    pv = upload(client, project["id"], {"Results Summary for Element %.pdf": syn.chnso_summary_pdf(ROWS)})
    assert pv["counts"]["ok"] == 1
    samples = _by_code(pv)
    assert set(samples) == {"Sulphanilamide", "HP300H", "Rocha virgem 80 mesh", "C30 2104"}
    hp = samples["HP300H"]
    assert hp["action"] == "create" and hp["fraction"] == "H" and hp["temperature_c"] == 300
    assert sorted(m["replicate"] for m in hp["measurements"]) == [1, 2, 3]
    assert samples["Sulphanilamide"]["kind"] == "standard" and samples["Sulphanilamide"]["fraction"] == "STD"
    assert samples["Rocha virgem 80 mesh"]["fraction"] == "O"
    # nada gravado ainda
    assert client.get(f"projects/{project['id']}/samples", headers=PESQ).json()["samples"] == []


def test_confirm_then_reimport_same_file_is_duplicate(client, project, sent):
    pdf = syn.chnso_summary_pdf(ROWS)
    pv = upload(client, project["id"], {"run.pdf": pdf})
    result = confirm(client, project["id"], pv)
    assert result["samples_created"] == 4 and result["analyses_created"] == 6
    table = client.get(f"projects/{project['id']}/samples", headers=PESQ).json()["samples"]
    hp = next(s for s in table if s["code"] == "HP300H")
    assert hp["values"]["chnso.C"]["n"] == 3 and hp["values"]["chnso.C"]["mean"] == 21.0

    again = upload(client, project["id"], {"run.pdf": pdf})
    assert again["files"][0]["status"] == "duplicado"
    assert again["samples"] == []
    # aviso aos coordenadores (níveis 1 e 2), só no sininho
    assert sent and sent[-1]["levels"] == [1, 2] and sent[-1]["email"] is False
    assert sent[-1]["subject"] == "4 amostras importadas em Projeto Teste"


def test_other_print_of_same_run_updates_instead_of_duplicating(client, project):
    confirm(client, project["id"], upload(client, project["id"], {"a.pdf": syn.chnso_summary_pdf(ROWS)}))
    changed = [list(r) for r in ROWS]
    changed[2][4] = 30.0  # HP300H-1: C mudou (reprocessado)
    pv = upload(client, project["id"], {"b.pdf": syn.chnso_summary_pdf([tuple(r) for r in changed])})
    hp = _by_code(pv)["HP300H"]
    assert hp["action"] == "link" and all(m["updates_existing"] for m in hp["measurements"])
    res = confirm(client, project["id"], pv)
    assert res["analyses_created"] == 0 and res["analyses_updated"] == 6 and res["samples_created"] == 0
    table = client.get(f"projects/{project['id']}/samples", headers=PESQ).json()["samples"]
    hp_row = next(s for s in table if s["code"] == "HP300H")
    assert hp_row["values"]["chnso.C"]["n"] == 3 and hp_row["values"]["chnso.C"]["mean"] == (30 + 22 + 21) / 3


def test_summary_wins_over_single_sample_pdf_in_same_batch(client, project):
    single = syn.chnso_single_pdf(3, "Smp", "HP300H-1", {"Carbon": 99.0})
    pv = upload(client, project["id"], {"single.pdf": single, "summary.pdf": syn.chnso_summary_pdf(ROWS)})
    m = [x for x in _by_code(pv)["HP300H"]["measurements"] if x["replicate"] == 1]
    assert len(m) == 2 and sum(1 for x in m if x["duplicate_of"]) == 1
    res = confirm(client, project["id"], pv)
    assert res["analyses_created"] == 6
    table = client.get(f"projects/{project['id']}/samples", headers=PESQ).json()["samples"]
    assert next(s for s in table if s["code"] == "HP300H")["values"]["chnso.C"]["mean"] == 21.0


def test_aliquots_link_to_one_sample(client, project):
    sets = [
        {"name": "HP320E.1", "set_id": "S1", "reps": [(10.0, 1.0, 0.2, "Included"), (12.0, 1.0, 0.2, "Included")]},
        {"name": "HP320E.2", "set_id": "S2", "reps": [(14.0, 1.0, 0.2, "Included"), (16.0, 1.0, 0.2, "Included")]},
    ]
    pv = upload(client, project["id"], {"leco.csv": syn.leco_csv(sets)})
    assert list(_by_code(pv)) == ["HP320E"]
    assert sorted(m["aliquot"] for m in pv["samples"][0]["measurements"]) == [1, 2]
    confirm(client, project["id"], pv)
    sample = client.get(f"projects/{project['id']}/samples", headers=PESQ).json()["samples"][0]
    assert sample["code"] == "HP320E" and sample["values"]["leco.C"]["mean"] == 13.0 and sample["values"]["leco.C"]["n"] == 4
    detail = client.get(f"projects/{project['id']}/samples/{sample['id']}", headers=PESQ).json()
    per = {a["aliquot"]: a["values"]["C"]["mean"] for a in detail["aliquots"]}
    assert per == {1: 11.0, 2: 15.0}


def test_zip_with_gas_folders_creates_experiment_with_conditions(client, project):
    zipped = syn.zip_of(
        {
            "HP320NC - Fulano/Modelo - Dados FID 20260101.xlsx": syn.gc_xlsx("FID", "HP320", FID),
            "HP320NC - Fulano/Modelo - HP320NC - Planilha cálculo gás.xlsx": syn.gas_xlsx("HP320NC"),
            "HP320NC - Fulano/~$Modelo - Planilha.xlsx": b"lixo",
        }
    )
    pv = upload(client, project["id"], {"gas.zip": zipped})
    statuses = sorted(f["status"] for f in pv["files"])
    assert statuses == ["ignorado", "ok", "ok"]
    gas = _by_code(pv)["HP320NC (gás)"]
    assert gas["fraction"] == "G" and gas["experiment_code"] == "HP320NC" and len(gas["measurements"]) == 2
    confirm(client, project["id"], pv)
    exps = client.get(f"projects/{project['id']}/experiments", headers=PESQ).json()
    assert len(exps) == 1
    exp = exps[0]
    assert exp["code"] == "HP320NC" and exp["temperature_c"] == 320 and exp["atmosphere"] == "nitrogênio" and exp["replicate_letter"] == "C"
    assert exp["reactor"] == "Reator X" and exp["conditions"]["gas_enchimento"] == "Nitrogênio"
    assert [s["code"] for s in exp["samples"]] == ["HP320NC (gás)"]


def test_leco_diagnostic_zip_is_refused(client, project):
    zipped = syn.zip_of({"MondoFiles/2026010110.log": b"log", "Cornerstone.Configuration.xml": b"<x/>"})
    pv = upload(client, project["id"], {"SC832DR.zip": zipped})
    assert pv["files"][0]["status"] == "ignorado" and "diagnóstico do LECO" in pv["files"][0]["message"]


def test_decisions_skip_link_and_rename(client, project):
    other = client.post(f"projects/{project['id']}/samples", json={"code": "Rocha original lote 1"}, headers=PESQ).json()
    pv = upload(client, project["id"], {"run.pdf": syn.chnso_summary_pdf(ROWS)})
    by = _by_code(pv)
    decisions = [
        {"norm": by["Sulphanilamide"]["norm"], "action": "skip"},
        {"norm": by["Rocha virgem 80 mesh"]["norm"], "action": "link", "sample_id": other["id"]},
        {"norm": by["HP300H"]["norm"], "action": "create", "code": "HP300H", "fraction": "SE", "temperature_c": 301},
    ]
    res = confirm(client, project["id"], pv, decisions)
    assert res["samples_created"] == 2  # HP300H e C30 2104
    table = {s["code"]: s for s in client.get(f"projects/{project['id']}/samples", headers=PESQ).json()["samples"]}
    assert "Sulphanilamide" not in table
    assert table["HP300H"]["fraction"] == "SE" and table["HP300H"]["temperature_c"] == 301
    assert table["Rocha original lote 1"]["values"]["chnso.C"]["n"] == 1


def test_confirm_twice_is_conflict(client, project):
    pv = upload(client, project["id"], {"run.pdf": syn.chnso_summary_pdf(ROWS)})
    confirm(client, project["id"], pv)
    r = client.post(f"projects/{project['id']}/imports/{pv['batch_id']}/confirm", json={"decisions": []}, headers=PESQ)
    assert r.status_code == 409


def test_error_files_are_reported_not_fatal(client, project):
    pv = upload(client, project["id"], {"ruim.csv": b"a,b\n1,2\n", "leco.csv": syn.leco_csv(LECO_SETS)})
    status = {f["filename"]: f["status"] for f in pv["files"]}
    assert status == {"ruim.csv": "erro", "leco.csv": "ok"}
    assert pv["counts"]["errors"] == 1


def test_history_records_the_import(client, project):
    confirm(client, project["id"], upload(client, project["id"], {"run.pdf": syn.chnso_summary_pdf(ROWS)}))
    events = client.get(f"projects/{project['id']}/history", headers=COORD).json()
    imp = next(e for e in events if e["action"] == "importacao")
    assert imp["username"] == "pessoa3" and imp["details"]["files"] == ["run.pdf"]
    files = client.get(f"projects/{project['id']}/files", headers=PESQ).json()
    assert files[0]["filename"] == "run.pdf" and files[0]["status"] == "imported"
    dl = client.get(f"projects/{project['id']}/files/{files[0]['id']}/download", headers=PESQ)
    assert dl.status_code == 200 and dl.content[:5] == b"%PDF-"
