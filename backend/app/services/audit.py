"""Histórico (quem fez o quê, quando) — ESPECIFICACAO.md, seção 5, item 4."""

from __future__ import annotations

import json

from sqlmodel import Session

from app.core.identity import HorunIdentity
from app.db.models import AuditEvent


def record(
    session: Session,
    identity: HorunIdentity,
    action: str,
    summary: str,
    project_id: int | None = None,
    entity: str = "",
    entity_id: int | None = None,
    details: dict | None = None,
) -> None:
    session.add(
        AuditEvent(
            project_id=project_id,
            user_id=identity.user_id,
            username=identity.username,
            action=action,
            entity=entity,
            entity_id=entity_id,
            summary=summary,
            details_json=json.dumps(details or {}, ensure_ascii=False, default=str),
        )
    )
