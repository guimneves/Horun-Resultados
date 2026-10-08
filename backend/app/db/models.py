"""Modelos do módulo (ESPECIFICACAO.md, seção 4).

Projeto → Experimentos e Amostras → Análises (uma por medição/réplica, com o
arquivo de origem) → Valores (análise, parâmetro, réplica, valor, unidade).
Curvas e tabelas de picos ficam em JSON na própria análise (`data_json`).

REGRA DE MIGRAÇÃO: campo novo num modelo que já tem tabela em produção →
somar `_ensure_column` em `app/db/session.py` NO MESMO COMMIT.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Column, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    # Com fuso (UTC): o SQLModel fixado (0.0.47) recusa datetime "ingênuo".
    return datetime.now(UTC)


class Project(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: str = ""
    color: str = "#15216f"
    archived_at: datetime | None = None
    created_at: datetime = Field(default_factory=utcnow)
    created_by: str = ""
    # Perfil do projeto (tipo de amostra, análises, parâmetros) em JSON —
    # app/services/profiles.py. Vazio = perfil padrão (rocha, hidropirólise).
    profile_json: str = ""


class FractionType(SQLModel, table=True):
    """Significado das frações (H, E, SE...) — tabela editável, global."""

    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    label: str
    description: str = ""
    in_series: bool = True  # entra nos gráficos de série (padrões/outras não)
    # Linha da série em que entra (SE = sem extração → mesma linha de H).
    # Vazio = a própria fração.
    series_group: str = ""
    sort: int = 0


class Experiment(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("project_id", "code_norm"),)

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    code: str
    code_norm: str = Field(index=True)
    temperature_c: float | None = None
    # Letra após a temperatura (HP300NA → N = nitrogênio) e réplica do
    # experimento (A, B, C — corridas independentes na mesma temperatura).
    atmosphere: str = ""
    replicate_letter: str = ""
    duration_h: float | None = None
    reactor: str = ""
    initial_mass_g: float | None = None
    date: str = ""  # texto livre (AAAA-MM-DD quando conhecido)
    notes: str = ""
    # Condições lidas da "Planilha cálculo gás" (rótulo → valor/unidade)
    conditions_json: str = Field(default="{}", sa_column=Column(Text, nullable=False, default="{}"))
    created_at: datetime = Field(default_factory=utcnow)


class Sample(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("project_id", "code_norm"),)

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    code: str
    code_norm: str = Field(index=True)
    experiment_id: int | None = Field(default=None, foreign_key="experiment.id", index=True)
    fraction: str = "X"  # FractionType.code
    temperature_c: float | None = None
    kind: str = "sample"  # sample | standard
    notes: str = ""
    # None = pendente (ainda não revisada), True = válida, False = inválida
    valid: bool | None = None
    validated_by: str | None = None
    validated_at: datetime | None = None
    created_at: datetime = Field(default_factory=utcnow)


class StoredFile(SQLModel, table=True):
    """Arquivo original enviado. O conteúdo fica no volume de uploads, pelo
    sha256 (o mesmo arquivo nunca é guardado nem importado duas vezes)."""

    __table_args__ = (UniqueConstraint("project_id", "sha256"),)

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    sha256: str = Field(index=True)
    filename: str
    path_hint: str = ""  # pasta de origem dentro do .zip (ajuda a achar o experimento)
    size: int = 0
    technique: str | None = None
    format_label: str = ""
    status: str = "preview"  # preview | imported | ignored | error
    report_json: str = Field(default="{}", sa_column=Column(Text, nullable=False, default="{}"))
    uploaded_by: str = ""
    uploaded_at: datetime = Field(default_factory=utcnow)
    imported_at: datetime | None = None
    imported_by: str | None = None


class ImportBatch(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    file_ids_json: str = Field(default="[]", sa_column=Column(Text, nullable=False, default="[]"))
    technique: str = ""  # tipo de análise escolhido pela pessoa ("" = detectar)
    status: str = "preview"  # preview | confirmed
    created_by: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    confirmed_at: datetime | None = None
    summary_json: str = Field(default="{}", sa_column=Column(Text, nullable=False, default="{}"))


class Analysis(SQLModel, table=True):
    """Uma medição (uma réplica) de uma técnica numa amostra."""

    __table_args__ = (UniqueConstraint("project_id", "technique", "source_key"),)

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    sample_id: int = Field(foreign_key="sample.id", index=True)
    technique: str = Field(index=True)  # chnso | leco | rockeval | gc_fid | gc_tcd | gas_balanco | pygcms
    # Chave natural da medição no arquivo (ex. "chnso:<corrida>:<posição>") —
    # reimportar a mesma medição atualiza em vez de duplicar.
    source_key: str
    source_name: str = ""  # nome como veio no arquivo (ex. "HP300-1")
    replicate: int | None = None  # réplica de análise (-1, -2... no código)
    aliquot: int | None = None  # alíquota da amostra (.1, .2 no código)
    analyzed_at: str = ""
    instrument: str = ""
    method: str = ""
    source_file_id: int | None = Field(default=None, foreign_key="storedfile.id")
    is_standard: bool = False
    valid: bool | None = None
    validated_by: str | None = None
    validated_at: datetime | None = None
    notes: str = ""
    data_json: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    extra_json: str = Field(default="{}", sa_column=Column(Text, nullable=False, default="{}"))
    created_at: datetime = Field(default_factory=utcnow)
    created_by: str = ""


class AnalysisValue(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    analysis_id: int = Field(foreign_key="analysis.id", index=True)
    parameter: str = Field(index=True)
    replicate: int | None = None  # réplica dentro da análise (ex. repetições do LECO)
    value: float
    unit: str = ""


class AuditEvent(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    project_id: int | None = Field(default=None, index=True)
    user_id: str = ""
    username: str = ""
    action: str
    entity: str = ""
    entity_id: int | None = None
    summary: str = ""
    details_json: str = Field(default="{}", sa_column=Column(Text, nullable=False, default="{}"))
    created_at: datetime = Field(default_factory=utcnow, index=True)


class SampleAlias(SQLModel, table=True):
    """Nome como aparece num arquivo → amostra do projeto. Gravado quando a
    pessoa atribui um nome a uma amostra na importação; na próxima
    importação, o mesmo nome já vem atribuído (editável na página da amostra)."""

    __table_args__ = (UniqueConstraint("project_id", "alias_norm"),)

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    sample_id: int = Field(foreign_key="sample.id", index=True)
    alias: str
    alias_norm: str = Field(index=True)
    created_by: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class ProjectMember(SQLModel, table=True):
    """Pessoa com acesso a um projeto (pedido do mantenedor, 08/10/2026).

    Coordenadores e o administrador máximo (níveis 1–2) veem todos os
    projetos; pesquisadores, técnicos e ICs (3–5) só os projetos em que são
    membros. `user_id` é o id da pessoa no Horun Core (X-Horun-User-Id).
    `level_at_add` é só registro: a regra usa sempre o cargo ATUAL, que vem
    no cabeçalho X-Horun-Level."""

    __table_args__ = (UniqueConstraint("project_id", "user_id"),)

    id: int | None = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    user_id: str = Field(index=True)
    username: str = ""
    display_name: str = ""
    level_at_add: int | None = None
    added_by: str = ""
    added_at: datetime = Field(default_factory=utcnow)


class KnownUser(SQLModel, table=True):
    """Pessoa do Horun que já abriu este módulo — a lista para escolher
    "Pessoas do projeto". O Core não tem (ainda) uma rota que liste os
    usuários para os módulos; como no Financeiro, o módulo anota quem chega
    (cabeçalhos X-Horun-* que o Core injeta), com o cargo da última visita."""

    user_id: str = Field(primary_key=True)
    username: str = ""
    level: int = 5
    last_seen_at: datetime = Field(default_factory=utcnow)
