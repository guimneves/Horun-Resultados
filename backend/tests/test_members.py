"""Acesso por projeto (Pessoas do projeto) — ESPECIFICACAO.md, seção 7."""

from __future__ import annotations

import pytest

from tests import synthetic as syn
from tests.conftest import ADMIN, COORD, IC, PESQ, TEC, add_members, confirm, person, upload
from tests.test_parsers import ROWS

PESQ2 = person("6", 3)
TEC2 = person("7", 4)
IC2 = person("8", 5)
COORD2 = person("9", 2)


def _new_project(client, name="Fechado"):
    r = client.post("projects", json={"name": name}, headers=COORD)
    assert r.status_code == 201
    return r.json()["id"]


def _project_routes(client, pid, who, sample_id, analysis_id, file_id):
    """Uma chamada de cada rota por projeto — leitura e escrita."""
    files = [("files", ("run.pdf", syn.chnso_summary_pdf(ROWS[:1]), "application/pdf"))]
    return [
        client.get(f"projects/{pid}", headers=who),
        client.get(f"projects/{pid}/samples", headers=who),
        client.get(f"projects/{pid}/samples/{sample_id}", headers=who),
        client.patch(f"projects/{pid}/samples/{sample_id}", json={"notes": "x"}, headers=who),
        client.post(f"projects/{pid}/samples/{sample_id}/validation", json={"valid": True}, headers=who),
        client.post(f"projects/{pid}/analyses/{analysis_id}/validation", json={"valid": True}, headers=who),
        client.get(f"projects/{pid}/experiments", headers=who),
        client.post(f"projects/{pid}/experiments", json={"code": "HP320NA"}, headers=who),
        client.get(f"projects/{pid}/series?technique=chnso&parameter=C", headers=who),
        client.get(f"projects/{pid}/analysis-data?technique=chnso", headers=who),
        client.post(f"projects/{pid}/imports/preview", files=files, headers=who),
        client.post(f"projects/{pid}/export", json={"format": "csv", "columns": []}, headers=who),
        client.get(f"projects/{pid}/files", headers=who),
        client.get(f"projects/{pid}/files/{file_id}/download", headers=who),
        client.get(f"projects/{pid}/history", headers=who),
        client.get(f"projects/{pid}/members", headers=who),
        client.post(f"projects/{pid}/members", json={"user_id": "5"}, headers=who),
    ]


def _seed(client, pid):
    confirm(client, pid, upload(client, pid, {"run.pdf": syn.chnso_summary_pdf(ROWS)}, headers=COORD), headers=COORD)
    sample = next(s for s in client.get(f"projects/{pid}/samples", headers=COORD).json()["samples"] if s["code"] == "HP300H")
    analysis = client.get(f"projects/{pid}/samples/{sample['id']}", headers=COORD).json()["analyses"][0]
    file_id = client.get(f"projects/{pid}/files", headers=COORD).json()[0]["id"]
    return sample["id"], analysis["id"], file_id


@pytest.mark.parametrize("who", [PESQ, TEC, IC], ids=["pesquisador", "tecnico", "ic"])
def test_non_member_does_not_see_or_open_the_project(client, who):
    pid = _new_project(client)
    ids = _seed(client, pid)
    client.get("me", headers=IC)  # IC conhecido: o POST de membro só pode falhar pelo acesso
    assert client.get("projects?include_archived=true", headers=who).json() == []
    for r in _project_routes(client, pid, who, *ids):
        assert r.status_code == 404, (r.request.method, str(r.request.url), r.text)
    assert client.get(f"projects/{pid}/members", headers=COORD).json() == []  # nada mudou


def test_pesquisador_member_opens_and_works_in_the_project(client):
    pid = _new_project(client)
    other = _new_project(client, "Outro")
    ids = _seed(client, pid)
    add_members(client, pid, PESQ)
    assert [p["id"] for p in client.get("projects", headers=PESQ).json()] == [pid]
    assert client.get(f"projects/{other}/samples", headers=PESQ).status_code == 404
    for r in _project_routes(client, pid, PESQ, *ids)[:14]:
        assert r.status_code in (200, 201), (r.request.method, str(r.request.url), r.text)
    assert client.get(f"projects/{pid}/history", headers=PESQ).status_code == 403  # histórico segue só para níveis 1–2
    # removido, perde o acesso na hora
    member = next(m for m in client.get(f"projects/{pid}/members", headers=COORD).json() if m["user_id"] == "3")
    assert client.delete(f"projects/{pid}/members/{member['id']}", headers=COORD).status_code == 204
    assert client.get(f"projects/{pid}/samples", headers=PESQ).status_code == 404
    assert client.get("projects", headers=PESQ).json() == []


def test_coordinators_see_all_projects_and_manage_members(client):
    a, b = _new_project(client, "A"), _new_project(client, "B")
    for who in (ADMIN, COORD, COORD2):
        assert {p["id"] for p in client.get("projects", headers=who).json()} == {a, b}
        assert client.get(f"projects/{b}/samples", headers=who).status_code == 200
        me = client.get("me", headers=who).json()
        assert me["sees_all_projects"] is True and me["can_manage_members"] is True
    for who in (PESQ2, TEC2, IC2):
        client.get("me", headers=who)
    choices = {p["user_id"]: p["level"] for p in client.get(f"projects/{a}/members/candidates", headers=COORD).json()}
    assert choices == {"6": 3, "7": 4, "8": 5}  # pesquisadores, técnicos e ICs; coordenadores não
    assert client.post(f"projects/{a}/members", json={"user_id": "9"}, headers=COORD).status_code == 403
    assert client.post(f"projects/{a}/members", json={"user_id": "404"}, headers=COORD).status_code == 404
    add_members(client, a, PESQ2)
    assert client.post(f"projects/{a}/members", json={"user_id": "6"}, headers=COORD).status_code == 409


def test_pesquisador_adds_and_removes_only_tecnicos_and_ics(client, project):
    pid = project["id"]
    for who in (PESQ2, TEC2, IC2):
        client.get("me", headers=who)
    me = client.get("me", headers=PESQ).json()
    assert me["sees_all_projects"] is False and me["can_manage_members"] is True
    assert client.get(f"projects/{pid}", headers=PESQ).json()["can_manage_members"] is True
    choices = {p["user_id"] for p in client.get(f"projects/{pid}/members/candidates", headers=PESQ).json()}
    assert choices == {"7", "8"}  # técnico e IC ainda fora do projeto; nunca outro pesquisador

    r = client.post(f"projects/{pid}/members", json={"user_id": "6"}, headers=PESQ)
    assert r.status_code == 403 and "técnico" in r.json()["detail"]
    for uid in ("7", "8"):
        r = client.post(f"projects/{pid}/members", json={"user_id": uid}, headers=PESQ)
        assert r.status_code == 201 and r.json()["added_by"] == "pessoa3"
    assert client.get(f"projects/{pid}/samples", headers=TEC2).status_code == 200

    members = {m["user_id"]: m for m in client.get(f"projects/{pid}/members", headers=PESQ).json()}
    assert members["3"]["can_remove"] is False and members["7"]["can_remove"] is True
    assert client.delete(f"projects/{pid}/members/{members['3']['id']}", headers=PESQ).status_code == 403  # pesquisador
    assert client.delete(f"projects/{pid}/members/{members['8']['id']}", headers=PESQ).status_code == 204
    assert client.get(f"projects/{pid}/samples", headers=IC2).status_code == 404

    actions = [e["action"] for e in client.get(f"projects/{pid}/history", headers=COORD).json()]
    assert actions.count("membro_adicionado") == 5 and actions.count("membro_removido") == 1


@pytest.mark.parametrize("who", [TEC, IC], ids=["tecnico", "ic"])
def test_tecnico_and_ic_see_only_their_projects_and_members_read_only(client, project, who):
    other = _new_project(client, "Outro")
    assert [p["id"] for p in client.get("projects", headers=who).json()] == [project["id"]]
    assert client.get(f"projects/{other}", headers=who).status_code == 404
    me = client.get("me", headers=who).json()
    assert me["sees_all_projects"] is False and me["can_manage_members"] is False
    members = client.get(f"projects/{project['id']}/members", headers=who).json()
    assert {m["user_id"] for m in members} == {"3", "4", "5"} and not any(m["can_remove"] for m in members)
    assert client.get(f"projects/{project['id']}/members/candidates", headers=who).status_code == 403
    assert client.post(f"projects/{project['id']}/members", json={"user_id": "5"}, headers=who).status_code == 403
    assert client.delete(f"projects/{project['id']}/members/{members[0]['id']}", headers=who).status_code == 403


def test_access_uses_the_live_level_not_the_level_at_add(client, project):
    pid = project["id"]
    other = _new_project(client, "Outro")
    promoted = person("4", 2)  # o técnico virou coordenador(a) no Horun: vê tudo
    assert client.get(f"projects/{other}/samples", headers=promoted).status_code == 200
    demoted = person("3", 4)  # pesquisador(a) que agora é técnico(a): segue membro, só leitura
    assert client.get(f"projects/{pid}/samples", headers=demoted).status_code == 200
    assert client.post(f"projects/{pid}/samples", json={"code": "HP300H"}, headers=demoted).status_code == 403
    assert client.get(f"projects/{pid}/members/candidates", headers=demoted).status_code == 403


def test_deleting_a_project_removes_its_members(client, project):
    pid = project["id"]
    assert client.request("DELETE", f"projects/{pid}", json={"confirm_name": "Projeto Teste"}, headers=ADMIN).status_code == 204
    new = _new_project(client, "Projeto Teste")
    assert client.get(f"projects/{new}", headers=PESQ).status_code == 404
