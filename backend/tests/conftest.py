"""Os testes rodam como o módulo atrás do Core (HORUN_DEV_MODE=false),
simulando pessoas pelos cabeçalhos X-Horun-*; banco e uploads em pastas
temporárias (nunca dentro do repositório)."""

from __future__ import annotations

import os
import tempfile

os.environ["HORUN_DEV_MODE"] = "false"
_db_fd, _db_path = tempfile.mkstemp(suffix=".db", prefix="resultados-test-")
os.close(_db_fd)
os.environ["MODULE_DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ["MODULE_UPLOAD_ROOT"] = tempfile.mkdtemp(prefix="resultados-uploads-")
os.environ.pop("HORUN_CORE_URL", None)
os.environ.pop("HORUN_NOTIFY_TOKEN", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app.core import notify as notify_module  # noqa: E402
from app.db.session import create_db_and_tables, engine  # noqa: E402
from app.main import app  # noqa: E402


def person(user_id: str, level: int | None, role: str | None = None) -> dict:
    role = role or ("admin" if level in (1, 2) else "user")
    headers = {"X-Horun-User-Id": user_id, "X-Horun-User": f"pessoa{user_id}", "X-Horun-Role": role}
    if level is not None:
        headers["X-Horun-Level"] = str(level)
    return headers


ADMIN = person("1", 1)
COORD = person("2", 2)
PESQ = person("3", 3)
IC = person("5", 5)


@pytest.fixture(autouse=True)
def _fresh_db():
    SQLModel.metadata.drop_all(engine)
    create_db_and_tables()
    yield


@pytest.fixture
def client():
    # base_url com /api/: os testes escrevem "projects/..." (relativo)
    return TestClient(app, base_url="http://testserver/api/")


@pytest.fixture
def sent(monkeypatch):
    calls: list[dict] = []

    def fake_notify(subject, text="", link="", user_ids=(), levels=(), email=True):
        calls.append({"subject": subject, "text": text, "link": link, "levels": list(levels), "email": email})

    monkeypatch.setattr(notify_module, "notify", fake_notify)
    return calls


@pytest.fixture
def project(client):
    r = client.post("projects", json={"name": "Projeto Teste", "description": "sintético"}, headers=COORD)
    assert r.status_code == 201, r.text
    return r.json()


def upload(client, project_id: int, files: dict[str, bytes], headers=None):
    payload = [("files", (name, content, "application/octet-stream")) for name, content in files.items()]
    r = client.post(f"projects/{project_id}/imports/preview", files=payload, headers=headers or PESQ)
    assert r.status_code == 200, r.text
    return r.json()


def confirm(client, project_id: int, preview: dict, decisions=None, headers=None):
    r = client.post(
        f"projects/{project_id}/imports/{preview['batch_id']}/confirm", json={"decisions": decisions or []}, headers=headers or PESQ
    )
    assert r.status_code == 200, r.text
    return r.json()
