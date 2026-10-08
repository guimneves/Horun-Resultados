"""Experimentos, amostras e medições (análises) de um projeto.

Níveis 1–3 (administrador, coordenador/a, pesquisador/a) criam, editam e
excluem amostras, experimentos e medições; técnico(a) e IC só visualizam;
validar/invalidar: níveis 1–3, como as demais alterações (ESPECIFICACAO.md, seção 7)."""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete
from sqlmodel import Session, select

from app.api.deps import ensure_open, get_project
from app.core.identity import HorunIdentity, get_identity
from app.core.permissions import require_editor
from app.db.models import Analysis, AnalysisValue, Experiment, FractionType, Project, Sample, SampleAlias, utcnow
from app.db.session import get_session
from app.services import audit, deletion, importer, results
from app.services.codes import normalize_code, parse_experiment_code, parse_sample_code

router = APIRouter(tags=["amostras"])


# ---------------------------------------------------------------- experimentos


class ExperimentIn(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    temperature_c: float | None = None
    atmosphere: str | None = Field(default=None, max_length=40)
    replicate_letter: str | None = Field(default=None, max_length=4)
    duration_h: float | None = None
    reactor: str = Field(default="", max_length=120)
    initial_mass_g: float | None = None
    date: str = Field(default="", max_length=20)
    notes: str = Field(default="", max_length=4000)


class ExperimentPatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=60)
    temperature_c: float | None = None
    atmosphere: str | None = Field(default=None, max_length=40)
    replicate_letter: str | None = Field(default=None, max_length=4)
    duration_h: float | None = None
    reactor: str | None = Field(default=None, max_length=120)
    initial_mass_g: float | None = None
    date: str | None = Field(default=None, max_length=20)
    notes: str | None = Field(default=None, max_length=4000)


def _experiment_out(session: Session, exp: Experiment) -> dict:
    samples = session.exec(select(Sample).where(Sample.experiment_id == exp.id)).all()
    return {
        **exp.model_dump(exclude={"conditions_json"}),
        "conditions": json.loads(exp.conditions_json or "{}"),
        "samples": [{"id": s.id, "code": s.code, "fraction": s.fraction, "valid": s.valid} for s in samples],
    }


def _get_experiment(session: Session, project: Project, experiment_id: int) -> Experiment:
    exp = session.get(Experiment, experiment_id)
    if exp is None or exp.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Experimento não encontrado.")
    return exp


@router.get("/projects/{project_id}/experiments")
def list_experiments(project: Project = Depends(get_project), session: Session = Depends(get_session), _i: HorunIdentity = Depends(get_identity)):
    exps = session.exec(select(Experiment).where(Experiment.project_id == project.id)).all()
    return [_experiment_out(session, e) for e in sorted(exps, key=lambda e: (e.temperature_c or 0, e.code))]


@router.post("/projects/{project_id}/experiments", status_code=201)
def create_experiment(
    body: ExperimentIn, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    norm = normalize_code(body.code)
    if session.exec(select(Experiment).where(Experiment.project_id == project.id, Experiment.code_norm == norm)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um experimento com esse código neste projeto.")
    parts = parse_experiment_code(body.code)
    data = body.model_dump()
    exp = Experiment(
        project_id=project.id,
        code_norm=norm,
        **{**data, "code": body.code.strip()},
    )
    exp.temperature_c = body.temperature_c if body.temperature_c is not None else parts["temperature_c"]
    exp.atmosphere = body.atmosphere if body.atmosphere is not None else (parts["atmosphere"] or "")
    exp.replicate_letter = body.replicate_letter if body.replicate_letter is not None else (parts["replicate_letter"] or "")
    session.add(exp)
    session.flush()
    audit.record(session, identity, "experimento_criado", f"Criou o experimento {exp.code}.", project.id, "experiment", exp.id)
    session.commit()
    session.refresh(exp)
    return _experiment_out(session, exp)


@router.patch("/projects/{project_id}/experiments/{experiment_id}")
def patch_experiment(
    experiment_id: int,
    body: ExperimentPatch,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    exp = _get_experiment(session, project, experiment_id)
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes:
        norm = normalize_code(changes["code"])
        other = session.exec(
            select(Experiment).where(Experiment.project_id == project.id, Experiment.code_norm == norm, Experiment.id != exp.id)
        ).first()
        if other:
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe um experimento com esse código neste projeto.")
        exp.code_norm = norm
    for k, v in changes.items():
        setattr(exp, k, v.strip() if isinstance(v, str) else v)
    session.add(exp)
    audit.record(session, identity, "experimento_editado", f"Editou o experimento {exp.code}.", project.id, "experiment", exp.id, changes)
    session.commit()
    session.refresh(exp)
    return _experiment_out(session, exp)


@router.delete("/projects/{project_id}/experiments/{experiment_id}", status_code=204)
def delete_experiment(
    experiment_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    exp = _get_experiment(session, project, experiment_id)
    for s in session.exec(select(Sample).where(Sample.experiment_id == exp.id)):
        s.experiment_id = None  # as amostras ficam; só perdem o vínculo
        session.add(s)
    session.delete(exp)
    audit.record(session, identity, "experimento_excluido", f"Excluiu o experimento {exp.code}.", project.id, "experiment", experiment_id)
    session.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- amostras


class SampleIn(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    fraction: str | None = None
    temperature_c: float | None = None
    experiment_id: int | None = None
    notes: str = Field(default="", max_length=4000)


class SamplePatch(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=80)
    fraction: str | None = None
    temperature_c: float | None = None
    experiment_id: int | None = None
    notes: str | None = Field(default=None, max_length=4000)


class Validation(BaseModel):
    valid: bool | None  # None = volta a "pendente"
    note: str = Field(default="", max_length=500)


def _check_fraction(session: Session, code: str) -> None:
    if session.exec(select(FractionType).where(FractionType.code == code)).first() is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Fração \"{code}\" não existe.")


def _get_sample(session: Session, project: Project, sample_id: int) -> Sample:
    sample = session.get(Sample, sample_id)
    if sample is None or sample.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Amostra não encontrada.")
    return sample


@router.get("/projects/{project_id}/samples")
def samples_table(
    mode: str = "padrao", project: Project = Depends(get_project), session: Session = Depends(get_session), _i: HorunIdentity = Depends(get_identity)
):
    if mode not in results.MODES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Modo de validade inválido.")
    return results.table(session, project.id, mode)


@router.post("/projects/{project_id}/samples", status_code=201)
def create_sample(
    body: SampleIn, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    norm = normalize_code(body.code)
    if session.exec(select(Sample).where(Sample.project_id == project.id, Sample.code_norm == norm)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma amostra com esse código neste projeto.")
    info = parse_sample_code(body.code)
    fraction = body.fraction or info.fraction
    _check_fraction(session, fraction)
    if body.experiment_id is not None:
        _get_experiment(session, project, body.experiment_id)
    sample = Sample(
        project_id=project.id,
        code=body.code.strip(),
        code_norm=norm,
        fraction=fraction,
        temperature_c=body.temperature_c if body.temperature_c is not None else info.temperature_c,
        experiment_id=body.experiment_id,
        kind=info.kind,
        notes=body.notes,
    )
    session.add(sample)
    session.flush()
    audit.record(session, identity, "amostra_criada", f"Criou a amostra {sample.code}.", project.id, "sample", sample.id)
    session.commit()
    session.refresh(sample)
    return results.sample_detail(session, sample)


@router.get("/projects/{project_id}/samples/{sample_id}")
def get_sample(sample_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session), _i: HorunIdentity = Depends(get_identity)):
    return results.sample_detail(session, _get_sample(session, project, sample_id))


@router.patch("/projects/{project_id}/samples/{sample_id}")
def patch_sample(
    sample_id: int,
    body: SamplePatch,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    sample = _get_sample(session, project, sample_id)
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes:
        norm = normalize_code(changes["code"])
        if session.exec(select(Sample).where(Sample.project_id == project.id, Sample.code_norm == norm, Sample.id != sample.id)).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "Já existe uma amostra com esse código neste projeto.")
        sample.code_norm = norm
    if changes.get("fraction"):
        _check_fraction(session, changes["fraction"])
    if changes.get("experiment_id") is not None:
        _get_experiment(session, project, changes["experiment_id"])
    for k, v in changes.items():
        setattr(sample, k, v.strip() if isinstance(v, str) else v)
    session.add(sample)
    audit.record(session, identity, "amostra_editada", f"Editou a amostra {sample.code}.", project.id, "sample", sample.id, changes)
    session.commit()
    session.refresh(sample)
    return results.sample_detail(session, sample)


@router.post("/projects/{project_id}/samples/{sample_id}/validation")
def validate_sample(
    sample_id: int,
    body: Validation,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    sample = _get_sample(session, project, sample_id)
    sample.valid = body.valid
    sample.validated_by = identity.username if body.valid is not None else None
    sample.validated_at = utcnow() if body.valid is not None else None
    session.add(sample)
    word = {True: "válida", False: "inválida", None: "pendente"}[body.valid]
    audit.record(session, identity, "validacao", f"Marcou a amostra {sample.code} como {word}.", project.id, "sample", sample.id, {"note": body.note})
    session.commit()
    session.refresh(sample)
    return results.sample_detail(session, sample)


@router.delete("/projects/{project_id}/samples/{sample_id}", status_code=204)
def delete_sample(
    sample_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    sample = _get_sample(session, project, sample_id)
    p = deletion.plan(session, [sample])
    code = sample.code
    digests = deletion.execute(session, p)
    audit.record(
        session, identity, "amostra_excluida", f"Excluiu a amostra {code} e {len(p.analysis_ids)} medição(ões).", project.id, "sample", sample_id
    )
    session.commit()
    deletion.cleanup_disk(session, digests)
    return Response(status_code=204)


# ---------------------------------------------------------------- várias amostras de uma vez


class SampleIds(BaseModel):
    sample_ids: list[int] = Field(min_length=1, max_length=5000)


class BulkDelete(SampleIds):
    dry_run: bool = False  # True = só conta o que sairia (para a confirmação)


class BulkValidation(SampleIds, Validation):
    pass


def _get_samples(session: Session, project: Project, ids: list[int]) -> list[Sample]:
    """Amostras na ordem pedida (sem repetir). Todas têm de ser do projeto."""
    wanted = list(dict.fromkeys(ids))
    found: dict[int, Sample] = {}
    for start in range(0, len(wanted), 500):
        part = wanted[start : start + 500]
        found.update({s.id: s for s in session.exec(select(Sample).where(Sample.id.in_(part), Sample.project_id == project.id))})  # type: ignore[union-attr]
    missing = [i for i in wanted if i not in found]
    if missing:
        shown = ", ".join(str(i) for i in missing[:10]) + ("..." if len(missing) > 10 else "")
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Amostra(s) não encontrada(s) neste projeto: {shown}. Nada foi alterado.")
    return [found[i] for i in wanted]


@router.post("/projects/{project_id}/samples/bulk-delete")
def bulk_delete_samples(
    body: BulkDelete, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    """Exclui várias amostras numa transação só. Com `dry_run`, só devolve o
    que sairia (medições por amostra, arquivos que saem/ficam)."""
    ensure_open(project)
    samples = _get_samples(session, project, body.sample_ids)
    p = deletion.plan(session, samples)
    preview = p.preview()
    if body.dry_run:
        return {**preview, "dry_run": True}
    codes = [s.code for s in samples]
    digests = deletion.execute(session, p)
    audit.record(
        session,
        identity,
        "amostras_excluidas",
        f"Excluiu {len(codes)} amostra(s) e {len(p.analysis_ids)} medição(ões) de uma vez.",
        project.id,
        "sample",
        details={"codes": codes, "analyses": len(p.analysis_ids), "files_removed": preview["files_removed"]},
    )
    session.commit()
    deletion.cleanup_disk(session, digests)
    return {
        "dry_run": False,
        "deleted_samples": len(codes),
        "deleted_analyses": len(p.analysis_ids),
        "files_removed": preview["files_removed"],
        "files_kept": preview["files_kept"],
    }


@router.post("/projects/{project_id}/samples/bulk-validation")
def bulk_validate_samples(
    body: BulkValidation, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    samples = _get_samples(session, project, body.sample_ids)
    now = utcnow()
    for sample in samples:
        sample.valid = body.valid
        sample.validated_by = identity.username if body.valid is not None else None
        sample.validated_at = now if body.valid is not None else None
        session.add(sample)
    word = {True: "válidas", False: "inválidas", None: "pendentes"}[body.valid]
    codes = [s.code for s in samples]
    audit.record(
        session,
        identity,
        "validacao",
        f"Marcou {len(codes)} amostra(s) como {word} de uma vez.",
        project.id,
        "sample",
        details={"codes": codes, "note": body.note},
    )
    session.commit()
    return {"updated": len(codes), "valid": body.valid}


# ---------------------------------------------------------------- medições


def _get_analysis(session: Session, project: Project, analysis_id: int) -> Analysis:
    analysis = session.get(Analysis, analysis_id)
    if analysis is None or analysis.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Medição não encontrada.")
    return analysis


@router.post("/projects/{project_id}/analyses/{analysis_id}/validation")
def validate_analysis(
    analysis_id: int,
    body: Validation,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    analysis = _get_analysis(session, project, analysis_id)
    analysis.valid = body.valid
    analysis.validated_by = identity.username if body.valid is not None else None
    analysis.validated_at = utcnow() if body.valid is not None else None
    session.add(analysis)
    word = {True: "válida", False: "inválida", None: "pendente"}[body.valid]
    audit.record(
        session, identity, "validacao", f"Marcou a medição {analysis.source_name} ({analysis.technique}) como {word}.", project.id, "analysis", analysis.id
    )
    session.commit()
    return {"id": analysis.id, "valid": analysis.valid}


@router.delete("/projects/{project_id}/analyses/{analysis_id}", status_code=204)
def delete_analysis(
    analysis_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    analysis = _get_analysis(session, project, analysis_id)
    session.exec(sa_delete(AnalysisValue).where(AnalysisValue.analysis_id == analysis.id))  # type: ignore[arg-type]
    name = f"{analysis.source_name} ({analysis.technique})"
    session.delete(analysis)
    audit.record(session, identity, "medicao_excluida", f"Excluiu a medição {name}.", project.id, "analysis", analysis_id)
    session.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- cadastro em lote e apelidos


class BulkCodes(BaseModel):
    codes: list[str] = Field(max_length=500)


def split_codes(codes: list[str]) -> list[str]:
    """Aceita a lista colada (uma por linha, ou separada por vírgula, ";" ou tab)."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in codes:
        for part in re.split(r"[\n\r,;\t]+", raw):
            code = part.strip()
            if code and normalize_code(code) not in seen:
                seen.add(normalize_code(code))
                out.append(code)
    return out


@router.post("/projects/{project_id}/samples/bulk", status_code=201)
def bulk_samples(
    body: BulkCodes, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    """Cria várias amostras de uma vez (lista de códigos colada). Fração,
    temperatura e experimento sugeridos pelo código; o experimento é criado
    se ainda não existir. Códigos já cadastrados são só listados."""
    ensure_open(project)
    created, existing = [], []
    for code in split_codes(body.codes):
        info = parse_sample_code(code)
        # "RO-1" ou "HP320E.1" → a amostra é RO / HP320E (réplica e alíquota não são amostras)
        target = info.base_code if info.recognized and info.base_code else code
        norm = normalize_code(target)
        if session.exec(select(Sample).where(Sample.project_id == project.id, Sample.code_norm == norm)).first():
            existing.append(code)
            continue
        exp = importer.get_or_create_experiment(session, project.id, info.experiment_code) if info.experiment_code else None
        session.add(
            Sample(
                project_id=project.id,
                code=target,
                code_norm=norm,
                fraction=info.fraction,
                temperature_c=info.temperature_c,
                experiment_id=exp.id if exp else None,
                kind=info.kind,
            )
        )
        session.flush()
        created.append(code)
    if created:
        audit.record(session, identity, "amostras_em_lote", f"Cadastrou {len(created)} amostra(s) de uma vez.", project.id, details={"codes": created})
    session.commit()
    return {"created": created, "existing": existing}


@router.post("/projects/{project_id}/experiments/bulk", status_code=201)
def bulk_experiments(
    body: BulkCodes, project: Project = Depends(get_project), session: Session = Depends(get_session), identity: HorunIdentity = Depends(require_editor)
):
    ensure_open(project)
    created, existing = [], []
    for code in split_codes(body.codes):
        norm = normalize_code(code)
        if session.exec(select(Experiment).where(Experiment.project_id == project.id, Experiment.code_norm == norm)).first():
            existing.append(code)
            continue
        importer.get_or_create_experiment(session, project.id, code)
        created.append(code)
    if created:
        audit.record(session, identity, "experimentos_em_lote", f"Cadastrou {len(created)} experimento(s) de uma vez.", project.id, details={"codes": created})
    session.commit()
    return {"created": created, "existing": existing}


class AliasIn(BaseModel):
    alias: str = Field(min_length=1, max_length=120)


@router.post("/projects/{project_id}/samples/{sample_id}/aliases", status_code=201)
def add_alias(
    sample_id: int,
    body: AliasIn,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    sample = _get_sample(session, project, sample_id)
    norm = normalize_code(body.alias)
    if norm == sample.code_norm:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O nome é igual ao código da amostra.")
    if session.exec(select(Sample).where(Sample.project_id == project.id, Sample.code_norm == norm)).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, f"\"{body.alias}\" já é o código de outra amostra.")
    importer.remember_alias(session, project.id, body.alias, sample, identity.username)
    audit.record(session, identity, "apelido", f"Ligou o nome \"{body.alias}\" à amostra {sample.code}.", project.id, "sample", sample.id)
    session.commit()
    return results.sample_detail(session, sample)


@router.delete("/projects/{project_id}/samples/{sample_id}/aliases/{alias_id}", status_code=204)
def delete_alias(
    sample_id: int,
    alias_id: int,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    sample = _get_sample(session, project, sample_id)
    alias = session.get(SampleAlias, alias_id)
    if alias is None or alias.sample_id != sample.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nome lembrado não encontrado.")
    name = alias.alias
    session.delete(alias)
    audit.record(session, identity, "apelido", f"Desligou o nome \"{name}\" da amostra {sample.code}.", project.id, "sample", sample.id)
    session.commit()
    return Response(status_code=204)
