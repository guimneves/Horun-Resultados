"""Massas por réplica (gás gerado, óleo, betume) e média por amostra —
pedido do mantenedor de 08/10/2026. Dados sintéticos."""

from __future__ import annotations

import pytest

from app.services.masses import stats
from tests import synthetic as syn
from tests.conftest import COORD, IC, PESQ, TEC, add_members, confirm, person, upload


def test_stats_ignore_zero_and_empty():
    s = stats([1.0, 0, None, 3.0, 0.0])
    assert s["n"] == 2 and s["mean"] == pytest.approx(2.0) and s["sd"] == pytest.approx(1.4142135, rel=1e-6)
    assert stats([0, None]) == {"mean": None, "sd": None, "n": 0}
    one = stats([5.0, 0])
    assert one["n"] == 1 and one["mean"] == 5.0 and one["sd"] is None


def _import_gas(client, pid, code, gas_mass):
    confirm(client, pid, upload(client, pid, {f"{code} - Planilha cálculo gás.xlsx": syn.gas_xlsx(code, gas_mass=gas_mass)}))


def _exps(client, pid, who=PESQ):
    return {e["code"]: e for e in client.get(f"projects/{pid}/experiments", headers=who).json()}


def test_manual_gas_overrides_sheet_and_survives_reimport(client, project):
    pid = project["id"]
    _import_gas(client, pid, "HP300NA", 1.5)
    exp = _exps(client, pid)["HP300NA"]
    assert exp["gas_mass_effective_g"] == 1.5 and exp["gas_mass_source"] == "planilha" and exp["gas_mass_manual_g"] is None

    r = client.patch(f"projects/{pid}/experiments/{exp['id']}", json={"gas_mass_g": 1.8, "oil_mass_g": 4.2}, headers=PESQ)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["gas_mass_effective_g"] == 1.8 and out["gas_mass_source"] == "editado" and out["gas_mass_sheet_g"] == 1.5
    assert out["oil_mass_g"] == 4.2

    # reimportar a planilha (outro arquivo, outro valor) não apaga o valor digitado
    _import_gas(client, pid, "HP300NA", 2.5)
    exp = _exps(client, pid)["HP300NA"]
    assert exp["gas_mass_effective_g"] == 1.8 and exp["gas_mass_source"] == "editado" and exp["gas_mass_sheet_g"] == 2.5

    # limpar → volta ao valor da planilha
    out = client.patch(f"projects/{pid}/experiments/{exp['id']}", json={"gas_mass_g": None}, headers=PESQ).json()
    assert out["gas_mass_effective_g"] == 2.5 and out["gas_mass_source"] == "planilha" and out["oil_mass_g"] == 4.2

    events = [e for e in client.get(f"projects/{pid}/history", headers=COORD).json() if e["action"] == "massas_editadas"]
    assert len(events) == 2 and "massa de gás gerada" in events[-1]["summary"] + events[0]["summary"]


def test_mass_validation(client, project):
    pid = project["id"]
    exp = client.post(f"projects/{pid}/experiments", json={"code": "HP300NA"}, headers=PESQ).json()
    for bad in (-1, 1e9):
        r = client.patch(f"projects/{pid}/experiments/{exp['id']}", json={"oil_mass_g": bad}, headers=PESQ)
        assert r.status_code == 422


@pytest.mark.parametrize("who", [TEC, IC], ids=["tecnico", "ic"])
def test_only_editors_change_masses(client, project, who):
    pid = project["id"]
    exp = client.post(f"projects/{pid}/experiments", json={"code": "HP300NA"}, headers=PESQ).json()
    url = f"projects/{pid}/experiments/{exp['id']}"
    assert client.patch(url, json={"bitumen_mass_g": 1.0}, headers=who).status_code == 403
    assert client.patch(url, json={"bitumen_mass_g": 1.0}, headers=PESQ).status_code == 200
    assert client.patch(url, json={"bitumen_mass_g": 2.0}, headers=COORD).status_code == 200
    masses = client.get(f"projects/{pid}/experiments/masses", headers=who)
    assert masses.status_code == 200
    assert masses.json()["groups"][0]["replicates"][0]["bitumen_mass_g"] == 2.0


def test_masses_grouped_by_sample_with_mean(client, project):
    pid = project["id"]
    _import_gas(client, pid, "HP300NA", 1.0)
    _import_gas(client, pid, "HP300NB", 3.0)
    ids = {}
    for code in ("HP300NC", "HP320NA"):
        ids[code] = client.post(f"projects/{pid}/experiments", json={"code": code}, headers=PESQ).json()["id"]
    exps = _exps(client, pid)
    client.patch(f"projects/{pid}/experiments/{exps['HP300NA']['id']}", json={"oil_mass_g": 2.0}, headers=PESQ)
    client.patch(f"projects/{pid}/experiments/{exps['HP300NB']['id']}", json={"oil_mass_g": 0}, headers=PESQ)
    client.patch(f"projects/{pid}/experiments/{ids['HP300NC']}", json={"oil_mass_g": 4.0, "gas_mass_g": 0}, headers=PESQ)

    data = client.get(f"projects/{pid}/experiments/masses", headers=PESQ).json()
    groups = {g["label"]: g for g in data["groups"]}
    assert set(groups) == {"HP300N", "HP320N"}
    g = groups["HP300N"]
    assert [r["code"] for r in g["replicates"]] == ["HP300NA", "HP300NB", "HP300NC"]
    assert g["temperature_c"] == 300 and g["atmosphere"] == "nitrogênio"
    # gás: 1 e 3 da planilha; o 0 digitado em HP300NC fica de fora
    assert g["stats"]["gas_mass_g"]["n"] == 2 and g["stats"]["gas_mass_g"]["mean"] == pytest.approx(2.0)
    # óleo: 2 e 4 (o 0 de HP300NB não conta)
    assert g["stats"]["oil_mass_g"]["n"] == 2 and g["stats"]["oil_mass_g"]["mean"] == pytest.approx(3.0)
    assert g["stats"]["bitumen_mass_g"]["n"] == 0
    assert groups["HP320N"]["stats"]["gas_mass_g"]["n"] == 0


def test_masses_respect_project_membership(client, project):
    pid = project["id"]
    outsider = person("9", 3)
    assert client.get(f"projects/{pid}/experiments/masses", headers=outsider).status_code == 404
    exp = client.post(f"projects/{pid}/experiments", json={"code": "HP300NA"}, headers=PESQ).json()
    assert client.patch(f"projects/{pid}/experiments/{exp['id']}", json={"oil_mass_g": 1.0}, headers=outsider).status_code == 404
    add_members(client, pid, outsider)
    assert client.get(f"projects/{pid}/experiments/masses", headers=outsider).status_code == 200
    assert client.get(f"projects/{pid}/experiments/masses", headers=COORD).status_code == 200
