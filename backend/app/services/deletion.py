"""Exclusão de amostras (uma ou várias) — a mesma lógica para a exclusão
individual (página da amostra) e a em lote (aba Amostras).

Excluir uma amostra apaga tudo o que é só dela: as medições (análises, com
curvas/picos em `data_json`), os valores, os nomes lembrados (`SampleAlias`) e
a validação (campos da própria amostra/medição). O histórico fica.

Arquivo original (`StoredFile`): continua se outra medição ainda aponta para
ele; se ficou sem nenhuma, sai do banco e — depois do commit, e só se nenhum
outro projeto guarda o mesmo conteúdo — do disco. Assim o mesmo arquivo pode
ser importado de novo depois.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import delete as sa_delete
from sqlalchemy import func
from sqlmodel import Session, select

from app.db.models import Analysis, AnalysisValue, Sample, SampleAlias, StoredFile
from app.services import storage

_CHUNK = 500  # limite de parâmetros do IN (SQLite)


def _chunks(ids: list[int]):
    for start in range(0, len(ids), _CHUNK):
        yield ids[start : start + _CHUNK]


@dataclass
class DeletionPlan:
    samples: list[Sample]
    analyses_per_sample: dict[int, int]
    analysis_ids: list[int]
    files_removed: list[StoredFile] = field(default_factory=list)  # ficam sem nenhuma medição
    files_kept: list[StoredFile] = field(default_factory=list)  # ainda usados por outras amostras

    def preview(self) -> dict:
        return {
            "samples": [{"id": s.id, "code": s.code, "analyses": self.analyses_per_sample.get(s.id, 0)} for s in self.samples],
            "total_samples": len(self.samples),
            "total_analyses": len(self.analysis_ids),
            "files_removed": len(self.files_removed),
            "files_kept": len(self.files_kept),
        }


def plan(session: Session, samples: list[Sample]) -> DeletionPlan:
    """O que sairia do banco ao excluir estas amostras (nada é alterado)."""
    sample_ids = [s.id for s in samples]
    rows: list[tuple[int, int, int | None]] = []
    for part in _chunks(sample_ids):
        rows += list(session.exec(select(Analysis.id, Analysis.sample_id, Analysis.source_file_id).where(Analysis.sample_id.in_(part))))  # type: ignore[union-attr]
    per_sample = Counter(sample_id for _, sample_id, _ in rows)
    analysis_ids = [aid for aid, _, _ in rows]
    leaving = Counter(fid for _, _, fid in rows if fid is not None)
    result = DeletionPlan(samples, dict(per_sample), analysis_ids)
    for fid, n_leaving in leaving.items():
        stored = session.get(StoredFile, fid)
        if stored is None:
            continue
        total = session.exec(select(func.count()).select_from(Analysis).where(Analysis.source_file_id == fid)).one()
        (result.files_removed if total <= n_leaving else result.files_kept).append(stored)
    return result


def execute(session: Session, p: DeletionPlan) -> list[str]:
    """Apaga na ordem que respeita as chaves estrangeiras. Não faz commit;
    devolve os sha256 dos arquivos que saíram do banco (para `cleanup_disk`
    depois do commit)."""
    for part in _chunks(p.analysis_ids):
        session.exec(sa_delete(AnalysisValue).where(AnalysisValue.analysis_id.in_(part)))  # type: ignore[union-attr]
        session.exec(sa_delete(Analysis).where(Analysis.id.in_(part)))  # type: ignore[union-attr]
    sample_ids = [s.id for s in p.samples]
    for part in _chunks(sample_ids):
        session.exec(sa_delete(SampleAlias).where(SampleAlias.sample_id.in_(part)))  # type: ignore[attr-defined]
    for s in p.samples:
        session.delete(s)
    digests = []
    for stored in p.files_removed:
        digests.append(stored.sha256)
        session.delete(stored)
    session.flush()
    return digests


def cleanup_disk(session: Session, digests: list[str]) -> None:
    """Depois do commit: tira do disco o original que nenhum projeto usa mais."""
    for digest in digests:
        if session.exec(select(StoredFile).where(StoredFile.sha256 == digest)).first() is None:
            storage.delete(digest)
