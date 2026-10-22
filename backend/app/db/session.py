"""Banco do módulo — SQLite em desenvolvimento, PostgreSQL em produção (a URL
vem de MODULE_DATABASE_URL, ver core/config.py).

REGRA (já derrubou módulos em produção mais de uma vez): `create_all()` só
cria tabela que não existe — NUNCA adiciona coluna a uma tabela existente.
Todo campo novo num modelo que já tem tabela em produção ganha uma linha de
`_ensure_column` em `_run_migrations`, NO MESMO COMMIT. A migração roda na
subida do backend, em qualquer banco (SQLite e Postgres).
"""

from __future__ import annotations

import logging

from collections.abc import Generator

from sqlalchemy import inspect
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)

# Tipos/defaults escritos no estilo SQLite traduzidos para o Postgres.
_PG_TYPES = {"DATETIME": "TIMESTAMP"}
_PG_BOOL_DEFAULTS = {"0": "FALSE", "1": "TRUE"}


def add_column_ddl(dialect, table: str, column: str, ddl_type: str, default_sql: str | None = None) -> str:
    """`ALTER TABLE ... ADD COLUMN` para o banco em uso. Nomes entre aspas pelo
    próprio dialeto — `user`, por exemplo, é palavra reservada no Postgres."""
    quote = dialect.identifier_preparer.quote
    if dialect.name == "postgresql":
        if ddl_type.upper() == "BOOLEAN" and default_sql is not None:
            default_sql = _PG_BOOL_DEFAULTS.get(default_sql.strip(), default_sql)
        ddl_type = _PG_TYPES.get(ddl_type.upper(), ddl_type)
    stmt = f"ALTER TABLE {quote(table)} ADD COLUMN {quote(column)} {ddl_type}"
    if default_sql is not None:
        stmt += f" DEFAULT {default_sql}"
    return stmt


def _ensure_column(table: str, column: str, ddl_type: str, default_sql: str | None = None) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(table):
        return  # tabela nova: o create_all já cria com todas as colunas
    if column in {c["name"] for c in inspector.get_columns(table)}:
        return
    with engine.begin() as conn:
        conn.exec_driver_sql(add_column_ddl(engine.dialect, table, column, ddl_type, default_sql))


def _run_migrations() -> None:
    # Uma linha por coluna adicionada a um modelo DEPOIS do primeiro deploy
    # (as colunas da v1 já nascem com o create_all). Exemplo:
    #   _ensure_column("sample", "observacoes", "VARCHAR")
    #   _ensure_column("sample", "conferida", "BOOLEAN", default_sql="0")
    _ensure_column("project", "profile_json", "TEXT", default_sql="''")  # 08/10/2026 — perfil do projeto
    # 08/10/2026 — massas por réplica (gás editado, óleo, betume)
    _ensure_column("experiment", "gas_mass_g", "FLOAT")
    _ensure_column("experiment", "oil_mass_g", "FLOAT")
    _ensure_column("experiment", "bitumen_mass_g", "FLOAT")
    # 19/10/2026 — frações por tipo de amostra (rocha × tabaco)
    _ensure_column("fractiontype", "sample_type", "VARCHAR", default_sql="''")
    # 08/10/2026 — tabelas novas `projectmember` e `knownuser` (acesso por
    # projeto): nascem inteiras pelo create_all, sem coluna a acrescentar.
    # 22/10/2026 — tabelas novas `samplevariable` e `samplevariablevalue`
    # (variáveis de amostra): idem. E `doeplan` / `doerun` (extrações ASE e
    # planejamentos fatoriais): idem.


def _seed_fractions() -> None:
    """Frações padrão (H, E, SE...) — só cria as que faltam; o que o
    coordenador editou fica como está."""
    from app.db.models import FractionType
    from app.services.codes import (
        DEFAULT_FRACTIONS,
        DEFAULT_SERIES_GROUP,
        FRACTION_OTHER,
        FRACTION_STANDARD,
        TOBACCO_FRACTIONS,
        ASE_FRACTIONS,
    )

    shared = (FRACTION_STANDARD, FRACTION_OTHER)
    with Session(engine) as session:
        existing = {f.code: f for f in session.exec(select(FractionType))}
        for order, (code, label, description) in enumerate(DEFAULT_FRACTIONS):
            sample_type = "" if code in shared else "rocha_hidropirolise"
            if code not in existing:
                session.add(
                    FractionType(
                        code=code,
                        label=label,
                        description=description,
                        in_series=code not in shared,
                        series_group=DEFAULT_SERIES_GROUP.get(code, ""),
                        sort=order,
                        sample_type=sample_type,
                    )
                )
            elif not existing[code].sample_type and sample_type:
                existing[code].sample_type = sample_type  # base de antes de 19/10/2026
                session.add(existing[code])
        for order, (code, label, description) in enumerate(TOBACCO_FRACTIONS, start=100):
            if code not in existing:
                session.add(FractionType(code=code, label=label, description=description, in_series=True, sort=order,
                                         sample_type="tabaco"))
        for order, (code, label, description) in enumerate(ASE_FRACTIONS, start=200):
            if code not in existing:
                session.add(FractionType(code=code, label=label, description=description, in_series=True, sort=order,
                                         sample_type="ase_extracao"))
        session.commit()


def _fix_tobacco_sample_types() -> None:
    """Amostras de tabaco importadas antes de 19/10/2026 ficaram como "Outra"
    (e por isso escondidas na aba Amostras): o tipo sai do código e dos nomes
    já vistos nos arquivos (apelidos). Brancos e padrões ficam como estão."""
    from app.db.models import Analysis, Project, Sample, SampleAlias
    from app.services import profiles
    from app.services.codes import FRACTION_OTHER, normalize_code, tobacco_type

    with Session(engine) as session:
        for project in session.exec(select(Project)).all():
            if profiles.load(project.profile_json).sample_type != "tabaco":
                continue
            for s in session.exec(
                select(Sample).where(Sample.project_id == project.id, Sample.fraction == FRACTION_OTHER, Sample.kind == "sample")
            ).all():
                if normalize_code(s.code) in ("BLANK", "BRANCO", "BRANCOS"):
                    continue
                names = [a.alias for a in session.exec(select(SampleAlias).where(SampleAlias.sample_id == s.id)).all()]
                # e os nomes como vieram nos arquivos (ex. "Ch_Produto_Alfa_1")
                names += [a.source_name for a in session.exec(select(Analysis).where(Analysis.sample_id == s.id)).all() if a.source_name]
                s.fraction = tobacco_type(s.code, *names)
                session.add(s)
        session.commit()


def create_db_and_tables() -> None:
    from app.db import models  # noqa: F401 — registra as tabelas antes do create_all

    SQLModel.metadata.create_all(engine)
    _run_migrations()
    _seed_fractions()
    try:
        _fix_tobacco_sample_types()
    except Exception:  # noqa: BLE001 — uma correção de dados nunca pode impedir o módulo de subir
        logging.getLogger(__name__).exception("correção dos tipos de tabaco falhou; o módulo sobe sem ela")


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
