"""Importação (ESPECIFICACAO.md, seção 5): enviar → prévia → confirmar.

1. A pessoa escolhe o TIPO de análise e envia os arquivos (ou um .zip). O
   formato é detectado mesmo assim; se não bater com o tipo escolhido, aviso.
2. `preview`: guarda cada original pelo sha256, lê e monta uma tabela com uma
   LINHA por nome escrito no arquivo (réplicas "-1, -2" juntas; alíquotas
   ".1/.2" em linhas próprias). Cada linha vem com uma sugestão: amostra já
   lembrada para esse nome (apelido), amostra com o mesmo código, criar nova
   (fração/temperatura/experimento lidos do código) ou ignorar (padrões e
   brancos).
3. `confirm`: relê os arquivos do lote e grava conforme as atribuições; cada
   nome atribuído a uma amostra com outro código vira APELIDO dela, e a
   próxima importação com o mesmo nome já vem atribuída.

Idempotência: arquivo com o mesmo sha256 já importado no projeto não entra de
novo ("duplicado"); e cada medição tem uma chave natural (`source_key`, ex. a
corrida + posição do CHNSO) — reimportar a mesma medição por outro arquivo
(ex. outra impressão do mesmo relatório) ATUALIZA em vez de duplicar.
"""

from __future__ import annotations

import io
import json
import posixpath
import re
import zipfile
from dataclasses import dataclass, field

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.identity import HorunIdentity
from app.db.models import (
    Analysis,
    AnalysisValue,
    Experiment,
    ImportBatch,
    Project,
    Sample,
    SampleAlias,
    StoredFile,
    utcnow,
)
from app.parsers import NotResultsFile, ParseError, ParseResult, parse_file
from app.parsers.common import Record
from app.parsers.leco import is_diagnostic_zip
from app.services import audit, storage
from app.services.catalog import TECHNIQUES
from app.services.codes import FRACTION_GAS, FRACTION_STANDARD, normalize_code, parse_experiment_code, parse_sample_code

MAX_ZIP_MEMBERS = 3000
MAX_ZIP_TOTAL_BYTES = 600 * 1024 * 1024


@dataclass
class Upload:
    filename: str
    content: bytes
    path_hint: str = ""


@dataclass
class FileOutcome:
    stored: StoredFile | None
    filename: str
    path_hint: str
    status: str  # ok | ignorado | erro | duplicado
    message: str = ""
    result: ParseResult | None = None
    warnings: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ arquivos


def _is_plain_zip(name: str, content: bytes) -> bool:
    if content[:2] != b"PK":
        return False
    if name.lower().endswith(".zip"):
        return True
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            return "[Content_Types].xml" not in zf.namelist()  # .xlsx também é zip
    except zipfile.BadZipFile:
        return False


def expand(uploads: list[Upload]) -> tuple[list[Upload], list[FileOutcome]]:
    """Abre os .zip (um nível). Devolve (arquivos a ler, arquivos já resolvidos)."""
    out: list[Upload] = []
    done: list[FileOutcome] = []
    for up in uploads:
        if not _is_plain_zip(up.filename, up.content):
            out.append(up)
            continue
        try:
            zf = zipfile.ZipFile(io.BytesIO(up.content))
        except zipfile.BadZipFile:
            done.append(FileOutcome(None, up.filename, "", "erro", "Arquivo .zip corrompido."))
            continue
        with zf:
            infos = [i for i in zf.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
            if is_diagnostic_zip([i.filename for i in infos]):
                done.append(
                    FileOutcome(
                        None,
                        up.filename,
                        "",
                        "ignorado",
                        "Este .zip é o pacote de diagnóstico do LECO (logs e configuração), não resultados. "
                        "Exporte os resultados do Cornerstone em CSV.",
                    )
                )
                continue
            if len(infos) > MAX_ZIP_MEMBERS or sum(i.file_size for i in infos) > MAX_ZIP_TOTAL_BYTES:
                done.append(FileOutcome(None, up.filename, "", "erro", "O .zip é grande demais — envie em partes."))
                continue
            for info in infos:
                name = info.filename.encode("cp437").decode("utf-8", errors="replace") if not info.flag_bits & 0x800 else info.filename
                folder, base = posixpath.split(name)
                if base.lower().endswith(".zip"):
                    done.append(FileOutcome(None, base, folder, "ignorado", ".zip dentro de .zip — abra e envie o de dentro."))
                    continue
                out.append(Upload(base, zf.read(info), "/".join(x for x in (up.filename, folder) if x)))
    return out, done


def _read_one(session: Session, project: Project, up: Upload, identity: HorunIdentity) -> FileOutcome:
    digest = storage.sha256(up.content)
    stored = session.exec(
        select(StoredFile).where(StoredFile.project_id == project.id, StoredFile.sha256 == digest)
    ).first()
    if stored is not None and stored.status == "imported":
        when = stored.imported_at.strftime("%d/%m/%Y %H:%M") if stored.imported_at else ""
        return FileOutcome(stored, up.filename, up.path_hint, "duplicado", f"Este mesmo arquivo já foi importado neste projeto ({when}).")
    try:
        result = parse_file(up.filename, up.content, up.path_hint)
        outcome = FileOutcome(None, up.filename, up.path_hint, "ok", result=result, warnings=list(result.warnings))
        if not result.records:
            outcome.status, outcome.message = "ignorado", "Nenhuma medição encontrada no arquivo."
    except NotResultsFile as exc:
        outcome = FileOutcome(None, up.filename, up.path_hint, "ignorado", str(exc))
    except ParseError as exc:
        outcome = FileOutcome(None, up.filename, up.path_hint, "erro", str(exc))
    except Exception as exc:  # noqa: BLE001 — um arquivo ruim não derruba o lote
        outcome = FileOutcome(None, up.filename, up.path_hint, "erro", f"Erro inesperado ao ler o arquivo ({exc.__class__.__name__}).")

    if outcome.status != "ok":
        return outcome
    storage.save(up.content)
    if stored is None:
        stored = StoredFile(project_id=project.id, sha256=digest, filename=up.filename, size=len(up.content))
    stored.filename = up.filename
    stored.path_hint = up.path_hint
    stored.technique = outcome.result.technique
    stored.format_label = outcome.result.format_label
    stored.status = "preview"
    stored.uploaded_by = identity.username
    stored.report_json = json.dumps({"warnings": outcome.warnings, "records": len(outcome.result.records)}, ensure_ascii=False)
    session.add(stored)
    session.flush()
    outcome.stored = stored
    return outcome


# ------------------------------------------------------------------ prévia

_REPLICATE_TAIL_RE = re.compile(r"\s*[-_]\s*\d{1,2}\s*$")


@dataclass
class Planned:
    record: Record
    file: FileOutcome
    replicate: int | None
    aliquot: int | None
    duplicate_of: str | None = None  # mesma medição já vem de outro arquivo do lote


def row_name(record: Record) -> str:
    """Nome da LINHA da prévia: o nome como está no arquivo, sem a réplica de
    análise ("HP300-2" → "HP300"); alíquotas (".1") ficam em linhas próprias,
    para a pessoa decidir (ex.: juntar HP320E.1 e HP320E.2 em HP320E)."""
    if record.fraction_hint == FRACTION_GAS and record.code_hint:
        return record.code_hint
    raw = (record.raw_name or "").strip()
    if parse_sample_code(raw).replicate is not None:
        return _REPLICATE_TAIL_RE.sub("", raw).strip() or raw
    return raw


def _suggest(record: Record) -> dict:
    info = parse_sample_code(record.code_hint or record.raw_name)
    if record.fraction_hint == FRACTION_GAS:
        exp = record.code_hint or info.base_code
        return {
            "code": f"{exp} (gás)",
            "fraction": FRACTION_GAS,
            "temperature_c": info.temperature_c,
            "experiment_code": info.experiment_code or exp,
            "kind": "sample",
            "recognized": info.recognized,
            "replicate": None,
            "aliquot": None,
        }
    kind = "standard" if record.kind == "standard" or info.kind == "standard" else "sample"
    return {
        "code": info.base_code,
        "fraction": FRACTION_STANDARD if kind == "standard" else (record.fraction_hint or info.fraction),
        "temperature_c": info.temperature_c,
        "experiment_code": info.experiment_code,
        "kind": kind,
        "recognized": info.recognized,
        "replicate": info.replicate,
        "aliquot": info.aliquot,
    }


def _plan(outcomes: list[FileOutcome]) -> dict[str, dict]:
    """Agrupa as medições por nome no arquivo. Mesma medição em dois arquivos
    do lote: vale a fonte de maior prioridade (e, empatado, a mais nova)."""
    best: dict[tuple[str, str], tuple[tuple[int, str], Planned]] = {}
    planned: list[Planned] = []
    for out in outcomes:
        if out.status != "ok" or out.result is None:
            continue
        for rec in out.result.records:
            sug = _suggest(rec)
            rep = sug["replicate"] if sug["replicate"] is not None else rec.extra.get("replicate_hint")
            p = Planned(rec, out, rep, sug["aliquot"])
            planned.append(p)
            key = (rec.technique, rec.key)
            prio = (out.result.priority, out.result.tiebreak)
            if key in best:
                old_prio, old = best[key]
                if prio > old_prio:
                    old.duplicate_of = out.filename
                    best[key] = (prio, p)
                else:
                    p.duplicate_of = old.file.filename
            else:
                best[key] = (prio, p)

    rows: dict[str, dict] = {}
    for p in planned:
        name = row_name(p.record)
        norm = normalize_code(name)
        sug = _suggest(p.record)
        row = rows.setdefault(
            norm,
            {
                "row": norm,
                "name": name,
                "suggested": {k: sug[k] for k in ("code", "fraction", "temperature_c", "experiment_code", "kind", "recognized")},
                "kind": "blank" if p.record.kind == "blank" else sug["kind"],
                "items": [],
            },
        )
        row["items"].append(p)
    return rows


def _aliases(session: Session, project_id: int) -> dict[str, SampleAlias]:
    return {a.alias_norm: a for a in session.exec(select(SampleAlias).where(SampleAlias.project_id == project_id))}


def _samples_by_norm(session: Session, project_id: int) -> dict[str, Sample]:
    return {s.code_norm: s for s in session.exec(select(Sample).where(Sample.project_id == project_id))}


def _resolve(row: dict, samples: dict[str, Sample], samples_by_id: dict[int, Sample], aliases: dict[str, SampleAlias]) -> dict:
    """Sugestão de atribuição de uma linha: nome já lembrado (apelido) →
    amostra com o mesmo código → amostra com o código lido do nome → criar.
    Padrões e brancos: ignorar por padrão."""
    is_gas = row["suggested"]["fraction"] == FRACTION_GAS

    def compatible(sample: Sample | None) -> bool:
        # gás nunca cai numa amostra de rocha com o mesmo código (HP355NB) e vice-versa
        return sample is not None and (sample.fraction == FRACTION_GAS) == is_gas

    alias = aliases.get(row["row"])
    if alias and compatible(samples_by_id.get(alias.sample_id)):
        return {"action": "link", "sample_id": alias.sample_id, "source": "lembrado"}
    if compatible(samples.get(row["row"])):
        return {"action": "link", "sample_id": samples[row["row"]].id, "source": "mesmo código"}
    base = samples.get(normalize_code(row["suggested"]["code"]))
    if compatible(base):
        return {"action": "link", "sample_id": base.id, "source": "código"}
    if row["kind"] in ("standard", "blank"):
        return {"action": "skip", "sample_id": None, "source": "padrão" if row["kind"] == "standard" else "branco"}
    return {"action": "create", "sample_id": None, "source": "nova"}


def _summary_values(items: list[Planned]) -> dict[str, float]:
    """Média dos parâmetros principais das medições da linha (para a prévia)."""
    acc: dict[str, list[float]] = {}
    for p in items:
        mains = {x.key for x in TECHNIQUES.get(p.record.technique, {}).get("params", []) if x.main}
        for v in p.record.values:
            if v.parameter in mains and not p.duplicate_of:
                acc.setdefault(f"{p.record.technique}.{v.parameter}", []).append(v.value)
    return {k: round(sum(vs) / len(vs), 4) for k, vs in acc.items()}


def _already_imported(session: Session, stored: StoredFile) -> list[str]:
    ids = {a.sample_id for a in session.exec(select(Analysis).where(Analysis.source_file_id == stored.id))}
    return sorted(s.code for s in (session.get(Sample, i) for i in ids) if s)


def build_preview(session: Session, project: Project, outcomes: list[FileOutcome], batch: ImportBatch) -> dict:
    rows = _plan(outcomes)
    samples = _samples_by_norm(session, project.id)
    by_id = {s.id: s for s in samples.values()}
    aliases = _aliases(session, project.id)
    keys = {(t, k) for t, k in session.exec(select(Analysis.technique, Analysis.source_key).where(Analysis.project_id == project.id))}
    out_rows = []
    for norm, row in sorted(rows.items(), key=lambda kv: (kv[1]["kind"] != "sample", kv[1]["suggested"]["temperature_c"] or 0, kv[0])):
        resolved = _resolve(row, samples, by_id, aliases)
        target = by_id.get(resolved["sample_id"]) if resolved["sample_id"] else None
        items = row["items"]
        out_rows.append(
            {
                "row": norm,
                "name": row["name"],
                "kind": row["kind"],
                "techniques": sorted({p.record.technique for p in items}),
                "files": sorted({p.file.filename for p in items}),
                "n_measurements": sum(1 for p in items if not p.duplicate_of),
                "replicates": sorted({p.replicate for p in items if p.replicate is not None}),
                "aliquots": sorted({p.aliquot for p in items if p.aliquot is not None}),
                "values": _summary_values(items),
                "suggested": row["suggested"],
                "action": resolved["action"],
                "sample_id": resolved["sample_id"],
                "sample_code": target.code if target else None,
                "suggestion_source": resolved["source"],
                "updates_existing": any((p.record.technique, p.record.key) in keys for p in items),
                "measurements": [
                    {
                        "file": p.file.filename,
                        "technique": p.record.technique,
                        "raw_name": p.record.raw_name,
                        "replicate": p.replicate,
                        "aliquot": p.aliquot,
                        "key": p.record.key,
                        "n_values": len(p.record.values),
                        "updates_existing": (p.record.technique, p.record.key) in keys,
                        "duplicate_of": p.duplicate_of,
                    }
                    for p in items
                ],
            }
        )
    files = []
    for o in outcomes:
        entry = {
            "filename": o.filename,
            "folder": o.path_hint,
            "status": o.status,
            "message": o.message,
            "technique": o.result.technique if o.result else (o.stored.technique if o.stored else None),
            "format": o.result.format_label if o.result else "",
            "records": len(o.result.records) if o.result else 0,
            "warnings": o.warnings,
            "already_in_samples": _already_imported(session, o.stored) if o.status == "duplicado" and o.stored else [],
        }
        files.append(entry)
    return {
        "batch_id": batch.id,
        "technique": batch.technique,
        "files": files,
        "rows": out_rows,
        "counts": {
            "files": len(files),
            "ok": sum(1 for f in files if f["status"] == "ok"),
            "ignored": sum(1 for f in files if f["status"] == "ignorado"),
            "errors": sum(1 for f in files if f["status"] == "erro"),
            "duplicates": sum(1 for f in files if f["status"] == "duplicado"),
            "rows": len(out_rows),
            "assigned": sum(1 for r in out_rows if r["action"] == "link"),
            "to_create": sum(1 for r in out_rows if r["action"] == "create"),
            "ignored_rows": sum(1 for r in out_rows if r["action"] == "skip"),
            "measurements": sum(r["n_measurements"] for r in out_rows),
        },
    }


def preview(session: Session, project: Project, uploads: list[Upload], identity: HorunIdentity, technique: str = "") -> dict:
    files, outcomes = expand(uploads)
    for up in files:
        outcomes.append(_read_one(session, project, up, identity))
    if technique:
        chosen = TECHNIQUES.get(technique, {}).get("label", technique)
        for o in outcomes:
            if o.status == "ok" and o.result and o.result.technique != technique:
                found = TECHNIQUES.get(o.result.technique, {}).get("label", o.result.technique)
                o.warnings.insert(0, f"Você escolheu {chosen}, mas este arquivo parece ser de {found} — confira antes de confirmar.")
    batch = ImportBatch(
        project_id=project.id,
        technique=technique,
        file_ids_json=json.dumps([o.stored.id for o in outcomes if o.status == "ok" and o.stored]),
        created_by=identity.username,
    )
    session.add(batch)
    session.flush()
    data = build_preview(session, project, outcomes, batch)
    batch.summary_json = json.dumps({"files": data["files"]}, ensure_ascii=False)
    session.add(batch)
    session.commit()
    return data


# ------------------------------------------------------------------ confirmação


def _reparse(session: Session, batch: ImportBatch) -> list[FileOutcome]:
    outcomes = []
    for file_id in json.loads(batch.file_ids_json or "[]"):
        stored = session.get(StoredFile, file_id)
        if stored is None:
            continue
        if stored.status == "imported":
            outcomes.append(FileOutcome(stored, stored.filename, stored.path_hint, "duplicado", "Já importado."))
            continue
        content = storage.read(stored.sha256)
        if content is None:
            outcomes.append(FileOutcome(stored, stored.filename, stored.path_hint, "erro", "Arquivo original não encontrado no servidor."))
            continue
        try:
            result = parse_file(stored.filename, content, stored.path_hint)
            outcomes.append(FileOutcome(stored, stored.filename, stored.path_hint, "ok", result=result))
        except ParseError as exc:
            outcomes.append(FileOutcome(stored, stored.filename, stored.path_hint, "erro", str(exc)))
    return outcomes


def get_or_create_experiment(session: Session, project_id: int, code: str, info=None) -> Experiment:
    norm = normalize_code(code)
    exp = session.exec(select(Experiment).where(Experiment.project_id == project_id, Experiment.code_norm == norm)).first()
    parts = parse_experiment_code(code)
    if exp is None:
        exp = Experiment(
            project_id=project_id,
            code=code.strip(),
            code_norm=norm,
            temperature_c=parts["temperature_c"],
            atmosphere=parts["atmosphere"] or "",
            replicate_letter=parts["replicate_letter"] or "",
        )
    if info is not None:
        if info.atmosphere and not exp.atmosphere:
            exp.atmosphere = info.atmosphere
        if info.reactor and not exp.reactor:
            exp.reactor = info.reactor
        if info.initial_mass_g is not None and exp.initial_mass_g is None:
            exp.initial_mass_g = info.initial_mass_g
        if info.conditions:
            current = json.loads(exp.conditions_json or "{}")
            current.update(info.conditions)
            exp.conditions_json = json.dumps(current, ensure_ascii=False, default=str)
    session.add(exp)
    session.flush()
    return exp


def remember_alias(session: Session, project_id: int, name: str, sample: Sample, username: str) -> None:
    """Guarda "nome no arquivo → amostra" (só quando o nome difere do código)."""
    norm = normalize_code(name)
    if not norm or norm == sample.code_norm:
        return
    alias = session.exec(select(SampleAlias).where(SampleAlias.project_id == project_id, SampleAlias.alias_norm == norm)).first()
    if alias is None:
        alias = SampleAlias(project_id=project_id, sample_id=sample.id, alias=name.strip(), alias_norm=norm, created_by=username)
    alias.sample_id = sample.id
    session.add(alias)


def confirm(session: Session, project: Project, batch: ImportBatch, decisions: list[dict], identity: HorunIdentity) -> dict:
    if batch.status == "confirmed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Esta importação já foi confirmada.")
    outcomes = _reparse(session, batch)
    rows = _plan(outcomes)
    by_row = {d.get("row"): d for d in decisions if d.get("row")}
    samples = _samples_by_norm(session, project.id)
    by_id = {s.id: s for s in samples.values()}
    aliases = _aliases(session, project.id)
    counts = {"samples_created": 0, "samples_linked": 0, "analyses_created": 0, "analyses_updated": 0, "skipped": 0, "aliases_saved": 0}
    created_codes: list[str] = []
    linked: dict[str, list[str]] = {}

    for norm, row in rows.items():
        decision = by_row.get(norm) or _resolve(row, samples, by_id, aliases)
        action = decision.get("action")
        if action == "skip":
            counts["skipped"] += sum(1 for p in row["items"] if not p.duplicate_of)
            continue
        sug = row["suggested"]
        exp_code = decision.get("experiment_code", sug["experiment_code"]) if action == "create" else sug["experiment_code"]
        experiment = None
        if exp_code:
            experiment = get_or_create_experiment(session, project.id, exp_code)
            for p in row["items"]:  # FID, TCD e planilha de gás somam informações
                if p.record.experiment and normalize_code(p.record.experiment.code) == normalize_code(exp_code):
                    experiment = get_or_create_experiment(session, project.id, exp_code, p.record.experiment)

        if action == "link":
            sample = by_id.get(decision.get("sample_id") or -1)
            if sample is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Escolha a amostra para \"{row['name']}\" (ou marque Ignorar).")
            if experiment and sample.experiment_id is None and normalize_code(sug["code"]) == sample.code_norm:
                sample.experiment_id = experiment.id
            counts["samples_linked"] += 1
        elif action == "create":
            code = (decision.get("code") or sug["code"]).strip()
            code_norm = normalize_code(code)
            sample = samples.get(code_norm)
            if sample is None:
                temperature = decision.get("temperature_c", sug["temperature_c"])
                if temperature is None and experiment is not None:
                    temperature = experiment.temperature_c
                sample = Sample(
                    project_id=project.id,
                    code=code,
                    code_norm=code_norm,
                    experiment_id=experiment.id if experiment else None,
                    fraction=decision.get("fraction") or sug["fraction"],
                    temperature_c=temperature,
                    kind=sug["kind"] if sug["kind"] in ("sample", "standard") else "sample",
                )
                session.add(sample)
                session.flush()
                samples[code_norm] = sample
                by_id[sample.id] = sample
                counts["samples_created"] += 1
                created_codes.append(code)
            else:
                counts["samples_linked"] += 1
        else:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Ação inválida para \"{row['name']}\".")
        session.add(sample)
        # lembra o nome só quando a pessoa escolheu algo que o código não daria
        # (o nome "HP320E.1" → HP320E o parser já sugere sozinho)
        if sample.code_norm not in (normalize_code(row["name"]), normalize_code(sug["code"])):
            remember_alias(session, project.id, row["name"], sample, identity.username)
            counts["aliases_saved"] += 1
        linked.setdefault(sample.code, []).append(row["name"])

        for p in row["items"]:
            if p.duplicate_of:
                counts["skipped"] += 1
                continue
            _upsert_analysis(session, project, sample, p, identity, counts)

    imported_files = []
    for o in outcomes:
        if o.status == "ok" and o.stored is not None:
            o.stored.status = "imported"
            o.stored.imported_at = utcnow()
            o.stored.imported_by = identity.username
            session.add(o.stored)
            imported_files.append(o.filename)
    batch.status = "confirmed"
    batch.confirmed_at = utcnow()
    batch.summary_json = json.dumps({**json.loads(batch.summary_json or "{}"), "result": counts}, ensure_ascii=False)
    session.add(batch)
    audit.record(
        session,
        identity,
        "importacao",
        f"Importou {len(imported_files)} arquivo(s): {counts['samples_created']} amostra(s) nova(s), "
        f"{counts['analyses_created']} medição(ões) nova(s), {counts['analyses_updated']} atualizada(s).",
        project_id=project.id,
        entity="import_batch",
        entity_id=batch.id,
        details={"files": imported_files, "counts": counts, "new_samples": created_codes, "linked": linked},
    )
    session.commit()
    return {**counts, "files_imported": len(imported_files), "new_sample_codes": created_codes, "linked": linked}


def _upsert_analysis(session: Session, project: Project, sample: Sample, p: Planned, identity: HorunIdentity, counts: dict) -> None:
    rec = p.record
    analysis = session.exec(
        select(Analysis).where(
            Analysis.project_id == project.id, Analysis.technique == rec.technique, Analysis.source_key == rec.key
        )
    ).first()
    if analysis is None:
        analysis = Analysis(project_id=project.id, sample_id=sample.id, technique=rec.technique, source_key=rec.key, created_by=identity.username)
        counts["analyses_created"] += 1
    else:
        for old in session.exec(select(AnalysisValue).where(AnalysisValue.analysis_id == analysis.id)):
            session.delete(old)
        counts["analyses_updated"] += 1
    analysis.sample_id = sample.id
    analysis.source_name = rec.raw_name
    analysis.replicate = p.replicate
    analysis.aliquot = p.aliquot
    analysis.analyzed_at = rec.analyzed_at
    analysis.instrument = rec.instrument
    analysis.method = rec.method
    analysis.source_file_id = p.file.stored.id if p.file.stored else None
    analysis.is_standard = sample.kind == "standard"
    analysis.data_json = json.dumps(rec.data, ensure_ascii=False) if rec.data is not None else None
    analysis.extra_json = json.dumps(rec.extra, ensure_ascii=False, default=str)
    session.add(analysis)
    session.flush()
    for v in rec.values:
        session.add(AnalysisValue(analysis_id=analysis.id, parameter=v.parameter, replicate=v.replicate, value=v.value, unit=v.unit))
