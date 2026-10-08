"""Permissões pelo cargo no Horun (ESPECIFICACAO.md, seção 7) e
arquivar/excluir projeto."""

from __future__ import annotations

import pytest

from tests import synthetic as syn
from tests.conftest import ADMIN, COORD, IC, PESQ, TEC, confirm, person, upload
from tests.test_parsers import ROWS


def test_identity_is_required_outside_dev_mode(client):
    assert client.get("projects").status_code == 401
    assert client.get("http://testserver/health").json() == {"status": "ok", "module": "resultados"}


@pytest.mark.parametrize(
    "headers, role, edit",
    [(ADMIN, "coordenador", True), (COORD, "coordenador", True), (PESQ, "colaborador", True), (TEC, "colaborador", False), (IC, "colaborador", False)],
)
def test_me_reports_role_from_core_level(client, headers, role, edit):
    me = client.get("me", headers=headers).json()
    assert me["role"] == role and me["dev_mode"] is False and me["can_edit"] is edit
    assert me["can_delete_projects"] is (headers is ADMIN)


def test_admin_role_without_level_header_counts_as_coordinator(client):
    old_core = {"X-Horun-User-Id": "9", "X-Horun-User": "x", "X-Horun-Role": "admin"}
    assert client.get("me", headers=old_core).json()["role"] == "coordenador"


def test_pesquisador_imports_edits_deletes_and_validates(client, project):
    pid = project["id"]
    assert client.post("projects", json={"name": "Outro"}, headers=PESQ).status_code == 403
    exp = client.post(f"projects/{pid}/experiments", json={"code": "HP300NA"}, headers=PESQ)
    assert exp.status_code == 201 and exp.json()["atmosphere"] == "nitrogênio" and exp.json()["replicate_letter"] == "A"
    assert client.patch(f"projects/{pid}/experiments/{exp.json()['id']}", json={"notes": "ok"}, headers=PESQ).status_code == 200
    sample = client.post(f"projects/{pid}/samples", json={"code": "HP300H"}, headers=PESQ).json()
    assert sample["fraction"] == "H" and sample["temperature_c"] == 300
    assert client.patch(f"projects/{pid}/samples/{sample['id']}", json={"notes": "ok"}, headers=PESQ).status_code == 200
    confirm(client, pid, upload(client, pid, {"run.pdf": syn.chnso_summary_pdf(ROWS)}, headers=PESQ), headers=PESQ)
    analysis = client.get(f"projects/{pid}/samples/{sample['id']}", headers=PESQ).json()["analyses"][0]

    r = client.post(f"projects/{pid}/samples/{sample['id']}/validation", json={"valid": True}, headers=PESQ)
    assert r.status_code == 200 and r.json()["valid"] is True
    assert client.post(f"projects/{pid}/analyses/{analysis['id']}/validation", json={"valid": False}, headers=PESQ).status_code == 200
    assert client.post(f"projects/{pid}/archive", headers=PESQ).status_code == 403
    assert client.patch(f"projects/{pid}", json={"name": "X"}, headers=PESQ).status_code == 403
    assert client.patch("fractions/SE", json={"label": "x"}, headers=PESQ).status_code == 403

    assert client.delete(f"projects/{pid}/analyses/{analysis['id']}", headers=PESQ).status_code == 204
    assert client.delete(f"projects/{pid}/samples/{sample['id']}", headers=PESQ).status_code == 204
    assert client.delete(f"projects/{pid}/experiments/{exp.json()['id']}", headers=PESQ).status_code == 204


@pytest.mark.parametrize("who", [TEC, IC], ids=["tecnico", "ic"])
def test_tecnico_and_ic_only_view(client, project, who):
    pid = project["id"]
    confirm(client, pid, upload(client, pid, {"run.pdf": syn.chnso_summary_pdf(ROWS)}))
    exp = client.post(f"projects/{pid}/experiments", json={"code": "HP300NA"}, headers=PESQ).json()
    table = client.get(f"projects/{pid}/samples", headers=who).json()["samples"]
    sample = next(s for s in table if s["code"] == "HP300H")
    detail = client.get(f"projects/{pid}/samples/{sample['id']}", headers=who).json()
    analysis = detail["analyses"][0]
    # vê tudo, inclusive exportar
    assert client.get("projects", headers=who).status_code == 200
    assert client.get(f"projects/{pid}/experiments", headers=who).status_code == 200
    assert client.post(f"projects/{pid}/export", json={"format": "csv", "columns": []}, headers=who).status_code == 200

    files = [("files", ("run.pdf", syn.chnso_summary_pdf(ROWS), "application/pdf"))]
    pv = upload(client, pid, {"outro.pdf": syn.chnso_summary_pdf(ROWS[:1])})  # prévia feita por quem pode
    forbidden = [
        client.post(f"projects/{pid}/imports/preview", files=files, headers=who),
        client.post(f"projects/{pid}/imports/{pv['batch_id']}/confirm", json={"decisions": []}, headers=who),
        client.post(f"projects/{pid}/samples", json={"code": "HP340H"}, headers=who),
        client.post(f"projects/{pid}/samples/bulk", json={"codes": ["HP360H"]}, headers=who),
        client.patch(f"projects/{pid}/samples/{sample['id']}", json={"notes": "x"}, headers=who),
        client.delete(f"projects/{pid}/samples/{sample['id']}", headers=who),
        client.post(f"projects/{pid}/samples/{sample['id']}/validation", json={"valid": True}, headers=who),
        client.post(f"projects/{pid}/samples/{sample['id']}/aliases", json={"alias": "Rocha X"}, headers=who),
        client.post(f"projects/{pid}/analyses/{analysis['id']}/validation", json={"valid": False}, headers=who),
        client.delete(f"projects/{pid}/analyses/{analysis['id']}", headers=who),
        client.post(f"projects/{pid}/experiments", json={"code": "HP320NA"}, headers=who),
        client.post(f"projects/{pid}/experiments/bulk", json={"codes": ["HP320NB"]}, headers=who),
        client.patch(f"projects/{pid}/experiments/{exp['id']}", json={"notes": "x"}, headers=who),
        client.delete(f"projects/{pid}/experiments/{exp['id']}", headers=who),
        client.post("projects", json={"name": "Outro"}, headers=who),
        client.patch("fractions/SE", json={"label": "x"}, headers=who),
    ]
    for r in forbidden:
        assert r.status_code == 403, (r.request.method, str(r.request.url), r.text)
    assert "só visualizam" in forbidden[0].json()["detail"]
    after = client.get(f"projects/{pid}/samples/{sample['id']}", headers=who).json()
    assert len(after["analyses"]) == len(detail["analyses"]) and after["notes"] == detail["notes"]


def test_coordinator_validates_and_deletes(client, project):
    pid = project["id"]
    confirm(client, pid, upload(client, pid, {"run.pdf": syn.chnso_summary_pdf(ROWS)}))
    table = client.get(f"projects/{pid}/samples", headers=COORD).json()["samples"]
    hp = next(s for s in table if s["code"] == "HP300H")
    r = client.post(f"projects/{pid}/samples/{hp['id']}/validation", json={"valid": True}, headers=COORD)
    assert r.status_code == 200 and r.json()["valid"] is True and r.json()["validated_by"] == "pessoa2"
    analysis = r.json()["analyses"][0]
    r = client.post(f"projects/{pid}/analyses/{analysis['id']}/validation", json={"valid": False}, headers=COORD)
    assert r.json()["valid"] is False
    detail = client.get(f"projects/{pid}/samples/{hp['id']}", headers=PESQ).json()
    assert detail["values"]["chnso.C"]["n"] == 3  # detalhe mostra tudo
    row = next(s for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"] if s["code"] == "HP300H")
    assert row["values"]["chnso.C"]["n"] == 2  # tabela deixa a medição inválida de fora
    assert client.delete(f"projects/{pid}/analyses/{analysis['id']}", headers=COORD).status_code == 204
    assert client.delete(f"projects/{pid}/samples/{hp['id']}", headers=COORD).status_code == 204
    assert all(s["code"] != "HP300H" for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"])
    actions = {e["action"] for e in client.get(f"projects/{pid}/history", headers=ADMIN).json()}
    assert {"validacao", "medicao_excluida", "amostra_excluida", "importacao"} <= actions


def test_archive_makes_project_read_only_and_hides_it(client, project):
    pid = project["id"]
    assert client.post(f"projects/{pid}/archive", headers=COORD).json()["archived_at"]
    assert client.get("projects", headers=PESQ).json() == []
    assert len(client.get("projects?include_archived=true", headers=PESQ).json()) == 1
    assert client.post(f"projects/{pid}/samples", json={"code": "HP300H"}, headers=PESQ).status_code == 409
    files = [("files", ("run.pdf", syn.chnso_summary_pdf(ROWS), "application/pdf"))]
    assert client.post(f"projects/{pid}/imports/preview", files=files, headers=PESQ).status_code == 409
    assert client.post(f"projects/{pid}/unarchive", headers=COORD).json()["archived_at"] is None


def test_delete_project_only_level_1_with_typed_name(client, project):
    pid = project["id"]
    confirm(client, pid, upload(client, pid, {"run.pdf": syn.chnso_summary_pdf(ROWS)}))
    body = {"confirm_name": "Projeto Teste"}
    assert client.request("DELETE", f"projects/{pid}", json=body, headers=COORD).status_code == 403
    r = client.request("DELETE", f"projects/{pid}", json={"confirm_name": "projeto teste"}, headers=ADMIN)
    assert r.status_code == 400 and "não confere" in r.json()["detail"]
    assert client.request("DELETE", f"projects/{pid}", json=body, headers=ADMIN).status_code == 204
    assert client.get(f"projects/{pid}", headers=ADMIN).status_code == 404
    # o mesmo arquivo pode ser importado de novo num projeto novo
    new = client.post("projects", json={"name": "Novo"}, headers=ADMIN).json()
    pv = upload(client, new["id"], {"run.pdf": syn.chnso_summary_pdf(ROWS)})
    assert pv["files"][0]["status"] == "ok"


def test_duplicate_project_name_is_refused(client, project):
    assert client.post("projects", json={"name": "Projeto Teste"}, headers=COORD).status_code == 409


def test_dev_mode_view_as_level_switcher(client, monkeypatch):
    from app.core import identity

    monkeypatch.setattr(identity, "DEV_MODE", True)
    me = client.get("me").json()
    assert me["level"] == 1 and me["role"] == "coordenador" and me["dev_mode"] is True
    me = client.get("me", headers=person("dev-nivel-4", 4)).json()
    assert me["level"] == 4 and me["role"] == "colaborador" and me["can_edit"] is False
    assert client.post("projects", json={"name": "P"}, headers=person("dev-nivel-4", 4)).status_code == 403
    pid = client.post("projects", json={"name": "P"}).json()["id"]
    assert client.post(f"projects/{pid}/samples", json={"code": "HP300H"}, headers=person("dev-nivel-4", 4)).status_code == 403
    assert client.get("me", headers=person("dev-nivel-3", 3)).json()["can_edit"] is True
    assert client.post(f"projects/{pid}/samples", json={"code": "HP300H"}, headers=person("dev-nivel-3", 3)).status_code == 201


def test_fraction_table_is_editable_by_coordinator(client):
    fractions = {f["code"]: f for f in client.get("fractions", headers=PESQ).json()}
    assert fractions["SE"]["series_group"] == "H" and "sem extração" in fractions["SE"]["label"]
    assert fractions["STD"]["in_series"] is False
    r = client.patch("fractions/SE", json={"series_group": ""}, headers=COORD)
    assert r.status_code == 200 and r.json()["series_group"] == ""
    assert client.patch("fractions/SE", json={"series_group": "ZZ"}, headers=COORD).status_code == 400


def test_history_for_admin_and_coordinators(client, project):
    pid = project["id"]
    for who in (PESQ, TEC, IC):
        assert client.get(f"projects/{pid}/history", headers=who).status_code == 403
        assert client.get("me", headers=who).json()["can_see_history"] is False
    for who in (ADMIN, COORD):
        assert client.get(f"projects/{pid}/history", headers=who).status_code == 200
        assert client.get("me", headers=who).json()["can_see_history"] is True
