"""Perfil do projeto: QUE TIPO de amostra o projeto estuda, QUAIS análises
(equipamentos) ele importa e QUAIS parâmetros interessam.

Fundação (08/10/2026) para projetos além da maturação de rochas — tabaco,
incrustações etc. Desenho completo e próximos passos: docs/PERFIS_DE_PROJETO.md.

Por enquanto o perfil só é GUARDADO e VALIDADO (Project.profile_json, API de
projetos aceita/devolve "profile"); nada na importação, nas séries ou na tela
muda com ele. Projeto sem perfil gravado = perfil padrão do tipo
"rocha_hidropirolise", que é exatamente o comportamento de hoje.

Três peças:

* **Tipo de amostra** (`SAMPLE_TYPES`): como ler os códigos, quais frações
  existem, quais análises fazem sentido. Só "rocha_hidropirolise" está pronto;
  os outros estão registrados como "planejado" para o desenho não esquecê-los.
* **Receitas de importação** (`ImportRecipe`): uma por análise/equipamento —
  o leitor (app/parsers) e os parâmetros que ele produz. Hoje as receitas são
  as técnicas do catálogo (app/services/catalog.py). Receitas novas (ex.: um
  ICP para incrustações) serão "treinadas" depois, com arquivos de exemplo.
* **Perfil do projeto** (`ProjectProfile`): tipo de amostra + receitas
  escolhidas + parâmetros de interesse por receita.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from app.services.catalog import TECHNIQUES, param

PROFILE_VERSION = 1
DEFAULT_SAMPLE_TYPE = "rocha_hidropirolise"


@dataclass(frozen=True)
class ImportRecipe:
    """Como importar os resultados de UMA análise/equipamento."""

    key: str  # = chave da técnica no catálogo ("chnso", "leco"...)
    label: str
    instrument: str
    parser: str  # módulo em app/parsers que lê os arquivos
    status: str = "pronto"  # "pronto" | "planejado" (ainda sem leitor treinado)


# Receitas prontas = técnicas do catálogo, cada uma com o seu leitor.
_PARSER_OF = {
    "chnso": "chnso",
    "leco": "leco",
    "rockeval": "rockeval",
    "gc_fid": "gc",
    "gc_tcd": "gc",
    "gas_balanco": "gc",
    "pygcms": "pygcms",
}

RECIPES: dict[str, ImportRecipe] = {
    key: ImportRecipe(key=key, label=info["label"], instrument=info.get("instrument", ""), parser=_PARSER_OF.get(key, key))
    for key, info in TECHNIQUES.items()
}


@dataclass(frozen=True)
class SampleType:
    key: str
    label: str
    description: str
    code_reader: str  # quem interpreta os códigos das amostras (app/services/codes.py hoje)
    recipes: tuple[str, ...]  # análises que fazem sentido para este tipo (padrão do perfil)
    status: str = "pronto"  # "pronto" | "planejado"


SAMPLE_TYPES: dict[str, SampleType] = {
    "rocha_hidropirolise": SampleType(
        key="rocha_hidropirolise",
        label="Rocha — maturação artificial (hidropirólise)",
        description="Rocha geradora, frações H/E/SE/G por temperatura; códigos HP300H, HP355NBE...",
        code_reader="codes.parse_code",
        recipes=tuple(RECIPES),
    ),
    # Planejados: só registram a intenção. Receitas, leitura de códigos e
    # parâmetros serão definidos com o laboratório (docs/PERFIS_DE_PROJETO.md).
    "tabaco": SampleType(
        key="tabaco",
        label="Tabaco",
        description="A definir com o laboratório.",
        code_reader="",
        recipes=("chnso",),
        status="planejado",
    ),
    "incrustacao": SampleType(
        key="incrustacao",
        label="Incrustações",
        description="A definir com o laboratório.",
        code_reader="",
        recipes=("chnso",),
        status="planejado",
    ),
}


@dataclass
class ProjectProfile:
    sample_type: str = DEFAULT_SAMPLE_TYPE
    recipes: list[str] = field(default_factory=list)  # vazio = as do tipo de amostra
    # parâmetros de interesse por receita; receita ausente = os "main" do catálogo
    parameters: dict[str, list[str]] = field(default_factory=dict)
    version: int = PROFILE_VERSION

    def resolved(self) -> dict:
        """Perfil completo, com os padrões preenchidos (o que o resto do módulo usará)."""
        st = SAMPLE_TYPES[self.sample_type]
        recipes = self.recipes or list(st.recipes)
        params = {
            r: self.parameters.get(r) or [p.key for p in TECHNIQUES.get(r, {}).get("params", []) if p.main]
            for r in recipes
        }
        return {
            "version": self.version,
            "sample_type": self.sample_type,
            "sample_type_label": st.label,
            "recipes": recipes,
            "parameters": params,
        }


class ProfileError(ValueError):
    """Perfil inválido — a mensagem vai direto para a pessoa."""


def validate(data: dict | None) -> ProjectProfile:
    """Confere um perfil vindo da API (ou do banco) e devolve o objeto."""
    data = data or {}
    sample_type = data.get("sample_type") or DEFAULT_SAMPLE_TYPE
    if sample_type not in SAMPLE_TYPES:
        raise ProfileError(f'Tipo de amostra desconhecido: "{sample_type}".')
    if SAMPLE_TYPES[sample_type].status != "pronto":
        raise ProfileError(f'O tipo de amostra "{SAMPLE_TYPES[sample_type].label}" ainda não está pronto.')
    recipes = list(dict.fromkeys(data.get("recipes") or []))
    for r in recipes:
        if r not in RECIPES:
            raise ProfileError(f'Análise desconhecida: "{r}".')
    parameters = data.get("parameters") or {}
    if not isinstance(parameters, dict):
        raise ProfileError("Parâmetros devem ser um dicionário análise → lista.")
    allowed = recipes or list(SAMPLE_TYPES[sample_type].recipes)
    clean: dict[str, list[str]] = {}
    for r, keys in parameters.items():
        if r not in allowed:
            raise ProfileError(f'Parâmetros para uma análise fora do perfil: "{r}".')
        for k in keys:
            if param(r, k) is None:
                raise ProfileError(f'Parâmetro desconhecido: "{r}.{k}".')
        clean[r] = list(dict.fromkeys(keys))
    return ProjectProfile(sample_type=sample_type, recipes=recipes, parameters=clean)


def load(profile_json: str | None) -> ProjectProfile:
    """Perfil gravado no projeto; vazio/ilegível → padrão (comportamento de hoje)."""
    if not profile_json:
        return ProjectProfile()
    try:
        return validate(json.loads(profile_json))
    except (ValueError, TypeError):
        return ProjectProfile()


def dump(profile: ProjectProfile) -> str:
    return json.dumps(
        {"version": profile.version, "sample_type": profile.sample_type, "recipes": profile.recipes, "parameters": profile.parameters},
        ensure_ascii=False,
    )


def options_json() -> dict:
    """O que existe para montar um perfil (GET /api/profiles) — base da futura tela."""
    return {
        "default_sample_type": DEFAULT_SAMPLE_TYPE,
        "sample_types": [
            {"key": s.key, "label": s.label, "description": s.description, "recipes": list(s.recipes), "status": s.status}
            for s in SAMPLE_TYPES.values()
        ],
        "recipes": [{"key": r.key, "label": r.label, "instrument": r.instrument, "status": r.status} for r in RECIPES.values()],
    }
