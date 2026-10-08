"""Lista de pessoas do Horun para "Pessoas do projeto".

Fonte principal: o Horun Core, `GET /internal/modules/resultados/users`
(Prompt_Horun_Modulo.md, seção 11) — quem pode entrar no Resultados agora,
com id do Core, usuário, nome e nível. Usa as mesmas variáveis dos avisos
(`HORUN_CORE_URL` + `HORUN_NOTIFY_TOKEN`, app/core/notify.py), com timeout
curto e um cache em memória de ~60 s (falha fica guardada só ~15 s).

Plano B, se o Core não estiver configurado ou não responder: o mesmo
mecanismo do Financeiro (`KnownUser`) — o módulo anota quem já o abriu (id do
Core, usuário e o cargo X-Horun-Level da última visita) a cada `GET /api/me`,
que o frontend chama ao abrir. Nesse caso, quem nunca abriu o Resultados
ainda não aparece na lista. A anotação continua sempre, para o plano B estar
pronto quando precisar.

O cargo da lista serve só para filtrar quem cada um pode escolher; a regra de
acesso usa sempre o cargo do cabeçalho da requisição.

No desenvolvimento (HORUN_DEV_MODE=true) entra também um diretório de faz de
conta com as pessoas do seletor "Ver como" (dev-nivel-3, -4, -5) e alguns
nomes genéricos, para testar sem o Core.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from dataclasses import dataclass

from sqlmodel import Session, select

from app.core import identity as identity_module
from app.core import notify as notify_module
from app.core.identity import HorunIdentity
from app.db.models import KnownUser, utcnow


logger = logging.getLogger(__name__)

CORE_TIMEOUT_SECONDS = 3
CACHE_SECONDS = 60
FAILURE_CACHE_SECONDS = 15


@dataclass(frozen=True)
class Person:
    user_id: str
    username: str
    display_name: str
    level: int

    @property
    def label(self) -> str:
        return self.display_name or self.username

    def as_dict(self) -> dict:
        return {"user_id": self.user_id, "username": self.username, "display_name": self.display_name, "level": self.level}


# Só no desenvolvimento — nomes genéricos, nenhuma pessoa real.
DEV_PEOPLE = (
    Person("dev-nivel-2", "dev-nivel-2", "Coordenador(a) de teste", 2),
    Person("dev-nivel-3", "dev-nivel-3", "Pesquisador(a) de teste", 3),
    Person("dev-nivel-4", "dev-nivel-4", "Técnico(a) de teste", 4),
    Person("dev-nivel-5", "dev-nivel-5", "IC de teste", 5),
    Person("dev-pesq-2", "pesquisadora.b", "Pesquisadora B", 3),
    Person("dev-tec-2", "tecnico.c", "Técnico C", 4),
    Person("dev-ic-2", "ic.d", "IC D", 5),
)


def remember(session: Session, identity: HorunIdentity) -> None:
    """Anota (ou atualiza) quem chegou. O "dev" fixo do desenvolvimento fica de fora."""
    if identity_module.DEV_MODE and identity.user_id == "dev":
        return
    row = session.get(KnownUser, str(identity.user_id))
    if row is None:
        row = KnownUser(user_id=str(identity.user_id))
    row.username = identity.username
    row.level = identity.level
    row.last_seen_at = utcnow()
    session.add(row)
    session.commit()


# (url, chave) -> (validade, pessoas ou None = o Core falhou)
_cache: dict[tuple[str, str], tuple[float, list[Person] | None]] = {}
_cache_lock = threading.Lock()


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _fetch_core(url: str, token: str) -> list[Person]:
    request = urllib.request.Request(
        f"{url}/internal/modules/{notify_module.MODULE_ID}/users",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=CORE_TIMEOUT_SECONDS) as response:  # noqa: S310 (URL do admin)
        data = json.loads(response.read().decode("utf-8"))
    people: list[Person] = []
    for item in data:
        level = int(item["level"])
        if not 1 <= level <= 5:
            continue
        username = str(item.get("username") or "")
        people.append(Person(str(item["id"]), username, str(item.get("display_name") or ""), level))
    return people


def core_people() -> list[Person] | None:
    """Pessoas com acesso ao Resultados, segundo o Core; None se o Core não
    está configurado ou não respondeu (aí vale o plano B, `KnownUser`)."""
    config = notify_module._config()
    if config is None:
        return None
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(config)
        if hit is not None and hit[0] > now:
            return hit[1]
    try:
        people: list[Person] | None = _fetch_core(*config)
        ttl = CACHE_SECONDS
    except Exception:  # noqa: BLE001 — Core fora do ar, chave errada, resposta estranha: plano B
        logger.warning("Lista de pessoas do Horun Core indisponível; usando quem já abriu o Resultados.", exc_info=True)
        people, ttl = None, FAILURE_CACHE_SECONDS
    with _cache_lock:
        _cache[config] = (now + ttl, people)
    return people


def _known_people(session: Session) -> list[Person]:
    people: dict[str, Person] = {}
    if identity_module.DEV_MODE:
        people.update({p.user_id: p for p in DEV_PEOPLE})
    for row in session.exec(select(KnownUser)):
        known = people.get(row.user_id)
        people[row.user_id] = Person(row.user_id, row.username, known.display_name if known else "", row.level)
    return list(people.values())


def list_people(session: Session) -> list[Person]:
    from_core = core_people()
    if from_core is None:
        return _known_people(session)
    if identity_module.DEV_MODE:
        ids = {p.user_id for p in from_core}
        return from_core + [p for p in DEV_PEOPLE if p.user_id not in ids]
    return list(from_core)


def find(session: Session, user_id: str) -> Person | None:
    return next((p for p in list_people(session) if p.user_id == user_id), None)
