"""Fluxo de importação (ESPECIFICACAO.md, seção 5, com o refinamento do
mantenedor): tipo de análise → arquivos → tabela por NOME no arquivo →
atribuir a amostras existentes / criar / ignorar (inclusive em lote) →
confirmar; nomes lembrados como apelidos; reimportação sem duplicar."""

from __future__ import annotations

from tests import synthetic as syn
from tests.conftest import ADMIN, COORD, PESQ, confirm, upload
from tests.test_parsers import FID, LECO_SETS, ROWS


def _rows(preview):
    return {r["name"]: r for r in preview["rows"]}


def _table(client, pid):
    return {s["code"]: s for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}


def test_preview_has_one_row_per_name_with_replicates(client, project):
    pv = upload(client, project["id"], {"Results Summary for Element %.pdf": syn.chnso_summary_pdf(ROWS)})
    rows = _rows(pv)
    assert set(rows) == {"Sulphanilamide", "HP300H", "Rocha virgem 80 mesh", "C30 2104"}
    hp = rows["HP300H"]
    assert hp["n_measurements"] == 3 and hp["replicates"] == [1, 2, 3]
    assert hp["action"] == "create" and hp["suggested"]["fraction"] == "H" and hp["suggested"]["temperature_c"] == 300
    assert hp["values"]["chnso.C"] == 21.0
    # padrões: grupo à parte, ignorados por padrão
    assert rows["Sulphanilamide"]["kind"] == "standard" and rows["Sulphanilamide"]["action"] == "skip"
    assert pv["counts"]["to_create"] == 3 and pv["counts"]["ignored_rows"] == 1
    assert client.get(f"projects/{project['id']}/samples", headers=PESQ).json()["samples"] == []


def test_chosen_technique_mismatch_warns(client, project):
    files = [("files", ("leco.csv", syn.leco_csv(LECO_SETS), "text/csv"))]
    r = client.post(f"projects/{project['id']}/imports/preview", files=files, data={"technique": "chnso"}, headers=PESQ)
    assert r.status_code == 200
    assert "parece ser de LECO" in r.json()["files"][0]["warnings"][0]
    r = client.post(f"projects/{project['id']}/imports/preview", files=files, data={"technique": "xyz"}, headers=PESQ)
    assert r.status_code == 400


def test_existing_samples_are_suggested_and_registered_first(client, project):
    pid = project["id"]
    r = client.post(f"projects/{pid}/samples/bulk", json={"codes": ["HP300H\nRocha virgem 80 mesh; HP320E.1, HP320E.2"]}, headers=PESQ)
    assert r.status_code == 201
    assert r.json()["created"] == ["HP300H", "Rocha virgem 80 mesh", "HP320E.1"]  # .2 = mesma amostra HP320E
    assert r.json()["existing"] == ["HP320E.2"]
    assert set(_table(client, pid)) == {"HP300H", "Rocha virgem 80 mesh", "HP320E"}
    pv = upload(client, pid, {"run.pdf": syn.chnso_summary_pdf(ROWS)})
    rows = _rows(pv)
    assert rows["HP300H"]["action"] == "link" and rows["HP300H"]["sample_code"] == "HP300H"
    assert rows["Rocha virgem 80 mesh"]["action"] == "link"


def test_confirm_then_reimport_same_file_shows_what_was_imported(client, project, sent):
    pdf = syn.chnso_summary_pdf(ROWS)
    result = confirm(client, project["id"], upload(client, project["id"], {"run.pdf": pdf}))
    assert result["samples_created"] == 3 and result["analyses_created"] == 5 and result["skipped"] == 1
    hp = _table(client, project["id"])["HP300H"]
    assert hp["values"]["chnso.C"]["n"] == 3 and hp["values"]["chnso.C"]["mean"] == 21.0

    again = upload(client, project["id"], {"run.pdf": pdf})
    assert again["files"][0]["status"] == "duplicado"
    assert "HP300H" in again["files"][0]["already_in_samples"]
    assert again["rows"] == []
    assert sent and sent[-1]["levels"] == [1, 2] and sent[-1]["email"] is False
    assert sent[-1]["subject"] == "3 amostras importadas em Projeto Teste"


def test_other_print_of_same_run_updates_instead_of_duplicating(client, project):
    confirm(client, project["id"], upload(client, project["id"], {"a.pdf": syn.chnso_summary_pdf(ROWS)}))
    changed = [list(r) for r in ROWS]
    changed[2][4] = 30.0
    pv = upload(client, project["id"], {"b.pdf": syn.chnso_summary_pdf([tuple(r) for r in changed])})
    hp = _rows(pv)["HP300H"]
    assert hp["action"] == "link" and hp["updates_existing"]
    res = confirm(client, project["id"], pv)
    assert res["analyses_created"] == 0 and res["analyses_updated"] == 5 and res["samples_created"] == 0
    assert _table(client, project["id"])["HP300H"]["values"]["chnso.C"]["mean"] == (30 + 22 + 21) / 3


def test_summary_wins_over_single_sample_pdf_in_same_batch(client, project):
    single = syn.chnso_single_pdf(3, "Smp", "HP300H-1", {"Carbon": 99.0})
    pv = upload(client, project["id"], {"single.pdf": single, "summary.pdf": syn.chnso_summary_pdf(ROWS)})
    ms = [m for m in _rows(pv)["HP300H"]["measurements"] if m["replicate"] == 1]
    assert len(ms) == 2 and sum(1 for m in ms if m["duplicate_of"]) == 1
    confirm(client, project["id"], pv)
    assert _table(client, project["id"])["HP300H"]["values"]["chnso.C"]["mean"] == 21.0


def test_newest_print_of_same_summary_wins_in_one_batch(client, project):
    old = syn.chnso_summary_pdf(ROWS)
    changed = [list(r) for r in ROWS]
    changed[2][4] = 40.0
    new = syn.chnso_summary_pdf([tuple(r) for r in changed], printed="02 Jan 2026 - 10:00:00")
    confirm(client, project["id"], upload(client, project["id"], {"a - nova.pdf": new, "b - antiga.pdf": old}))
    assert _table(client, project["id"])["HP300H"]["values"]["chnso.C"]["mean"] == (40 + 22 + 21) / 3


ALIQUOT_SETS = [
    {"name": "HP320E.1", "set_id": "S1", "reps": [(10.0, 1.0, 0.2, "Included"), (12.0, 1.0, 0.2, "Included")]},
    {"name": "HP320E.2", "set_id": "S2", "reps": [(14.0, 1.0, 0.2, "Included"), (16.0, 1.0, 0.2, "Included")]},
]


def test_aliquot_rows_suggest_the_same_sample(client, project):
    pv = upload(client, project["id"], {"leco.csv": syn.leco_csv(ALIQUOT_SETS)})
    rows = _rows(pv)
    assert set(rows) == {"HP320E.1", "HP320E.2"}
    assert rows["HP320E.1"]["suggested"]["code"] == rows["HP320E.2"]["suggested"]["code"] == "HP320E"
    assert rows["HP320E.1"]["aliquots"] == [1]
    res = confirm(client, project["id"], pv)  # as duas linhas "criar HP320E" viram UMA amostra
    assert res["samples_created"] == 1
    sample = _table(client, project["id"])["HP320E"]
    assert sample["values"]["leco.C"]["mean"] == 13.0 and sample["values"]["leco.C"]["n"] == 4
    detail = client.get(f"projects/{project['id']}/samples/{sample['id']}", headers=PESQ).json()
    assert {a["aliquot"]: a["values"]["C"]["mean"] for a in detail["aliquots"]} == {1: 11.0, 2: 15.0}


def test_batch_assignment_and_alias_memory(client, project):
    pid = project["id"]
    target = client.post(f"projects/{pid}/samples", json={"code": "Rocha A extraída"}, headers=PESQ).json()
    pv = upload(client, pid, {"leco.csv": syn.leco_csv(ALIQUOT_SETS)})
    # as duas linhas atribuídas de uma vez à mesma amostra existente
    decisions = [{"row": r["row"], "action": "link", "sample_id": target["id"]} for r in pv["rows"]]
    res = confirm(client, pid, pv, decisions)
    assert res["samples_linked"] == 2 and res["aliases_saved"] == 2
    detail = client.get(f"projects/{pid}/samples/{target['id']}", headers=PESQ).json()
    assert sorted(a["alias"] for a in detail["aliases"]) == ["HP320E.1", "HP320E.2"]
    assert detail["values"]["leco.C"]["n"] == 4

    # próxima importação com os mesmos nomes: já vem atribuída (lembrado)
    other = [{**s, "set_id": s["set_id"] + "b"} for s in ALIQUOT_SETS]
    pv2 = upload(client, pid, {"leco2.csv": syn.leco_csv(other)})
    for row in pv2["rows"]:
        assert row["action"] == "link" and row["sample_id"] == target["id"] and row["suggestion_source"] == "lembrado"

    # apagar um nome lembrado: aquela linha volta a sugerir pelo código
    alias_id = detail["aliases"][0]["id"]
    assert client.delete(f"projects/{pid}/samples/{target['id']}/aliases/{alias_id}", headers=PESQ).status_code == 204
    pv3 = upload(client, pid, {"leco2.csv": syn.leco_csv(other)})
    assert sorted(r["suggestion_source"] for r in pv3["rows"]) == ["lembrado", "nova"]


def test_manual_alias_and_conflicts(client, project):
    pid = project["id"]
    a = client.post(f"projects/{pid}/samples", json={"code": "HP300H"}, headers=PESQ).json()
    client.post(f"projects/{pid}/samples", json={"code": "HP300E"}, headers=PESQ)
    r = client.post(f"projects/{pid}/samples/{a['id']}/aliases", json={"alias": "Amostra 300 H lab"}, headers=PESQ)
    assert r.status_code == 201 and r.json()["aliases"][0]["alias"] == "Amostra 300 H lab"
    assert client.post(f"projects/{pid}/samples/{a['id']}/aliases", json={"alias": "hp300e"}, headers=PESQ).status_code == 409
    assert client.post(f"projects/{pid}/samples/{a['id']}/aliases", json={"alias": "HP300H"}, headers=PESQ).status_code == 400


def test_ignore_and_create_paths(client, project):
    pid = project["id"]
    pv = upload(client, pid, {"run.pdf": syn.chnso_summary_pdf(ROWS)})
    rows = _rows(pv)
    decisions = [
        {"row": rows["Sulphanilamide"]["row"], "action": "create", "code": "Padrão sulfanilamida", "fraction": "STD"},
        {"row": rows["C30 2104"]["row"], "action": "skip"},
        {"row": rows["HP300H"]["row"], "action": "create", "code": "HP300H", "fraction": "SE", "temperature_c": 301},
    ]
    res = confirm(client, pid, pv, decisions)
    table = _table(client, pid)
    assert "C30 2104" not in table
    assert table["Padrão sulfanilamida"]["kind"] == "standard"
    assert table["HP300H"]["fraction"] == "SE" and table["HP300H"]["temperature_c"] == 301
    assert res["samples_created"] == 3  # padrão, HP300H e rocha virgem (sugestão)


def test_link_without_sample_is_refused(client, project):
    pv = upload(client, project["id"], {"run.pdf": syn.chnso_summary_pdf(ROWS)})
    row = _rows(pv)["HP300H"]["row"]
    r = client.post(
        f"projects/{project['id']}/imports/{pv['batch_id']}/confirm", json={"decisions": [{"row": row, "action": "link"}]}, headers=PESQ
    )
    assert r.status_code == 400 and "Escolha a amostra" in r.json()["detail"]


def test_zip_with_gas_folders_creates_experiment_with_conditions(client, project):
    zipped = syn.zip_of(
        {
            "HP320NC - Fulano/Modelo - Dados FID 20260101.xlsx": syn.gc_xlsx("FID", "HP320", FID),
            "HP320NC - Fulano/Modelo - HP320NC - Planilha cálculo gás.xlsx": syn.gas_xlsx("HP320NC"),
            "HP320NC - Fulano/~$Modelo - Planilha.xlsx": b"lixo",
        }
    )
    pv = upload(client, project["id"], {"gas.zip": zipped})
    assert sorted(f["status"] for f in pv["files"]) == ["ignorado", "ok", "ok"]
    gas = _rows(pv)["HP320NC"]
    assert gas["suggested"]["code"] == "HP320NC (gás)" and gas["suggested"]["fraction"] == "G" and gas["n_measurements"] == 2
    confirm(client, project["id"], pv)
    exps = client.get(f"projects/{project['id']}/experiments", headers=PESQ).json()
    exp = exps[0]
    assert len(exps) == 1 and exp["code"] == "HP320NC" and exp["temperature_c"] == 320
    assert exp["atmosphere"] == "nitrogênio" and exp["replicate_letter"] == "C"
    assert exp["reactor"] == "Reator X" and exp["conditions"]["gas_enchimento"] == "Nitrogênio"
    assert [s["code"] for s in exp["samples"]] == ["HP320NC (gás)"]


def test_gas_row_never_links_to_rock_sample_with_same_code(client, project):
    pid = project["id"]
    rock = client.post(f"projects/{pid}/samples", json={"code": "HP320NC"}, headers=PESQ).json()
    assert rock["fraction"] == "HP"
    pv = upload(client, pid, {"HP320NC - Planilha cálculo gás.xlsx": syn.gas_xlsx("HP320NC")})
    row = _rows(pv)["HP320NC"]
    assert row["action"] == "create" and row["suggested"]["code"] == "HP320NC (gás)"
    res = confirm(client, pid, pv)
    assert res["aliases_saved"] == 0  # nome derivável do código: nada a lembrar
    assert set(_table(client, pid)) == {"HP320NC", "HP320NC (gás)"}


def test_bulk_experiments(client, project):
    r = client.post(f"projects/{project['id']}/experiments/bulk", json={"codes": ["HP300NA\nHP300NB\nHP300NA"]}, headers=PESQ)
    assert r.json() == {"created": ["HP300NA", "HP300NB"], "existing": []}
    exps = client.get(f"projects/{project['id']}/experiments", headers=PESQ).json()
    assert {(e["code"], e["replicate_letter"]) for e in exps} == {("HP300NA", "A"), ("HP300NB", "B")}


def test_leco_diagnostic_zip_is_refused(client, project):
    zipped = syn.zip_of({"MondoFiles/2026010110.log": b"log", "Cornerstone.Configuration.xml": b"<x/>"})
    pv = upload(client, project["id"], {"SC832DR.zip": zipped})
    assert pv["files"][0]["status"] == "ignorado" and "diagnóstico do LECO" in pv["files"][0]["message"]


def test_confirm_twice_is_conflict(client, project):
    pv = upload(client, project["id"], {"run.pdf": syn.chnso_summary_pdf(ROWS)})
    confirm(client, project["id"], pv)
    r = client.post(f"projects/{project['id']}/imports/{pv['batch_id']}/confirm", json={"decisions": []}, headers=PESQ)
    assert r.status_code == 409


def test_error_files_are_reported_not_fatal(client, project):
    pv = upload(client, project["id"], {"ruim.csv": b"a,b\n1,2\n", "leco.csv": syn.leco_csv(LECO_SETS)})
    assert {f["filename"]: f["status"] for f in pv["files"]} == {"ruim.csv": "erro", "leco.csv": "ok"}
    assert pv["counts"]["errors"] == 1


def test_history_records_the_import(client, project):
    confirm(client, project["id"], upload(client, project["id"], {"run.pdf": syn.chnso_summary_pdf(ROWS)}))
    events = client.get(f"projects/{project['id']}/history", headers=ADMIN).json()
    imp = next(e for e in events if e["action"] == "importacao")
    assert imp["username"] == "pessoa3" and imp["details"]["files"] == ["run.pdf"]
    files = client.get(f"projects/{project['id']}/files", headers=PESQ).json()
    assert files[0]["filename"] == "run.pdf" and files[0]["status"] == "imported"
    dl = client.get(f"projects/{project['id']}/files/{files[0]['id']}/download", headers=PESQ)
    assert dl.status_code == 200 and dl.content[:5] == b"%PDF-"
