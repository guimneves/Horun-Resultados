"""Pessoas do projeto (pedido do mantenedor, 08/10/2026) — ESPECIFICACAO.md, seção 7.

* Níveis 1–2 veem todos os projetos e adicionam/removem pesquisadores,
  técnicos e ICs.
* Pesquisador(a) (nível 3), dentro de um projeto em que é membro, adiciona e
  remove técnicos e ICs (não outros pesquisadores nem coordenadores).
* Técnicos e ICs veem a lista (só leitura).
A lista de pessoas para escolher: quem já abriu o módulo (app/services/directory.py).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api.deps import get_project
from app.core.identity import LEVEL_NAMES, HorunIdentity, get_identity
from app.core.permissions import member_levels_manageable
from app.db.models import Project, ProjectMember
from app.db.session import get_session
from app.services import audit, directory

router = APIRouter(tags=["pessoas do projeto"])

LEVEL_LABELS = {1: "administrador máximo", 2: "coordenador(a)", 3: "pesquisador(a)", 4: "técnico(a)", 5: "IC"}


class MemberIn(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)


def _member_out(m: ProjectMember, identity: HorunIdentity, current_level: int | None) -> dict:
    level = current_level if current_level is not None else m.level_at_add
    return {
        **m.model_dump(),
        "level": level,
        "level_name": LEVEL_NAMES.get(level or 0, ""),
        "can_remove": (level or 0) in member_levels_manageable(identity),
    }


def _require_manager(identity: HorunIdentity) -> tuple[int, ...]:
    levels = member_levels_manageable(identity)
    if not levels:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Técnicos e ICs não alteram as pessoas do projeto.")
    return levels


@router.get("/projects/{project_id}/members")
def list_members(project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(get_identity)):
    rows = session.exec(select(ProjectMember).where(ProjectMember.project_id == project.id)).all()
    live = {p.user_id: p.level for p in directory.list_people(session)}
    out = [_member_out(m, identity, live.get(m.user_id)) for m in rows]
    return sorted(out, key=lambda m: ((m["level"] or 9), (m["display_name"] or m["username"]).lower()))


@router.get("/projects/{project_id}/members/candidates")
def candidates(project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(get_identity)):
    """Pessoas do Horun que esta pessoa pode adicionar (pelo cargo) e que ainda não estão no projeto."""
    levels = _require_manager(identity)
    taken = set(session.exec(select(ProjectMember.user_id).where(ProjectMember.project_id == project.id)))
    people = [p for p in directory.list_people(session) if p.level in levels and p.user_id not in taken and p.user_id != str(identity.user_id)]
    return [p.as_dict() for p in sorted(people, key=lambda p: (p.level, p.label.lower()))]


@router.post("/projects/{project_id}/members", status_code=201)
def add_member(
    body: MemberIn, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(get_identity)
):
    levels = _require_manager(identity)
    person = directory.find(session, body.user_id.strip())
    if person is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pessoa não encontrada — ela precisa ter aberto o Resultados pelo Horun ao menos uma vez.")
    if person.level not in levels:
        allowed = ", ".join(LEVEL_LABELS[lvl] for lvl in levels)
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Você só pode adicionar: {allowed}.")
    if session.exec(select(ProjectMember).where(ProjectMember.project_id == project.id, ProjectMember.user_id == person.user_id)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Essa pessoa já está no projeto.")
    member = ProjectMember(
        project_id=project.id,  # type: ignore[arg-type]
        user_id=person.user_id,
        username=person.username,
        display_name=person.display_name,
        level_at_add=person.level,
        added_by=identity.username,
    )
    session.add(member)
    audit.record(
        session,
        identity,
        "membro_adicionado",
        f"Adicionou {person.label} ({LEVEL_LABELS.get(person.level, '')}) ao projeto.",
        project_id=project.id,
        entity="membro",
        details={"user_id": person.user_id, "username": person.username, "level": person.level},
    )
    session.commit()
    session.refresh(member)
    return _member_out(member, identity, person.level)


@router.delete("/projects/{project_id}/members/{member_id}", status_code=204)
def remove_member(
    member_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(get_identity)
):
    levels = _require_manager(identity)
    member = session.get(ProjectMember, member_id)
    if member is None or member.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pessoa não está no projeto.")
    current = directory.find(session, member.user_id)
    level = current.level if current is not None else member.level_at_add
    if level not in levels:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Pesquisadores só removem técnicos e ICs.")
    label = member.display_name or member.username
    session.delete(member)
    audit.record(
        session,
        identity,
        "membro_removido",
        f"Removeu {label} do projeto.",
        project_id=project.id,
        entity="membro",
        details={"user_id": member.user_id, "username": member.username, "level": level},
    )
    session.commit()
    return Response(status_code=204)
