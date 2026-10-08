"""Perfil do projeto (tipo de amostra, análises, parâmetros) — fundação sem
tela (docs/PERFIS_DE_PROJETO.md)."""

from __future__ import annotations

import json

import pytest
from sqlmodel import Session

from app.db.models import Project
from app.db.session import engine
from app.services import profiles
from tests.conftest import COORD, PESQ


def test_project_without_profile_gets_the_default(client):
    p = client.post("projects", json={"name": "Sem perfil"}, headers=COORD).json()
    prof = p["profile"]
    assert prof["sample_type"] == "rocha_hidropirolise"
    assert prof["recipes"] == list(profiles.RECIPES)  # todas as análises de hoje
    assert prof["parameters"]["rockeval"] == ["TOC", "Tmax", "S1", "S2", "HI", "OI"]  # os "main" do catálogo
    assert "profile_json" not in p


def test_create_and_patch_with_profile(client):
    body = {"name": "Só LECO e Rock-Eval", "profile": {"recipes": ["leco", "rockeval"], "parameters": {"rockeval": ["TOC", "HI"]}}}
    p = client.post("projects", json=body, headers=COORD).json()
    assert p["profile"]["recipes"] == ["leco", "rockeval"]
    assert p["profile"]["parameters"] == {"leco": ["C", "S"], "rockeval": ["TOC", "HI"]}
    with Session(engine) as s:
        stored = json.loads(s.get(Project, p["id"]).profile_json)
    assert stored["recipes"] == ["leco", "rockeval"] and stored["version"] == 1

    r = client.patch(f"projects/{p['id']}", json={"profile": {"recipes": ["chnso"]}}, headers=COORD)
    assert r.status_code == 200
    assert r.json()["profile"]["recipes"] == ["chnso"]
    # mexer só no nome não apaga o perfil
    r = client.patch(f"projects/{p['id']}", json={"name": "Renomeado"}, headers=COORD)
    assert r.json()["profile"]["recipes"] == ["chnso"]


@pytest.mark.parametrize(
    "profile, message",
    [
        ({"sample_type": "marte"}, "Tipo de amostra desconhecido"),
        ({"sample_type": "tabaco"}, "ainda não está pronto"),
        ({"recipes": ["icp"]}, "Análise desconhecida"),
        ({"recipes": ["leco"], "parameters": {"rockeval": ["TOC"]}}, "fora do perfil"),
        ({"parameters": {"leco": ["XYZ"]}}, "Parâmetro desconhecido"),
    ],
)
def test_invalid_profiles_are_refused(client, profile, message):
    r = client.post("projects", json={"name": "Inválido", "profile": profile}, headers=COORD)
    assert r.status_code == 422
    assert message in r.json()["detail"]


def test_unreadable_stored_profile_falls_back_to_default():
    assert profiles.load("{não é json").sample_type == "rocha_hidropirolise"
    assert profiles.load("").resolved()["recipes"] == list(profiles.RECIPES)


def test_profile_options_lists_types_and_recipes(client):
    data = client.get("profiles", headers=PESQ).json()
    types = {t["key"]: t["status"] for t in data["sample_types"]}
    assert types == {"rocha_hidropirolise": "pronto", "tabaco": "planejado", "incrustacao": "planejado"}
    leco = next(r for r in data["recipes"] if r["key"] == "leco")
    assert leco["instrument"] == "LECO SC832" and leco["status"] == "pronto"
