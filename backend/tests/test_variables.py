"""Variáveis de amostra (22/10/2026): embutidas (temperatura, tipo do
tabaco), criar/editar/apagar, preencher valores e Séries em função da
variável. Dados SINTÉTICOS."""

from __future__ import annotations

from tests.conftest import COORD, IC, PESQ, TEC
from tests.test_results import loaded  # noqa: F401 — fixture


def _vars(client, pid, headers=PESQ):
    r = client.get(f"projects/{pid}/variables", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _samples(client, pid):
    return {s["code"]: s for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}


def test_rock_project_has_temperature_builtin(client, project):
    data = _vars(client, project["id"])
    (temp,) = data["variables"]
    assert temp["key"] == "temperatura" and temp["builtin"] == "temperature" and temp["unit"] == "°C" and not temp["can_delete"]
    r = client.delete(f"projects/{project['id']}/variables/{temp['id']}", headers=PESQ)
    assert r.status_code == 400 and "não pode ser apagada" in r.json()["detail"]
    # nome e unidade mudam
    r = client.patch(f"projects/{project['id']}/variables/{temp['id']}", json={"label": "Temperatura do reator"}, headers=PESQ)
    assert r.status_code == 200 and r.json()["variables"][0]["label"] == "Temperatura do reator"


def test_tobacco_project_has_type_builtin_with_fraction_options(client):
    p = client.post("projects", json={"name": "Tabaco V", "profile": {"sample_type": "tabaco"}}, headers=COORD).json()
    (tipo,) = _vars(client, p["id"], COORD)["variables"]
    assert tipo["key"] == "tipo" and tipo["kind"] == "categoria" and not tipo["options_editable"]
    assert {"CHA", "CIG", "NAR"} <= {o["value"] for o in tipo["options"]}


def test_create_edit_delete_and_fill(client, loaded):  # noqa: F811
    pid = loaded["id"]
    r = client.post(f"projects/{pid}/variables", json={"label": "Pressão", "kind": "numero", "unit": "bar"}, headers=PESQ)
    assert r.status_code == 201, r.text
    press = next(v for v in r.json()["variables"] if v["label"] == "Pressão")
    r = client.post(f"projects/{pid}/variables", json={"label": "pressão", "kind": "numero"}, headers=PESQ)
    assert r.status_code == 400 and "Já existe" in r.json()["detail"]
    r = client.post(f"projects/{pid}/variables", json={"label": "Lote", "kind": "categoria", "options": ["L1", "L2", " "]}, headers=PESQ)
    lote = next(v for v in r.json()["variables"] if v["label"] == "Lote")
    assert [o["value"] for o in lote["options"]] == ["L1", "L2"]
    # técnico e IC só olham
    for who in (TEC, IC):
        assert client.post(f"projects/{pid}/variables", json={"label": "X"}, headers=who).status_code == 403

    s = _samples(client, pid)
    vals = [
        {"sample_id": s["HP300NA"]["id"], "key": press["key"], "value": "10,5"},
        {"sample_id": s["HP300NB"]["id"], "key": press["key"], "value": 20},
        {"sample_id": s["HP300NAE"]["id"], "key": press["key"], "value": 10.5},
        {"sample_id": s["HP300NA"]["id"], "key": lote["key"], "value": "l2"},
        {"sample_id": s["HP300NB"]["id"], "key": lote["key"], "value": "L1"},
    ]
    r = client.put(f"projects/{pid}/variables/values", json={"values": vals}, headers=PESQ)
    assert r.status_code == 200, r.text
    assert r.json()["values"][str(s["HP300NA"]["id"])][lote["key"]] == "L2"  # casa sem diferenciar maiúsculas
    # valor inválido recusa o lote inteiro, dizendo a amostra
    bad = [{"sample_id": s["HP300NB"]["id"], "key": press["key"], "value": 99}, {"sample_id": s["HP300NA"]["id"], "key": lote["key"], "value": "L9"}]
    r = client.put(f"projects/{pid}/variables/values", json={"values": bad}, headers=PESQ)
    assert r.status_code == 400 and "HP300NA" in r.json()["detail"]
    assert _samples(client, pid)["HP300NB"]["variables"][press["key"]] == 20

    # séries em função da pressão: uma linha por fração, pontos em 10,5 e 20
    data = client.get(f"projects/{pid}/series?technique=rockeval&parameter=TOC&variable={press['key']}", headers=PESQ).json()
    assert data["variable"]["unit"] == "bar" and data["baseline"] == []
    by = {x["fraction"]: x for x in data["series"]}
    assert [p["x"] for p in by["H"]["points"]] == [10.5, 20]
    assert by["H"]["points"][0]["mean"] == 11.0 and [p["x"] for p in by["E"]["points"]] == [10.5]

    # séries por categoria: na ordem das categorias
    data = client.get(f"projects/{pid}/series?technique=rockeval&parameter=TOC&variable={lote['key']}", headers=PESQ).json()
    assert [p["x"] for p in data["series"][0]["points"]] == ["L1", "L2"]
    assert [c["value"] for c in data["variable"]["categories"]] == ["L1", "L2"]

    # renomear categoria leva os valores; tirar categoria em uso é recusado
    r = client.patch(f"projects/{pid}/variables/{lote['id']}", json={"options": ["Lote 1", "L2"], "renames": {"L1": "Lote 1"}}, headers=PESQ)
    assert r.status_code == 200, r.text
    assert _samples(client, pid)["HP300NB"]["variables"][lote["key"]] == "Lote 1"
    r = client.patch(f"projects/{pid}/variables/{lote['id']}", json={"options": ["Lote 1"]}, headers=PESQ)
    assert r.status_code == 400 and '"L2" (1 amostra(s))' in r.json()["detail"]

    # temperatura também se preenche por aqui (é a da amostra)
    r = client.put(f"projects/{pid}/variables/values", json={"values": [{"sample_id": s["HP300NAE"]["id"], "key": "temperatura", "value": 320}]}, headers=PESQ)
    assert r.status_code == 200 and _samples(client, pid)["HP300NAE"]["temperature_c"] == 320

    # apagar leva os valores junto
    assert client.delete(f"projects/{pid}/variables/{press['id']}", headers=PESQ).status_code == 204
    assert press["key"] not in _samples(client, pid)["HP300NA"]["variables"]
    assert client.get(f"projects/{pid}/series?technique=rockeval&parameter=TOC&variable={press['key']}", headers=PESQ).status_code == 404


def test_default_series_still_on_temperature(client, loaded):  # noqa: F811
    data = client.get(f"projects/{loaded['id']}/series?technique=rockeval&parameter=TOC", headers=PESQ).json()
    assert data["variable"]["builtin"] == "temperature" and data["baseline"]
    assert all(p["x"] == p["temperature_c"] == 300 for x in data["series"] for p in x["points"])


def test_sample_delete_and_merge_keep_values_consistent(client, loaded):  # noqa: F811
    pid = loaded["id"]
    r = client.post(f"projects/{pid}/variables", json={"label": "Lote", "kind": "categoria", "options": ["A", "B"]}, headers=PESQ)
    lote = r.json()["variables"][-1]
    s = _samples(client, pid)
    client.put(f"projects/{pid}/variables/values", json={"values": [{"sample_id": s["HP300NB"]["id"], "key": lote["key"], "value": "B"}]}, headers=PESQ)
    r = client.post(f"projects/{pid}/samples/merge", json={"target_id": s["HP300NA"]["id"], "source_ids": [s["HP300NB"]["id"]]}, headers=PESQ)
    assert r.status_code == 200, r.text
    assert _samples(client, pid)["HP300NA"]["variables"][lote["key"]] == "B"
    assert client.delete(f"projects/{pid}/samples/{s['HP300NA']['id']}", headers=PESQ).status_code == 204
    assert _vars(client, pid)["variables"][-1]["n_values"] == 0
