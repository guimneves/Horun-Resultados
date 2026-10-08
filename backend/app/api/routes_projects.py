"""Projetos (sem código nem vigência — pedido do mantenedor), quem sou eu,
catálogo, frações, histórico e arquivos."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete
from sqlmodel import Session, func, select

from app.api.deps import get_project
from app.core import identity as identity_module
from app.core.identity import HorunIdentity, get_identity
from app.core.permissions import COORDENADOR, core_role, require_coordenador, require_history_access, require_super_admin
from app.db.models import (
    Analysis,
    AnalysisValue,
    AuditEvent,
    Experiment,
    FractionType,
    ImportBatch,
    Project,
    Sample,
    SampleAlias,
    StoredFile,
    utcnow,
)
from app.db.session import get_session
from app.services import audit, profiles, storage
from app.services.catalog import catalog_json

router = APIRouter(tags=["projetos"])


@router.get("/me")
def me(identity: HorunIdentity = Depends(get_identity)):
    role = core_role(identity)
    return {
        "user_id": identity.user_id,
        "username": identity.username,
        "level": identity.level,
        "level_name": identity.level_name,
        "role": role,
        "is_coordenador": role == COORDENADOR,
        "can_delete_projects": identity.level == 1,
        "can_see_history": identity.level == 1,
        "dev_mode": identity_module.DEV_MODE,
    }


@router.get("/profiles")
def profile_options(_identity: HorunIdentity = Depends(get_identity)):
    """Tipos de amostra e análises disponíveis para o perfil do projeto (sem tela ainda)."""
    return profiles.options_json()


@router.get("/catalog")
def catalog(_identity: HorunIdentity = Depends(get_identity)):
    return catalog_json()


# ---------------------------------------------------------------- frações


class FractionPatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=400)
    in_series: bool | None = None
    series_group: str | None = Field(default=None, max_length=10)


@router.get("/fractions")
def list_fractions(session: Session = Depends(get_session), _identity: HorunIdentity = Depends(get_identity)):
    return sorted(session.exec(select(FractionType)).all(), key=lambda f: f.sort)


@router.patch("/fractions/{code}")
def patch_fraction(
    code: str,
    body: FractionPatch,
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_coordenador),
):
    fraction = session.exec(select(FractionType).where(FractionType.code == code)).first()
    if fraction is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Fração não encontrada.")
    changes = body.model_dump(exclude_unset=True)
    if "series_group" in changes and changes["series_group"]:
        if session.exec(select(FractionType).where(FractionType.code == changes["series_group"])).first() is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Linha da série: fração inexistente.")
    for k, v in changes.items():
        setattr(fraction, k, v)
    session.add(fraction)
    audit.record(session, identity, "fracao", f"Editou a fração {code}.", details=changes)
    session.commit()
    session.refresh(fraction)
    return fraction


# ---------------------------------------------------------------- projetos


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    color: str = Field(default="#15216f", pattern=r"^#[0-9a-fA-F]{6}$")
    # Perfil (tipo de amostra, análises, parâmetros) — ainda sem tela;
    # ausente = perfil padrão. Ver app/services/profiles.py.
    profile: dict | None = None


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    profile: dict | None = None


class DeleteConfirm(BaseModel):
    confirm_name: str


def _checked_profile(data: dict | None) -> profiles.ProjectProfile:
    try:
        return profiles.validate(data)
    except profiles.ProfileError as err:
        raise HTTPException(422, str(err)) from err


def _project_out(session: Session, project: Project) -> dict:
    samples = session.exec(select(func.count()).select_from(Sample).where(Sample.project_id == project.id)).one()
    analyses = session.exec(select(func.count()).select_from(Analysis).where(Analysis.project_id == project.id)).one()
    experiments = session.exec(select(func.count()).select_from(Experiment).where(Experiment.project_id == project.id)).one()
    return {
        **project.model_dump(exclude={"profile_json"}),
        "profile": profiles.load(project.profile_json).resolved(),
        "counts": {"samples": samples, "analyses": analyses, "experiments": experiments},
    }


@router.get("/projects")
def list_projects(
    include_archived: bool = False,
    session: Session = Depends(get_session),
    _identity: HorunIdentity = Depends(get_identity),
):
    projects = session.exec(select(Project).order_by(Project.name)).all()
    return [_project_out(session, p) for p in projects if include_archived or p.archived_at is None]


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_coordenador)):
    name = body.name.strip()
    if session.exec(select(Project).where(Project.name == name)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um projeto com esse nome.")
    profile = _checked_profile(body.profile)
    project = Project(
        name=name, description=body.description.strip(), color=body.color, created_by=identity.username, profile_json=profiles.dump(profile)
    )
    session.add(project)
    session.flush()
    audit.record(session, identity, "projeto_criado", f"Criou o projeto \"{name}\".", project_id=project.id)
    session.commit()
    session.refresh(project)
    return _project_out(session, project)


@router.get("/projects/{project_id}")
def get_one(project: Project = Depends(get_project), session: Session = Depends(get_session), _identity: HorunIdentity = Depends(get_identity)):
    return _project_out(session, project)


@router.patch("/projects/{project_id}")
def patch_project(
    body: ProjectPatch,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_coordenador),
):
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
        other = session.exec(select(Project).where(Project.name == changes["name"], Project.id != project.id)).first()
        if other:
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um projeto com esse nome.")
    if "profile" in changes:
        changes.pop("profile")
        project.profile_json = profiles.dump(_checked_profile(body.profile))
        changes["profile"] = profiles.load(project.profile_json).resolved()
    for k, v in changes.items():
        if k != "profile":
            setattr(project, k, v)
    session.add(project)
    audit.record(session, identity, "projeto_editado", "Editou os dados do projeto.", project_id=project.id, details=changes)
    session.commit()
    session.refresh(project)
    return _project_out(session, project)


@router.post("/projects/{project_id}/archive")
def archive(project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_coordenador)):
    project.archived_at = project.archived_at or utcnow()
    session.add(project)
    audit.record(session, identity, "projeto_arquivado", "Arquivou o projeto.", project_id=project.id)
    session.commit()
    return _project_out(session, project)


@router.post("/projects/{project_id}/unarchive")
def unarchive(project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_coordenador)):
    project.archived_at = None
    session.add(project)
    audit.record(session, identity, "projeto_desarquivado", "Desarquivou o projeto.", project_id=project.id)
    session.commit()
    return _project_out(session, project)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(
    body: DeleteConfirm,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_super_admin),
):
    if body.confirm_name.strip() != project.name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O nome digitado não confere com o nome do projeto.")
    pid = project.id
    analysis_ids = list(session.exec(select(Analysis.id).where(Analysis.project_id == pid)))
    for start in range(0, len(analysis_ids), 500):
        session.exec(sa_delete(AnalysisValue).where(AnalysisValue.analysis_id.in_(analysis_ids[start : start + 500])))  # type: ignore[union-attr]
    session.exec(sa_delete(Analysis).where(Analysis.project_id == pid))  # type: ignore[arg-type]
    session.exec(sa_delete(SampleAlias).where(SampleAlias.project_id == pid))  # type: ignore[arg-type]
    session.exec(sa_delete(Sample).where(Sample.project_id == pid))  # type: ignore[arg-type]
    session.exec(sa_delete(Experiment).where(Experiment.project_id == pid))  # type: ignore[arg-type]
    session.exec(sa_delete(ImportBatch).where(ImportBatch.project_id == pid))  # type: ignore[arg-type]
    digests = list(session.exec(select(StoredFile.sha256).where(StoredFile.project_id == pid)))
    session.exec(sa_delete(StoredFile).where(StoredFile.project_id == pid))  # type: ignore[arg-type]
    name = project.name
    session.delete(project)
    audit.record(session, identity, "projeto_excluido", f"Excluiu o projeto \"{name}\" e todos os seus dados.", project_id=pid)
    session.commit()
    # o original só sai do disco se nenhum outro projeto usa o mesmo arquivo
    for digest in digests:
        if session.exec(select(StoredFile).where(StoredFile.sha256 == digest)).first() is None:
            storage.delete(digest)
    return Response(status_code=204)


# ---------------------------------------------------------------- histórico / arquivos


@router.get("/projects/{project_id}/history")
def history(
    limit: int = 200,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    _identity: HorunIdentity = Depends(require_history_access),
):
    events = session.exec(
        select(AuditEvent).where(AuditEvent.project_id == project.id).order_by(AuditEvent.created_at.desc()).limit(min(limit, 1000))  # type: ignore[union-attr]
    ).all()
    return [{**e.model_dump(exclude={"details_json"}), "details": json.loads(e.details_json or "{}")} for e in events]


@router.get("/projects/{project_id}/files")
def files(project: Project = Depends(get_project), session: Session = Depends(get_session), _identity: HorunIdentity = Depends(get_identity)):
    rows = session.exec(
        select(StoredFile).where(StoredFile.project_id == project.id, StoredFile.status == "imported").order_by(StoredFile.imported_at.desc())  # type: ignore[union-attr]
    ).all()
    return [{**f.model_dump(exclude={"report_json"}), "report": json.loads(f.report_json or "{}")} for f in rows]


@router.get("/projects/{project_id}/files/{file_id}/download")
def download(file_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session), _identity: HorunIdentity = Depends(get_identity)):
    stored = session.get(StoredFile, file_id)
    if stored is None or stored.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arquivo não encontrado.")
    content = storage.read(stored.sha256)
    if content is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "O original não está mais no servidor.")
    safe = stored.filename.replace('"', "")
    return Response(
        content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{_quote(safe)}"},
    )


def _quote(text: str) -> str:
    from urllib.parse import quote

    return quote(text)
