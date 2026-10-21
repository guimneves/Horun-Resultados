"""Unir amostras iguais (pedido do usuário, 21/10/2026): a mesma amostra com
nomes diferentes — as medições e os nomes lembrados vão para uma só."""

from sqlmodel import Session, select

from app.db.models import Analysis, AnalysisValue, Sample, SampleAlias
from app.db.session import engine
from tests.conftest import PESQ, TEC


def _sample(client, pid, code):
    r = client.post(f"projects/{pid}/samples", json={"code": code}, headers=PESQ)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _analysis(pid, sid, key, value):
    with Session(engine) as s:
        a = Analysis(project_id=pid, sample_id=sid, technique="leco", source_key=key, source_name=key)
        s.add(a)
        s.flush()
        s.add(AnalysisValue(analysis_id=a.id, parameter="C", value=value))
        s.commit()


def test_suggests_and_merges(client, project):
    pid = project["id"]
    keep = _sample(client, pid, "HP320E")
    dup = _sample(client, pid, "HP 320-E")  # mesmo código com espaço/hífen
    other = _sample(client, pid, "HP340E")
    _analysis(pid, keep, "k1", 10.0)
    _analysis(pid, dup, "k2", 12.0)
    _analysis(pid, dup, "k3", 11.0)
    with Session(engine) as s:
        s.add(SampleAlias(project_id=pid, sample_id=dup, alias="HP320 E (velho)", alias_norm="HP320E(VELHO)"))
        s.commit()

    groups = client.get(f"projects/{pid}/samples/duplicates", headers=PESQ).json()["groups"]
    assert [sorted(x["id"] for x in g["samples"]) for g in groups] == [sorted([keep, dup])]
    assert groups[0]["samples"][0]["id"] == dup  # mais medições primeiro

    prev = client.post(f"projects/{pid}/samples/merge", json={"target_id": keep, "source_ids": [dup], "dry_run": True}, headers=PESQ).json()
    assert prev["analyses"] == 2 and prev["sources"][0]["code"] == "HP 320-E"
    assert client.post(f"projects/{pid}/samples/merge", json={"target_id": keep, "source_ids": [dup]}, headers=TEC).status_code == 403

    r = client.post(f"projects/{pid}/samples/merge", json={"target_id": keep, "source_ids": [dup, keep]}, headers=PESQ)
    assert r.status_code == 200, r.text
    detail = r.json()["sample"]
    assert len(detail["analyses"]) == 3 and detail["values"]["leco.C"]["n"] == 3
    assert {a["alias"] for a in detail["aliases"]} == {"HP320 E (velho)", "HP 320-E"}
    with Session(engine) as s:
        assert s.get(Sample, dup) is None and s.get(Sample, other) is not None
        assert {a.sample_id for a in s.exec(select(Analysis)).all()} == {keep}
    assert client.get(f"projects/{pid}/samples/duplicates", headers=PESQ).json()["groups"] == []
    assert client.post(f"projects/{pid}/samples/merge", json={"target_id": keep, "source_ids": [keep]}, headers=PESQ).status_code == 400
