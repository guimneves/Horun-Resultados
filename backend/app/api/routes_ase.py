"""Extrações ASE e planejamentos fatoriais (DOE) de um projeto "Geoquímica —
Extração ASE" (app/services/ase.py e doe.py). Ver: todo membro do projeto;
criar/alterar: níveis 1–3 (`require_editor`)."""

from __future__ import annotations

import json
import math
import random

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import delete as sa_delete
from sqlmodel import Session, select

from app.api.deps import ensure_open, get_project
from app.core.identity import HorunIdentity, get_identity
from app.core.permissions import require_editor
from app.db.models import DoePlan, DoeRun, Project, Sample, utcnow
from app.db.session import get_session
from app.services import ase, audit, doe, profiles

router = APIRouter(tags=["ase"])

ASE_TYPE = "ase_extracao"
METHOD_KEYS = ("equipment", "cell", "pressure", "heat_time", "static_time", "rinse", "purge", "nominal_mass", "rock", "packing", "notes")


def _finite(obj):
    """inf/NaN não existem em JSON → None."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _finite(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_finite(v) for v in obj]
    return obj


def _ase_project(project: Project) -> None:
    if profiles.load(project.profile_json).sample_type != ASE_TYPE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Planejamentos e extrações ASE só existem em projetos de Geoquímica — Extração ASE.")


def _bad(err: Exception) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(err))


class FactorIn(BaseModel):
    name: str = Field(max_length=200)
    unit: str = Field(default="", max_length=40)
    kind: str = "continuo"
    low: float | str | None = None
    high: float | str | None = None
    low_label: str = Field(default="", max_length=120)
    high_label: str = Field(default="", max_length=120)


class PlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    factors: list[FactorIn]
    replicates: int = 2
    center_points: int = 0
    randomized: bool = False
    pre_sample_id: int | None = None
    method: dict[str, str] = Field(default_factory=dict)
    code_template: str = Field(default="", max_length=200)  # ex.: "HP320_{cond}_R{rep}"


class PlanPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    factors: list[FactorIn] | None = None
    replicates: int | None = None
    center_points: int | None = None
    pre_sample_id: int | None = None
    method: dict[str, str] | None = None


class RunPatch(BaseModel):
    code: str | None = Field(default=None, max_length=200)
    actual_order: int | None = None
    run_date: str | None = Field(default=None, max_length=20)
    sample_id: int | None = None
    valid: bool | None = None
    notes: str | None = Field(default=None, max_length=2000)
    results: dict | None = None


def _get_plan(session: Session, project: Project, plan_id: int) -> DoePlan:
    plan = session.get(DoePlan, plan_id)
    if plan is None or plan.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Planejamento não encontrado.")
    return plan


def _check_sample(session: Session, project: Project, sample_id: int | None) -> None:
    if sample_id is None:
        return
    s = session.get(Sample, sample_id)
    if s is None or s.project_id != project.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Amostra não encontrada neste projeto.")


def _clean_method(raw: dict[str, str]) -> dict[str, str]:
    return {k: str(raw.get(k) or "").strip()[:200] for k in METHOD_KEYS if str(raw.get(k) or "").strip()}


def _code_for(template: str, cond: str, rep: int) -> str:
    if not template:
        return ""
    return template.replace("{cond}", "C" if cond == "C" else cond).replace("{rep}", str(rep))


def _plan_out(session: Session, plan: DoePlan) -> dict:
    factors = ase.plan_factors(plan)
    ok, why = doe.center_feasibility(factors)
    conds = []
    for c in doe.conditions(factors):
        conds.append({"code": c["code"], "coded": c["coded"], "values": {f["letter"]: doe.level_value(f, c["coded"][f["letter"]]) for f in factors},
                      "levels": {f["letter"]: doe.level_text(f, c["coded"][f["letter"]]) for f in factors}})
    pre = session.get(Sample, plan.pre_sample_id) if plan.pre_sample_id else None
    summ = ase.summary(session, plan)
    return _finite({
        "id": plan.id,
        "name": plan.name,
        "description": plan.description,
        "factors": factors,
        "design": f"2^{len(factors)}",
        "terms": doe.terms(len(factors)),
        "replicates": plan.replicates,
        "center_points": plan.center_points,
        "center_possible": ok,
        "center_reason": why,
        "center_values": doe.center_values(factors) if ok else None,
        "randomized": plan.randomized,
        "pre_sample": {"id": pre.id, "code": pre.code} if pre else None,
        "method": json.loads(plan.method_json or "{}"),
        "conditions_matrix": conds,
        "n_runs": len(summ["runs"]),
        "n_done": sum(1 for r in summ["runs"] if r["done"]),
        **summ,
        "created_by": plan.created_by,
        "updated_at": plan.updated_at.isoformat(),
    })


@router.get("/projects/{project_id}/doe")
def list_plans(project: Project = Depends(get_project), session: Session = Depends(get_session), _i: HorunIdentity = Depends(get_identity)):
    out = []
    for p in session.exec(select(DoePlan).where(DoePlan.project_id == project.id).order_by(DoePlan.created_at)).all():
        runs = session.exec(select(DoeRun).where(DoeRun.plan_id == p.id)).all()
        done = sum(1 for r in runs if any(k in json.loads(r.results_json or "{}") for k in ase.INPUT_KEYS))
        factors = ase.plan_factors(p)
        out.append({"id": p.id, "name": p.name, "design": f"2^{len(factors)}", "factors": [f["name"] for f in factors],
                    "replicates": p.replicates, "center_points": p.center_points, "n_runs": len(runs), "n_done": done,
                    "updated_at": p.updated_at.isoformat()})
    return {"plans": out, "fields": ase.fields_out(), "method_keys": list(METHOD_KEYS)}


@router.post("/projects/{project_id}/doe", status_code=201)
def create_plan(body: PlanIn, project: Project = Depends(get_project), session: Session = Depends(get_session),
                identity: HorunIdentity = Depends(require_editor)):
    ensure_open(project)
    _ase_project(project)
    _check_sample(session, project, body.pre_sample_id)
    try:
        factors = doe.clean_factors([f.model_dump() for f in body.factors])
        seed = random.SystemRandom().randint(1, 10**9) if body.randomized else 0
        runs = doe.plan_runs(factors, body.replicates, body.center_points, body.randomized, seed)
    except doe.DoeError as err:
        raise _bad(err) from err
    plan = DoePlan(project_id=project.id, name=body.name.strip(), description=body.description.strip(),  # type: ignore[arg-type]
                   factors_json=json.dumps(factors, ensure_ascii=False), replicates=body.replicates, center_points=body.center_points,
                   randomized=body.randomized, seed=seed, pre_sample_id=body.pre_sample_id,
                   method_json=json.dumps(_clean_method(body.method), ensure_ascii=False), created_by=identity.username)
    session.add(plan)
    session.flush()
    for r in runs:
        session.add(DoeRun(plan_id=plan.id, condition=r["condition"], replicate=r["replicate"], planned_order=r["planned_order"],  # type: ignore[arg-type]
                           code=_code_for(body.code_template, r["condition"], r["replicate"])))
    audit.record(session, identity, "doe_criado", f'Criou o planejamento "{plan.name}" ({len(factors)} fatores, {len(runs)} execuções).',
                 project.id, "doeplan", plan.id)
    session.commit()
    session.refresh(plan)
    return _plan_out(session, plan)


@router.get("/projects/{project_id}/doe/{plan_id}")
def get_plan(plan_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session), _i: HorunIdentity = Depends(get_identity)):
    return _plan_out(session, _get_plan(session, project, plan_id))


@router.patch("/projects/{project_id}/doe/{plan_id}")
def patch_plan(plan_id: int, body: PlanPatch, project: Project = Depends(get_project), session: Session = Depends(get_session),
               identity: HorunIdentity = Depends(require_editor)):
    """Nome, descrição, método e rocha pré: sempre. Fatores: só sem resultados.
    Réplicas/pontos centrais: acrescenta execuções novas; só tira as que ainda
    não têm resultado."""
    ensure_open(project)
    plan = _get_plan(session, project, plan_id)
    changes = body.model_dump(exclude_unset=True)
    runs = ase.runs_of(session, plan)
    with_data = {(r.condition, r.replicate) for r in runs if json.loads(r.results_json or "{}")}
    if "name" in changes and body.name:
        plan.name = body.name.strip()
    if "description" in changes:
        plan.description = (body.description or "").strip()
    if "method" in changes:
        plan.method_json = json.dumps(_clean_method(body.method or {}), ensure_ascii=False)
    if "pre_sample_id" in changes:
        _check_sample(session, project, body.pre_sample_id)
        plan.pre_sample_id = body.pre_sample_id
    try:
        factors = ase.plan_factors(plan)
        if body.factors is not None:
            new = doe.clean_factors([f.model_dump() for f in body.factors])
            if len(new) != len(factors) and with_data:
                raise doe.DoeError("Já há resultados: o número de fatores não pode mudar (crie outro planejamento).")
            factors = new
            plan.factors_json = json.dumps(factors, ensure_ascii=False)
        reps = body.replicates if body.replicates is not None else plan.replicates
        centers = body.center_points if body.center_points is not None else plan.center_points
        wanted = {(r["condition"], r["replicate"]) for r in doe.plan_runs(factors, reps, centers, False, 0)}
        losing = [k for k in with_data if k not in wanted]
        if losing:
            raise doe.DoeError("Estas execuções já têm resultado e não podem sair: " + ", ".join(f"{c} R{r}" for c, r in sorted(losing)) + ".")
    except doe.DoeError as err:
        session.rollback()
        raise _bad(err) from err
    have = {(r.condition, r.replicate): r for r in runs}
    for key, r in have.items():
        if key not in wanted:
            session.delete(r)
    nxt = max([r.planned_order or 0 for r in runs if (r.condition, r.replicate) in wanted] + [0])
    new_keys = sorted(k for k in wanted if k not in have)
    if plan.randomized:
        random.Random(plan.seed + len(runs)).shuffle(new_keys)
    for c, rep in new_keys:
        nxt += 1
        session.add(DoeRun(plan_id=plan.id, condition=c, replicate=rep, planned_order=nxt))  # type: ignore[arg-type]
    plan.replicates, plan.center_points = reps, centers
    plan.updated_at = utcnow()
    session.add(plan)
    audit.record(session, identity, "doe_editado", f'Editou o planejamento "{plan.name}".', project.id, "doeplan", plan.id,
                 {k: v for k, v in changes.items() if k != "factors"})
    session.commit()
    session.refresh(plan)
    return _plan_out(session, plan)


@router.post("/projects/{project_id}/doe/{plan_id}/randomize")
def randomize(plan_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session),
              identity: HorunIdentity = Depends(require_editor)):
    """Sorteia de novo a ordem planejada (a ordem efetiva não muda)."""
    ensure_open(project)
    plan = _get_plan(session, project, plan_id)
    runs = ase.runs_of(session, plan)
    plan.seed = random.SystemRandom().randint(1, 10**9)
    plan.randomized = True
    order = list(range(len(runs)))
    random.Random(plan.seed).shuffle(order)
    for pos, idx in enumerate(order, start=1):
        runs[idx].planned_order = pos
        session.add(runs[idx])
    session.add(plan)
    session.commit()
    return _plan_out(session, plan)


@router.delete("/projects/{project_id}/doe/{plan_id}", status_code=204)
def delete_plan(plan_id: int, project: Project = Depends(get_project), session: Session = Depends(get_session),
                identity: HorunIdentity = Depends(require_editor)):
    ensure_open(project)
    plan = _get_plan(session, project, plan_id)
    name = plan.name
    session.exec(sa_delete(DoeRun).where(DoeRun.plan_id == plan.id))  # type: ignore[arg-type]
    session.delete(plan)
    audit.record(session, identity, "doe_excluido", f'Excluiu o planejamento "{name}" e os resultados dele.', project.id, "doeplan", plan_id)
    session.commit()
    return Response(status_code=204)


@router.patch("/projects/{project_id}/doe/{plan_id}/runs/{run_id}")
def patch_run(plan_id: int, run_id: int, body: RunPatch, project: Project = Depends(get_project), session: Session = Depends(get_session),
              identity: HorunIdentity = Depends(require_editor)):
    ensure_open(project)
    plan = _get_plan(session, project, plan_id)
    run = session.get(DoeRun, run_id)
    if run is None or run.plan_id != plan.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Execução não encontrada.")
    changes = body.model_dump(exclude_unset=True)
    if "sample_id" in changes:
        _check_sample(session, project, body.sample_id)
        run.sample_id = body.sample_id
    for key in ("code", "run_date", "notes"):
        if key in changes:
            setattr(run, key, (changes[key] or "").strip())
    if "actual_order" in changes:
        run.actual_order = body.actual_order
    if "valid" in changes and body.valid is not None:
        run.valid = body.valid
    if body.results is not None:
        try:
            clean = ase.clean_results(body.results)
        except ase.AseError as err:
            raise _bad(err) from err
        had = bool(json.loads(run.results_json or "{}"))
        run.results_json = json.dumps(clean)
        if clean and not had and run.actual_order is None:
            # ordem efetiva: a próxima, na ordem em que os resultados chegam
            others = session.exec(select(DoeRun).where(DoeRun.plan_id == plan.id)).all()
            run.actual_order = max([r.actual_order or 0 for r in others] + [0]) + 1
    run.updated_by = identity.username
    run.updated_at = utcnow()
    plan.updated_at = utcnow()
    session.add(run)
    session.add(plan)
    audit.record(session, identity, "doe_execucao", f'Atualizou {run.condition} R{run.replicate} em "{plan.name}".', project.id, "doerun", run.id,
                 {k: v for k, v in changes.items()})
    session.commit()
    return _plan_out(session, plan)


@router.get("/projects/{project_id}/doe/{plan_id}/analysis")
def analysis(plan_id: int, response: str, confidence: float = 0.95, project: Project = Depends(get_project),
             session: Session = Depends(get_session), _i: HorunIdentity = Depends(get_identity)):
    plan = _get_plan(session, project, plan_id)
    try:
        obs = ase.observations(session, plan, response)
        result = doe.analyze(ase.plan_factors(plan), obs, confidence)
    except (ase.AseError, doe.DoeError) as err:
        raise _bad(err) from err
    f = ase.FIELD_BY_KEY[response]
    result["response"] = {"key": f.key, "label": f.label, "short": f.short, "unit": f.unit, "group": f.group}
    return _finite(result)


@router.post("/projects/{project_id}/doe/{plan_id}/import")
async def import_consolidated(plan_id: int, file: UploadFile = File(...), dry_run: bool = Form(True), overwrite: bool = Form(False),
                              project: Project = Depends(get_project), session: Session = Depends(get_session),
                              identity: HorunIdentity = Depends(require_editor)):
    """Planilha de resultados (abas "Consolidado R1/R2…") → resultados finais
    das execuções, casando condição (F01…) e réplica (R1…). Sem `overwrite`,
    só preenche o que está vazio."""
    ensure_open(project)
    plan = _get_plan(session, project, plan_id)
    try:
        parsed = ase.read_consolidated(await file.read())
    except ase.AseError as err:
        raise _bad(err) from err
    runs = {(r.condition, r.replicate): r for r in ase.runs_of(session, plan)}
    rows, missing = [], []
    for (cond, rep), entry in sorted(parsed["entries"].items()):
        run = runs.get((cond, rep))
        if run is None:
            missing.append(f"{cond} R{rep}")
            continue
        current = json.loads(run.results_json or "{}")
        new = entry["results"]
        merged = {**current, **new} if overwrite else {**new, **current}
        filled = [k for k in new if k in ase.INPUT_KEYS and (overwrite or k not in current)]
        rows.append({"run": f"{cond} R{rep}", "code": entry["code"], "fields": [ase.FIELD_BY_KEY[k].short for k in filled],
                     "code_changes": bool(entry["code"]) and entry["code"] != run.code and (overwrite or not run.code)})
        if not dry_run:
            run.results_json = json.dumps(ase.clean_results(merged))
            if entry["code"] and (overwrite or not run.code):
                run.code = entry["code"]
            run.updated_by = identity.username
            run.updated_at = utcnow()
            session.add(run)
    if not dry_run:
        plan.updated_at = utcnow()
        session.add(plan)
        audit.record(session, identity, "doe_importado", f'Importou resultados da planilha "{file.filename}" em "{plan.name}".', project.id,
                     "doeplan", plan.id, {"execucoes": len(rows)})
        session.commit()
    return {"dry_run": dry_run, "rows": rows, "not_in_plan": missing, "warnings": parsed["warnings"], "sheets": parsed["sheets"]}
