from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlmodel import Session

from app.db.models import Project
from app.db.session import get_session


def get_project(project_id: int, session: Session = Depends(get_session)) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projeto não encontrado.")
    return project


def ensure_open(project: Project) -> None:
    """Projeto arquivado é só leitura."""
    if project.archived_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Projeto arquivado — desarquive para alterar.")
