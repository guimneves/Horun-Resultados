"""Lista de pessoas de "Pessoas do projeto" (app/services/directory.py): vem do
Horun Core (GET /internal/modules/resultados/users) com cache curto; sem o
Core (não configurado ou fora do ar), quem já abriu o módulo (`KnownUser`)."""

from __future__ import annotations

import io
import json
import urllib.error

import pytest

from app.services import directory
from tests.conftest import COORD, PESQ, TEC, person

# Só nomes genéricos — nenhuma pessoa real.
CORE_USERS = [
    {"id": 1, "username": "admin", "display_name": "Admin Teste", "level": 1, "level_name": "admin", "level_label": "Administrador máximo"},
    {"id": 2, "username": "coord", "display_name": "Coordenação Teste", "level": 2, "level_name": "coordenador", "level_label": "Coordenador(a)"},
    {"id": 3, "username": "pesq", "display_name": "Pesquisa Teste", "level": 3, "level_name": "pesquisador", "level_label": "Pesquisador(a)"},
    {"id": 21, "username": "pesq.b", "display_name": "Pesquisadora B", "level": 3, "level_name": "pesquisador", "level_label": "Pesquisador(a)"},
    {"id": 22, "username": "tec.c", "display_name": "Técnico C", "level": 4, "level_name": "tecnico", "level_label": "Técnico(a)"},
    {"id": 23, "username": "ic.d", "display_name": "IC D", "level": 5, "level_name": "ic", "level_label": "Iniciação Científica"},
]


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def core(monkeypatch):
    """Core configurado e respondendo CORE_USERS; guarda os pedidos feitos."""
    monkeypatch.setenv("HORUN_CORE_URL", "http://core.test:8000/")
    monkeypatch.setenv("HORUN_NOTIFY_TOKEN", "chave-de-teste")
    directory.clear_cache()
    calls: list[dict] = []
    state = {"users": CORE_USERS, "fail": False}

    def fake_urlopen(request, timeout=None):
        calls.append({"url": request.full_url, "auth": request.get_header("Authorization"), "timeout": timeout})
        if state["fail"]:
            raise urllib.error.URLError("Core fora do ar")
        return _Response(json.dumps(state["users"]).encode())

    monkeypatch.setattr(directory.urllib.request, "urlopen", fake_urlopen)
    yield {"calls": calls, "state": state}
    directory.clear_cache()


def _candidates(client, pid, who):
    r = client.get(f"projects/{pid}/members/candidates", headers=who)
    assert r.status_code == 200, r.text
    return {p["user_id"]: p for p in r.json()}


def _project(client):
    r = client.post("projects", json={"name": "Diretório"}, headers=COORD)
    assert r.status_code == 201
    return r.json()["id"]


def test_people_come_from_the_core_without_opening_the_module(client, core):
    pid = _project(client)
    choices = _candidates(client, pid, COORD)
    # ninguém abriu o módulo, mas a lista do Core já traz todos; coordenador escolhe níveis 3–5
    assert {k: v["level"] for k, v in choices.items()} == {"3": 3, "21": 3, "22": 4, "23": 5}
    assert choices["22"] == {"user_id": "22", "username": "tec.c", "display_name": "Técnico C", "level": 4}
    call = core["calls"][0]
    assert call["url"] == "http://core.test:8000/internal/modules/resultados/users"
    assert call["auth"] == "Bearer chave-de-teste"
    assert call["timeout"] == directory.CORE_TIMEOUT_SECONDS


def test_pesquisador_picks_only_tecnicos_and_ics(client, core):
    pid = _project(client)
    assert client.post(f"projects/{pid}/members", json={"user_id": "3"}, headers=COORD).status_code == 201
    assert set(_candidates(client, pid, PESQ)) == {"22", "23"}
    # e só consegue adicionar esses níveis
    assert client.post(f"projects/{pid}/members", json={"user_id": "21"}, headers=PESQ).status_code == 403
    r = client.post(f"projects/{pid}/members", json={"user_id": "22"}, headers=PESQ)
    assert r.status_code == 201, r.text
    assert r.json()["display_name"] == "Técnico C"


def test_core_list_is_cached(client, core):
    pid = _project(client)
    _candidates(client, pid, COORD)
    _candidates(client, pid, COORD)
    client.get(f"projects/{pid}/members", headers=COORD)
    assert len(core["calls"]) == 1
    directory.clear_cache()
    _candidates(client, pid, COORD)
    assert len(core["calls"]) == 2


def test_person_without_access_in_the_core_is_not_offered(client, core):
    pid = _project(client)
    client.get("me", headers=person("99", 4))  # abriu o módulo, mas o Core não o lista (perdeu o acesso)
    assert "99" not in _candidates(client, pid, COORD)
    assert client.post(f"projects/{pid}/members", json={"user_id": "99"}, headers=COORD).status_code == 404


def test_falls_back_to_known_users_when_core_is_down(client, core):
    core["state"]["fail"] = True
    pid = _project(client)
    assert _candidates(client, pid, COORD) == {}  # ninguém abriu ainda
    client.get("me", headers=TEC)
    assert set(_candidates(client, pid, COORD)) == {"4"}
    # a falha fica guardada pouco tempo (não repete o timeout a cada pedido)
    assert len(core["calls"]) == 1


def test_bad_core_response_falls_back(client, core):
    core["state"]["users"] = {"detail": "Chave de notificação inválida."}
    pid = _project(client)
    client.get("me", headers=TEC)
    assert set(_candidates(client, pid, COORD)) == {"4"}


def test_not_configured_uses_known_users_and_never_calls(client, monkeypatch):
    monkeypatch.delenv("HORUN_CORE_URL", raising=False)
    monkeypatch.delenv("HORUN_NOTIFY_TOKEN", raising=False)
    directory.clear_cache()
    monkeypatch.setattr(directory.urllib.request, "urlopen", lambda *a, **k: pytest.fail("não devia chamar o Core"))
    pid = _project(client)
    client.get("me", headers=TEC)
    assert set(_candidates(client, pid, COORD)) == {"4"}


def test_dev_mode_keeps_fake_directory(core, monkeypatch):
    from app.core import identity as identity_module
    from sqlmodel import Session

    from app.db.session import engine

    monkeypatch.setattr(identity_module, "DEV_MODE", True)
    with Session(engine) as session:
        ids = {p.user_id for p in directory.list_people(session)}
    assert {"3", "22", "dev-nivel-3", "dev-tec-2"} <= ids
    core["state"]["fail"] = True
    directory.clear_cache()
    with Session(engine) as session:
        ids = {p.user_id for p in directory.list_people(session)}
    assert "dev-nivel-3" in ids and "22" not in ids
