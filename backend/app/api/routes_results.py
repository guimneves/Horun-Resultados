"""Importação (prévia/confirmação), séries, curvas e exportação."""

from __future__ import annotations

import csv
import io
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.api.deps import ensure_open, get_project
from app.core import notify as notify_module
from app.core.config import settings
from app.core.identity import HorunIdentity, get_identity
from app.core.permissions import require_editor
from app.db.models import ImportBatch, Project
from app.db.session import get_session
from app.services import importer, results
from app.services.catalog import TECHNIQUES

router = APIRouter(tags=["resultados"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- importação


@router.post("/projects/{project_id}/imports/preview")
async def import_preview(
    files: list[UploadFile] = File(...),
    technique: str = Form(default=""),
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    if technique and technique not in TECHNIQUES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tipo de análise desconhecido.")
    limit = settings.max_upload_mb * 1024 * 1024
    uploads = []
    for f in files:
        content = await f.read()
        if len(content) > limit:
            raise HTTPException(
                status.HTTP_413_CONTENT_TOO_LARGE, f"\"{f.filename}\" passa do limite de {settings.max_upload_mb} MB por arquivo."
            )
        uploads.append(importer.Upload(f.filename or "arquivo", content))
    if not uploads:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum arquivo enviado.")
    return importer.preview(session, project, uploads, identity, technique)


class Decision(BaseModel):
    row: str
    action: str = Field(pattern="^(link|create|skip)$")
    sample_id: int | None = None
    code: str | None = Field(default=None, max_length=80)
    fraction: str | None = None
    temperature_c: float | None = None
    experiment_code: str | None = Field(default=None, max_length=60)


class ConfirmBody(BaseModel):
    decisions: list[Decision] = []


@router.post("/projects/{project_id}/imports/{batch_id}/confirm")
def import_confirm(
    batch_id: int,
    body: ConfirmBody,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    identity: HorunIdentity = Depends(require_editor),
):
    ensure_open(project)
    batch = session.get(ImportBatch, batch_id)
    if batch is None or batch.project_id != project.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Importação não encontrada.")
    decisions = [d.model_dump(exclude_unset=True) for d in body.decisions]
    summary = importer.confirm(session, project, batch, decisions, identity)
    created = summary["samples_created"]
    measured = summary["analyses_created"] + summary["analyses_updated"]
    if measured:
        # Aviso de rotina (só o sininho) aos coordenadores — Prompt, seção 11.
        notify_module.notify(
            f"{created} amostras importadas em {project.name}" if created else f"Resultados importados em {project.name}",
            text=(
                f"{identity.username} importou {summary['files_imported']} arquivo(s) no projeto {project.name}: "
                f"{created} amostra(s) nova(s) e {measured} medição(ões). Confira e valide no módulo Resultados."
            ),
            link=f"/projects/{project.id}/amostras",
            levels=[1, 2],
            email=False,
        )
    return summary


# ---------------------------------------------------------------- séries e curvas


@router.get("/projects/{project_id}/series")
def series(
    technique: str,
    parameter: str,
    mode: str = "padrao",
    split_replicates: bool = False,
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    _i: HorunIdentity = Depends(get_identity),
):
    if technique not in TECHNIQUES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Técnica desconhecida.")
    if mode not in results.MODES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Modo de validade inválido.")
    return results.series(session, project.id, technique, parameter, mode, split_replicates)


@router.get("/projects/{project_id}/analysis-data")
def analysis_data(
    technique: str,
    sample_ids: str = "",
    mode: str = "padrao",
    project: Project = Depends(get_project),
    session: Session = Depends(get_session),
    _i: HorunIdentity = Depends(get_identity),
):
    if technique not in TECHNIQUES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Técnica desconhecida.")
    ids = [int(x) for x in sample_ids.split(",") if x.strip().isdigit()]
    return results.analysis_data(session, project.id, technique, ids, mode)


# ---------------------------------------------------------------- exportação


class ExportBody(BaseModel):
    format: str = Field(default="csv", pattern="^(csv|xlsx)$")
    sample_ids: list[int] = []
    columns: list[str] = []  # "tecnica.parametro"
    mode: str = "padrao"


def _col_label(col: str) -> str:
    tech, _, key = col.partition(".")
    for p in TECHNIQUES.get(tech, {}).get("params", []):
        if p.key == key:
            unit = f" ({p.unit})" if p.unit else ""
            return f"{TECHNIQUES[tech]['label']} {p.label}{unit}"
    return col


@router.post("/projects/{project_id}/export")
def export(body: ExportBody, project: Project = Depends(get_project), session: Session = Depends(get_session), _i: HorunIdentity = Depends(get_identity)):
    if body.mode not in results.MODES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Modo de validade inválido.")
    table = results.table(session, project.id, body.mode)["samples"]
    wanted = set(body.sample_ids)
    rows = [r for r in table if not wanted or r["id"] in wanted]
    columns = body.columns or sorted({k for r in rows for k in r["values"]})
    header = ["Amostra", "Fração", "Temperatura (°C)", "Experimento", "Atmosfera", "Réplica do experimento", "Validade"]
    for c in columns:
        label = _col_label(c)
        header += [f"{label} média", f"{label} desvio", f"{label} n"]
    out_rows = []
    for r in rows:
        line = [
            r["code"],
            r["fraction"],
            r["temperature_c"],
            r["experiment_code"] or "",
            r["atmosphere"] or "",
            r["replicate_letter"] or "",
            {True: "válida", False: "inválida", None: "pendente"}[r["valid"]],
        ]
        for c in columns:
            v = r["values"].get(c) or {}
            line += [v.get("mean"), v.get("sd"), v.get("n")]
        out_rows.append(line)
    safe_name = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in project.name)[:40] or "projeto"
    if body.format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=";")
        writer.writerow(header)
        for line in out_rows:
            writer.writerow(["" if x is None else (f"{x:.6g}".replace(".", ",") if isinstance(x, float) else x) for x in line])
        return Response(
            ("﻿" + buf.getvalue()).encode("utf-8"),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="resultados_{safe_name}.csv"'},
        )
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Resultados"
    ws.append(header)
    for line in out_rows:
        ws.append(line)
    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="resultados_{safe_name}.xlsx"'},
    )
