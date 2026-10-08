"""Lista de pessoas do Horun para "Pessoas do projeto".

O Horun Core não tem uma rota que liste os usuários para os módulos (só a de
avisos, /internal/modules/{id}/notify). Mesmo mecanismo do Financeiro
(`KnownUser`): o módulo anota quem já o abriu — id do Core, usuário e o cargo
(X-Horun-Level) da última visita — a cada `GET /api/me`, que o frontend chama
ao abrir. Quem nunca abriu o Resultados ainda não aparece na lista.

O cargo anotado serve só para filtrar quem cada um pode escolher; a regra de
acesso usa sempre o cargo do cabeçalho da requisição.

No desenvolvimento (HORUN_DEV_MODE=true) entra também um diretório de faz de
conta com as pessoas do seletor "Ver como" (dev-nivel-3, -4, -5) e alguns
nomes genéricos, para testar sem o Core.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session, select

from app.core import identity as identity_module
from app.core.identity import HorunIdentity
from app.db.models import KnownUser, utcnow


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


def list_people(session: Session) -> list[Person]:
    people: dict[str, Person] = {}
    if identity_module.DEV_MODE:
        people.update({p.user_id: p for p in DEV_PEOPLE})
    for row in session.exec(select(KnownUser)):
        known = people.get(row.user_id)
        people[row.user_id] = Person(row.user_id, row.username, known.display_name if known else "", row.level)
    return list(people.values())


def find(session: Session, user_id: str) -> Person | None:
    return next((p for p in list_people(session) if p.user_id == user_id), None)
