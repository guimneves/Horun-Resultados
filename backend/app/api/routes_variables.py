"""Variáveis de amostra do projeto (app/services/variables.py): listar,
criar, editar, apagar e preencher os valores (em lote). Alterar = níveis 1–3
(`require_editor`), como o resto do módulo."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api.deps import ensure_open, get_project
from app.core.identity import HorunIdentity, get_identity
from app.core.permissions import require_editor
from app.db.models import Project, Sample, SampleVariable
from app.db.session import get_session
from app.services import audit, variables

router = APIRouter(tags=["variaveis"])


class VariableIn(BaseModel):
    label: str = Field(max_length=200)
    kind: str = "numero"
    unit: str = Field(default="", max_length=40)
    options: list[str] = Field(default_factory=list, max_length=200)
    description: str = Field(default="", max_length=1000)


class VariablePatch(BaseModel):
    label: str | None = Field(default=None, max_length=200)
    unit: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=1000)
    options: list[str] | None = Field(default=None, max_length=200)
    renames: dict[str, str] = Field(default_factory=dict)


class ValueIn(BaseModel):
    sample_id: int
    key: str
    value: float | str | None = None


class ValuesIn(BaseModel):
    values: list[ValueIn] = Field(min_length=1, max_length=5000)


def _bad(err: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(err))


def _listing(session: Session, project: Project) -> dict:
    samples = list(session.exec(select(Sample).where(Sample.project_id == project.id)))
    vals = variables.all_values(session, project, samples)
    counts: dict[str, int] = {}
    for per in vals.values():
        for k, v in per.items():
            if v is not None:
                counts[k] = counts.get(k, 0) + 1
    return {
        "variables": [variables.out(session, project, v, counts) for v in variables.list_for(session, project)],
        "values": {str(sid): per for sid, per in vals.items()},
    }


def _get_var(session: Session, project: Project, variable_id: int) -> SampleVariable:
    var = session.get(SampleVariable, variable_id)
    if var is None or var.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Variável não encontrada.")
    return var


@router.get("/projects/{project_id}/variables")
def list_variables(project: Project = Depends(get_project), session: Session = Depends(get_session), _i: HorunIdentity = Depends(get_identity)):
    return _listing(session, project)


@router.post("/projects/{project_id}/variables", status_code=201)
def create_variable(
    body: VariableIn, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    try:
        var = variables.create(
            session, project, label=body.label, kind=body.kind, unit=body.unit, options=body.options, description=body.description, user=identity.username
        )
    except variables.VariableError as err:
        raise _bad(err) from err
    audit.record(session, identity, "variavel_criada", f'Criou a variável "{var.label}".', project.id, "samplevariable", var.id, body.model_dump())
    session.commit()
    return _listing(session, project)


@router.patch("/projects/{project_id}/variables/{variable_id}")
def patch_variable(
    variable_id: int,
    body: VariablePatch,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    var = _get_var(session, project, variable_id)
    changes = body.model_dump(exclude_unset=True)
    try:
        variables.update(
            session, project, var, label=body.label, unit=body.unit, description=body.description, options=body.options, renames=body.renames
        )
    except variables.VariableError as err:
        session.rollback()
        raise _bad(err) from err
    audit.record(session, identity, "variavel_editada", f'Editou a variável "{var.label}".', project.id, "samplevariable", var.id, changes)
    session.commit()
    return _listing(session, project)


@router.delete("/projects/{project_id}/variables/{variable_id}", status_code=204)
def delete_variable(
    variable_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    var = _get_var(session, project, variable_id)
    label = var.label
    try:
        n = variables.delete(session, var)
    except variables.VariableError as err:
        raise _bad(err) from err
    audit.record(session, identity, "variavel_apagada", f'Apagou a variável "{label}" ({n} valor(es)).', project.id, "samplevariable", variable_id)
    session.commit()
    return Response(status_code=204)


@router.put("/projects/{project_id}/variables/values")
def set_values(
    body: ValuesIn, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    """Preenche valores (vários de uma vez). Tudo ou nada: um valor inválido
    recusa o lote inteiro, com a amostra na mensagem."""
    ensure_open(project)
    vars_by_key = {v.key: v for v in variables.list_for(session, project)}
    samples = {s.id: s for s in session.exec(select(Sample).where(Sample.project_id == project.id))}
    for item in body.values:
        var = vars_by_key.get(item.key)
        sample = samples.get(item.sample_id)
        if var is None or sample is None:
            session.rollback()
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Variável ou amostra não encontrada neste projeto.")
        try:
            variables.set_value(session, project, var, sample, item.value)
        except variables.VariableError as err:
            session.rollback()
            raise _bad(f"{sample.code} — {err}") from err
    audit.record(
        session, identity, "variaveis_preenchidas", f"Preencheu {len(body.values)} valor(es) de variáveis de amostra.", project.id,
        details={"n": len(body.values), "keys": sorted({v.key for v in body.values})},
    )
    session.commit()
    return _listing(session, project)
