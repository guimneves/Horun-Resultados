from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select

from app.core.identity import HorunIdentity, get_identity
from app.core.permissions import sees_all_projects
from app.db.models import Project, ProjectMember
from app.db.session import get_session


def is_member(session: Session, project_id: int, identity: HorunIdentity) -> bool:
    row = session.exec(select(ProjectMember.id).where(ProjectMember.project_id == project_id, ProjectMember.user_id == str(identity.user_id))).first()
    return row is not None


def can_open(session: Session, project: Project, identity: HorunIdentity) -> bool:
    """Níveis 1–2 abrem todos; níveis 3–5 só os projetos em que são membros."""
    return sees_all_projects(identity) or is_member(session, project.id, identity)  # type: ignore[arg-type]


def get_project(project_id: int, session: Session = Depends(get_session), identity: HorunIdentity = Depends(get_identity)) -> Project:
    """Toda rota /projects/{id}/... passa por aqui: quem não é membro recebe 404
    (o projeto nem aparece para essa pessoa)."""
    project = session.get(Project, project_id)
    if project is None or not can_open(session, project, identity):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projeto não encontrado.")
    return project


def ensure_open(project: Project) -> None:
    """Projeto arquivado é só leitura."""
    if project.archived_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Projeto arquivado — desarquive para alterar.")
