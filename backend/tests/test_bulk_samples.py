"""Seleção de várias amostras na aba Amostras: excluir e validar de uma vez."""

from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, select

from app.core.config import settings
from app.db.models import Analysis, AnalysisValue, SampleAlias, StoredFile
from app.db.session import engine
from tests import synthetic as syn
from tests.conftest import COORD, IC, PESQ, confirm, upload
from tests.test_parsers import ROWS

ONLY_HP320 = [(1, "Smp", "HP320E-1", 0.5, 30.0, 3.0, 2.0, None, 1.0), (2, "Smp", "HP320E-2", 0.5, 31.0, 3.1, 2.1, None, 1.0)]


def _setup(client, pid):
    """Dois arquivos: um com várias amostras (compartilhado) e um só da HP320E."""
    confirm(client, pid, upload(client, pid, {"run.pdf": syn.chnso_summary_pdf(ROWS)}))
    confirm(client, pid, upload(client, pid, {"run2.pdf": syn.chnso_summary_pdf(ONLY_HP320)}))
    table = client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]
    return {s["code"]: s["id"] for s in table}


def _disk_path(digest: str) -> Path:
    return Path(settings.upload_root) / digest[:2] / digest


def _files(pid):
    with Session(engine) as session:
        return {f.filename: f.sha256 for f in session.exec(select(StoredFile).where(StoredFile.project_id == pid))}


def test_colaborador_cannot_bulk_delete_or_validate(client, project):
    pid = project["id"]
    ids = _setup(client, pid)
    body = {"sample_ids": [ids["HP300H"]]}
    assert client.post(f"projects/{pid}/samples/bulk-delete", json=body, headers=PESQ).status_code == 403
    assert client.post(f"projects/{pid}/samples/bulk-delete", json={**body, "dry_run": True}, headers=IC).status_code == 403
    assert client.post(f"projects/{pid}/samples/bulk-validation", json={**body, "valid": True}, headers=IC).status_code == 403
    assert "HP300H" in {s["code"] for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}


def test_ids_from_other_project_or_unknown_are_rejected_and_nothing_changes(client, project):
    pid = project["id"]
    ids = _setup(client, pid)
    other = client.post("projects", json={"name": "Outro"}, headers=COORD).json()
    foreign = client.post(f"projects/{other['id']}/samples", json={"code": "HP400H"}, headers=COORD).json()["id"]
    for bad in ([ids["HP300H"], foreign], [ids["HP300H"], 999999]):
        r = client.post(f"projects/{pid}/samples/bulk-delete", json={"sample_ids": bad}, headers=COORD)
        assert r.status_code == 404 and "Nada foi alterado" in r.json()["detail"]
        r = client.post(f"projects/{pid}/samples/bulk-validation", json={"sample_ids": bad, "valid": True}, headers=COORD)
        assert r.status_code == 404
    assert client.post(f"projects/{pid}/samples/bulk-delete", json={"sample_ids": []}, headers=COORD).status_code == 422
    codes = {s["code"] for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    assert {"HP300H", "HP320E"} <= codes
    assert client.get(f"projects/{other['id']}/samples/{foreign}", headers=PESQ).status_code == 200


def test_preview_counts_analyses_per_sample_without_deleting(client, project):
    pid = project["id"]
    ids = _setup(client, pid)
    r = client.post(f"projects/{pid}/samples/bulk-delete", json={"sample_ids": [ids["HP300H"], ids["HP320E"]], "dry_run": True}, headers=COORD)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["dry_run"] is True
    assert {s["code"]: s["analyses"] for s in out["samples"]} == {"HP300H": 3, "HP320E": 2}
    assert out["total_samples"] == 2 and out["total_analyses"] == 5
    assert out["files_removed"] == 1 and out["files_kept"] == 1  # run2 só tinha HP320E; run tem outras amostras
    assert len(client.get(f"projects/{pid}/samples/{ids['HP300H']}", headers=PESQ).json()["analyses"]) == 3


def test_bulk_delete_cascades_and_keeps_shared_file_removes_orphan(client, project):
    pid = project["id"]
    ids = _setup(client, pid)
    client.post(f"projects/{pid}/samples/{ids['HP300H']}/aliases", json={"alias": "amostra 300 H"}, headers=COORD)
    files = _files(pid)
    assert _disk_path(files["run.pdf"]).exists() and _disk_path(files["run2.pdf"]).exists()
    with Session(engine) as session:
        doomed = [a.id for a in session.exec(select(Analysis).where(Analysis.sample_id.in_([ids["HP300H"], ids["HP320E"]])))]  # type: ignore[union-attr]
    assert len(doomed) == 5

    r = client.post(f"projects/{pid}/samples/bulk-delete", json={"sample_ids": [ids["HP300H"], ids["HP320E"], ids["HP300H"]]}, headers=COORD)
    assert r.status_code == 200, r.text
    assert r.json() == {"dry_run": False, "deleted_samples": 2, "deleted_analyses": 5, "files_removed": 1, "files_kept": 1}

    codes = {s["code"] for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    assert "HP300H" not in codes and "HP320E" not in codes and codes  # as outras amostras do arquivo ficam
    with Session(engine) as session:
        assert session.exec(select(Analysis).where(Analysis.id.in_(doomed))).first() is None  # type: ignore[union-attr]
        assert session.exec(select(AnalysisValue).where(AnalysisValue.analysis_id.in_(doomed))).first() is None  # type: ignore[union-attr]
        assert session.exec(select(SampleAlias).where(SampleAlias.project_id == pid)).first() is None
    after = _files(pid)
    assert "run.pdf" in after and _disk_path(files["run.pdf"]).exists()  # compartilhado: fica
    assert "run2.pdf" not in after and not _disk_path(files["run2.pdf"]).exists()  # órfão: sai do banco e do disco
    # o arquivo órfão pode ser importado de novo
    assert upload(client, pid, {"run2.pdf": syn.chnso_summary_pdf(ONLY_HP320)})["files"][0]["status"] == "ok"

    history = client.get(f"projects/{pid}/history", headers=PESQ).json()
    event = next(e for e in history if e["action"] == "amostras_excluidas")
    assert "2 amostra(s)" in event["summary"] and "5 medição(ões)" in event["summary"]


def test_single_delete_uses_same_logic_and_removes_orphan_file(client, project):
    pid = project["id"]
    ids = _setup(client, pid)
    files = _files(pid)
    assert client.delete(f"projects/{pid}/samples/{ids['HP320E']}", headers=COORD).status_code == 204
    assert "run2.pdf" not in _files(pid) and not _disk_path(files["run2.pdf"]).exists()


def test_bulk_validation_marks_valid_invalid_and_pending(client, project):
    pid = project["id"]
    ids = _setup(client, pid)
    chosen = [ids["HP300H"], ids["HP320E"]]
    r = client.post(f"projects/{pid}/samples/bulk-validation", json={"sample_ids": chosen, "valid": False}, headers=COORD)
    assert r.status_code == 200 and r.json() == {"updated": 2, "valid": False}
    rows = {s["code"]: s for s in client.get(f"projects/{pid}/samples?mode=todas", headers=PESQ).json()["samples"]}
    assert rows["HP300H"]["valid"] is False and rows["HP320E"]["valid"] is False
    detail = client.get(f"projects/{pid}/samples/{ids['HP300H']}", headers=PESQ).json()
    assert detail["validated_by"] == "pessoa2"
    client.post(f"projects/{pid}/samples/bulk-validation", json={"sample_ids": chosen, "valid": True}, headers=COORD)
    rows = {s["code"]: s for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    assert rows["HP300H"]["valid"] is True and rows["HP320E"]["valid"] is True
    client.post(f"projects/{pid}/samples/bulk-validation", json={"sample_ids": chosen, "valid": None}, headers=COORD)
    detail = client.get(f"projects/{pid}/samples/{ids['HP300H']}", headers=PESQ).json()
    assert detail["valid"] is None and detail["validated_by"] is None
    assert any("2 amostra(s) como válidas" in e["summary"] for e in client.get(f"projects/{pid}/history", headers=PESQ).json())


def test_archived_project_refuses_bulk_actions(client, project):
    pid = project["id"]
    ids = _setup(client, pid)
    client.post(f"projects/{pid}/archive", headers=COORD)
    assert client.post(f"projects/{pid}/samples/bulk-delete", json={"sample_ids": [ids["HP300H"]]}, headers=COORD).status_code == 409
    assert client.post(f"projects/{pid}/samples/bulk-validation", json={"sample_ids": [ids["HP300H"]], "valid": True}, headers=COORD).status_code == 409
