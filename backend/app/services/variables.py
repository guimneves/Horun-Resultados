"""Variáveis de amostra (pedido do usuário, 22/10/2026): "na rocha temos a
variável temperatura, no tabaco a variável tipo; quero que o pesquisador
possa criar variáveis novas ou editar as existentes, e que as Séries mostrem
os resultados em função da variável".

* Embutidas (nascem com o projeto, não se apagam):
  - rocha: "Temperatura de hidropirólise" (número, °C) — o valor é
    `Sample.temperature_c` (lido do código na importação, editável);
  - tabaco: "Tipo" (categoria) — o valor é a fração CHA/CIG/NAR/TAB; as
    categorias vêm das frações do tipo de amostra (não se editam aqui).
  Nome, unidade e descrição podem mudar.
* Criadas pelas pessoas: número (com unidade) ou categoria (lista de opções,
  na ordem dos gráficos). Valores em `SampleVariableValue`.

Valor de uma amostra: float (número), str (categoria) ou None (sem valor).
"""

from __future__ import annotations

import json
import re

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, select

from app.db.models import FractionType, Project, Sample, SampleVariable, SampleVariableValue
from app.services import profiles

KINDS = ("numero", "categoria")
MAX_OPTIONS = 60


class VariableError(ValueError):
    """Mensagem em português para a pessoa."""


def _builtins_for(project: Project) -> list[dict]:
    st = profiles.load(project.profile_json).sample_type
    out = []
    if profiles.SAMPLE_TYPES[st].temperature_axis:
        out.append({"key": "temperatura", "builtin": "temperature", "label": "Temperatura de hidropirólise", "kind": "numero", "unit": "°C"})
    if st == "tabaco":
        out.append({"key": "tipo", "builtin": "fraction", "label": "Tipo", "kind": "categoria", "unit": ""})
    return out


def ensure_builtins(session: Session, project: Project) -> None:
    """Cria (uma vez) as variáveis embutidas do tipo de amostra do projeto."""
    have = {v.builtin for v in session.exec(select(SampleVariable).where(SampleVariable.project_id == project.id)) if v.builtin}
    added = False
    for i, b in enumerate(_builtins_for(project)):
        if b["builtin"] not in have:
            session.add(SampleVariable(project_id=project.id, sort=i, created_by="Horun", **b))
            added = True
    if added:
        session.commit()


def list_for(session: Session, project: Project) -> list[SampleVariable]:
    ensure_builtins(session, project)
    rows = session.exec(select(SampleVariable).where(SampleVariable.project_id == project.id)).all()
    return sorted(rows, key=lambda v: (v.sort, v.id or 0))


def get(session: Session, project: Project, key: str) -> SampleVariable | None:
    ensure_builtins(session, project)
    return session.exec(select(SampleVariable).where(SampleVariable.project_id == project.id, SampleVariable.key == key)).first()


def fraction_options(session: Session, project: Project) -> list[dict]:
    """Categorias da variável "Tipo": as frações do tipo de amostra do projeto."""
    st = profiles.load(project.profile_json).sample_type
    fr = session.exec(select(FractionType).where(FractionType.sample_type == st)).all()
    return [{"value": f.code, "label": f.label} for f in sorted(fr, key=lambda f: (f.sort, f.code))]


def options_of(session: Session, project: Project, var: SampleVariable) -> list[dict]:
    if var.builtin == "fraction":
        return fraction_options(session, project)
    if var.kind != "categoria":
        return []
    return [{"value": o, "label": o} for o in json.loads(var.options_json or "[]")]


def values_of(session: Session, var: SampleVariable, samples: list[Sample]) -> dict[int, float | str | None]:
    """Valor de cada amostra (id → valor)."""
    if var.builtin == "temperature":
        return {s.id: s.temperature_c for s in samples}  # type: ignore[misc]
    if var.builtin == "fraction":
        return {s.id: s.fraction for s in samples}  # type: ignore[misc]
    rows = session.exec(select(SampleVariableValue).where(SampleVariableValue.variable_id == var.id)).all()
    by_sample = {r.sample_id: (r.number if var.kind == "numero" else (r.text or None)) for r in rows}
    return {s.id: by_sample.get(s.id) for s in samples}  # type: ignore[misc]


def all_values(session: Session, project: Project, samples: list[Sample]) -> dict[int, dict[str, float | str | None]]:
    """Valores de todas as variáveis, por amostra (para a tabela de amostras)."""
    out: dict[int, dict[str, float | str | None]] = {s.id: {} for s in samples}  # type: ignore[misc]
    for var in list_for(session, project):
        for sid, v in values_of(session, var, samples).items():
            out[sid][var.key] = v
    return out


def out(session: Session, project: Project, var: SampleVariable, counts: dict[str, int] | None = None) -> dict:
    return {
        "id": var.id,
        "key": var.key,
        "builtin": var.builtin,
        "label": var.label,
        "kind": var.kind,
        "unit": var.unit,
        "description": var.description,
        "options": options_of(session, project, var),
        "options_editable": var.kind == "categoria" and var.builtin != "fraction",
        "can_delete": not var.builtin,
        "n_values": (counts or {}).get(var.key, 0),
    }


def _clean_label(label: str) -> str:
    label = re.sub(r"\s+", " ", label or "").strip()
    if not label:
        raise VariableError("Dê um nome à variável.")
    if len(label) > 80:
        raise VariableError("Nome da variável longo demais (até 80 caracteres).")
    return label


def _clean_options(options: list[str]) -> list[str]:
    seen: list[str] = []
    for o in options:
        o = re.sub(r"\s+", " ", o or "").strip()
        if not o:
            continue
        if len(o) > 60:
            raise VariableError(f'Categoria longa demais: "{o[:20]}…" (até 60 caracteres).')
        if o.lower() in (x.lower() for x in seen):
            raise VariableError(f'Categoria repetida: "{o}".')
        seen.append(o)
    if not seen:
        raise VariableError("Uma variável de categoria precisa de ao menos uma categoria.")
    if len(seen) > MAX_OPTIONS:
        raise VariableError(f"No máximo {MAX_OPTIONS} categorias.")
    return seen


def _check_unique_label(session: Session, project: Project, label: str, exclude_id: int | None = None) -> None:
    for v in session.exec(select(SampleVariable).where(SampleVariable.project_id == project.id)):
        if v.id != exclude_id and v.label.lower() == label.lower():
            raise VariableError(f'Já existe uma variável chamada "{v.label}".')


def create(session: Session, project: Project, *, label: str, kind: str, unit: str, options: list[str], description: str, user: str) -> SampleVariable:
    ensure_builtins(session, project)
    if kind not in KINDS:
        raise VariableError("Tipo de variável inválido (número ou categoria).")
    label = _clean_label(label)
    _check_unique_label(session, project, label)
    opts = _clean_options(options) if kind == "categoria" else []
    existing = session.exec(select(SampleVariable).where(SampleVariable.project_id == project.id)).all()
    var = SampleVariable(
        project_id=project.id,  # type: ignore[arg-type]
        key="novo",
        label=label,
        kind=kind,
        unit=(unit or "").strip()[:20] if kind == "numero" else "",
        options_json=json.dumps(opts, ensure_ascii=False),
        description=(description or "").strip()[:500],
        sort=max((v.sort for v in existing), default=0) + 1,
        created_by=user,
    )
    session.add(var)
    session.flush()
    var.key = f"v{var.id}"
    session.add(var)
    return var


def update(
    session: Session,
    project: Project,
    var: SampleVariable,
    *,
    label: str | None = None,
    unit: str | None = None,
    description: str | None = None,
    options: list[str] | None = None,
    renames: dict[str, str] | None = None,
) -> None:
    """Nome, unidade, descrição e (categoria criada pelas pessoas) as
    categorias. `renames` = {nome antigo: nome novo}: os valores das amostras
    acompanham. Tirar uma categoria em uso é recusado."""
    if label is not None:
        label = _clean_label(label)
        _check_unique_label(session, project, label, var.id)
        var.label = label
    if unit is not None and var.kind == "numero":
        var.unit = unit.strip()[:20]
    if description is not None:
        var.description = description.strip()[:500]
    if options is not None:
        if var.kind != "categoria" or var.builtin:
            raise VariableError("As categorias desta variável não se editam aqui." if var.builtin else "Só variáveis de categoria têm categorias.")
        new = _clean_options(options)
        renames = {k: v for k, v in (renames or {}).items() if k != v}
        rows = session.exec(select(SampleVariableValue).where(SampleVariableValue.variable_id == var.id)).all()
        for r in rows:
            if r.text in renames:
                r.text = renames[r.text]
                session.add(r)
        in_use: dict[str, int] = {}
        for r in rows:
            if r.text:
                in_use[r.text] = in_use.get(r.text, 0) + 1
        missing = [f'"{k}" ({n} amostra(s))' for k, n in in_use.items() if k not in new]
        if missing:
            raise VariableError("Categoria em uso não pode sair — mude antes as amostras: " + ", ".join(missing) + ".")
        var.options_json = json.dumps(new, ensure_ascii=False)
    session.add(var)


def delete(session: Session, var: SampleVariable) -> int:
    if var.builtin:
        raise VariableError("Variável do tipo de amostra — não pode ser apagada (o nome e a unidade podem mudar).")
    n = len(session.exec(select(SampleVariableValue.id).where(SampleVariableValue.variable_id == var.id)).all())
    session.exec(sa_delete(SampleVariableValue).where(SampleVariableValue.variable_id == var.id))  # type: ignore[arg-type]
    session.delete(var)
    return n


def parse_value(var: SampleVariable, raw: object, allowed: list[str]) -> float | str | None:
    """Texto/valor digitado → valor da variável (None = sem valor)."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    if var.kind == "numero":
        if isinstance(raw, bool):
            raise VariableError(f"{var.label}: valor inválido.")
        if isinstance(raw, (int, float)):
            return float(raw)
        try:
            return float(str(raw).strip().replace(",", "."))
        except ValueError:
            raise VariableError(f'{var.label}: "{raw}" não é um número.') from None
    text = str(raw).strip()
    for a in allowed:
        if a.lower() == text.lower():
            return a
    raise VariableError(f'{var.label}: "{text}" não é uma das categorias ({", ".join(allowed)}).')


def set_value(session: Session, project: Project, var: SampleVariable, sample: Sample, raw: object) -> None:
    allowed = [o["value"] for o in options_of(session, project, var)]
    if var.builtin == "fraction":
        labels = {o["label"].lower(): o["value"] for o in options_of(session, project, var)}
        if isinstance(raw, str) and raw.strip().lower() in labels:
            raw = labels[raw.strip().lower()]
    value = parse_value(var, raw, allowed)
    if var.builtin == "temperature":
        sample.temperature_c = value  # type: ignore[assignment]
        session.add(sample)
        return
    if var.builtin == "fraction":
        if value is None:
            raise VariableError("Tipo: escolha um tipo (não pode ficar vazio).")
        sample.fraction = str(value)
        session.add(sample)
        return
    row = session.exec(select(SampleVariableValue).where(SampleVariableValue.variable_id == var.id, SampleVariableValue.sample_id == sample.id)).first()
    if value is None:
        if row is not None:
            session.delete(row)
        return
    row = row or SampleVariableValue(variable_id=var.id, sample_id=sample.id)  # type: ignore[arg-type]
    if var.kind == "numero":
        row.number, row.text = float(value), ""
    else:
        row.number, row.text = None, str(value)
    session.add(row)


def apply_imported(session: Session, project: Project, sample: Sample, items: list[dict], user: str) -> int:
    """Valores de variáveis que vêm no próprio arquivo importado (Estudo do
    PostRun: "Fração PP" = 50 %, "Composição" = "PP 50 % · PS 50 %").

    A variável é achada pelo NOME (sem diferenciar maiúsculas) e criada se
    não existir (número com unidade, ou categoria). Categoria nova ganha a
    opção que faltar. Reimportar regrava o valor (vale o arquivo). Variável
    com o mesmo nome e outro tipo, ou categoria cheia: fica como está.
    Devolve quantos valores foram gravados."""
    existing = {v.label.lower(): v for v in list_for(session, project)}
    n = 0
    for item in items:
        label = re.sub(r"\s+", " ", str(item.get("label") or "")).strip()[:80]
        kind = item.get("kind") or "numero"
        value = item.get("value")
        if not label or kind not in KINDS or value is None or (isinstance(value, str) and not value.strip()):
            continue
        var = existing.get(label.lower())
        if var is None:
            var = create(
                session,
                project,
                label=label,
                kind=kind,
                unit=str(item.get("unit") or ""),
                options=[str(value)] if kind == "categoria" else [],
                description=str(item.get("description") or ""),
                user=user,
            )
            existing[label.lower()] = var
        if var.kind != kind or var.builtin:
            continue
        if kind == "categoria":
            opts = json.loads(var.options_json or "[]")
            text = re.sub(r"\s+", " ", str(value)).strip()[:60]
            if text.lower() not in (o.lower() for o in opts):
                if len(opts) >= MAX_OPTIONS:
                    continue
                opts.append(text)
                var.options_json = json.dumps(opts, ensure_ascii=False)
                session.add(var)
            value = text
        try:
            set_value(session, project, var, sample, value)
        except VariableError:
            continue
        n += 1
    return n


def move_values(session: Session, sources: list[int], target: Sample) -> None:
    """Unir amostras: valores das que saem passam à que fica, quando ela não tem."""
    rows = session.exec(select(SampleVariableValue).where(SampleVariableValue.sample_id.in_(sources))).all()  # type: ignore[union-attr]
    have = {r.variable_id for r in session.exec(select(SampleVariableValue).where(SampleVariableValue.sample_id == target.id))}
    for r in rows:
        if r.variable_id in have:
            session.delete(r)
        else:
            r.sample_id = target.id  # type: ignore[assignment]
            have.add(r.variable_id)
            session.add(r)
