"""Autorização dentro do módulo (ESPECIFICACAO.md, seção 7) — mesma regra do
Financeiro (`module_mode()/core_role()`), sem cadastro de membros nem senha:

* o papel vem do CARGO no Horun (`X-Horun-Level`): níveis 1 (administrador
  máximo) e 2 (coordenador/a) = **coordenador**; qualquer outra pessoa que
  chegou ao módulo (o Core já conferiu o acesso) = **colaborador**;
* quem pode MODIFICAR (`can_edit`, decisão de 08/10/2026): níveis 1–3
  (administrador, coordenador/a, pesquisador/a) importam, criam/editam e
  excluem amostras, experimentos e medições, ligam nomes lembrados;
* técnico(a) (nível 4) e IC (nível 5): só visualizam (tabelas, séries,
  gráficos, fichas, exportar CSV/XLSX) — nada de importar nem alterar;
* validar/invalidar amostras e medições: também níveis 1–3 (decisão de
  08/10/2026 — pesquisadores marcam válidas e inválidas);
* coordenador: além disso cria/edita/arquiva projetos e edita a tabela de
  frações;
* histórico (quem fez o quê): administrador máximo e coordenadores (níveis 1–2);
* excluir projeto: só o administrador máximo (nível 1), digitando o nome.

No desenvolvimento (HORUN_DEV_MODE=true) vale a mesma regra; o seletor
"Ver como" do frontend troca o nível mandando os cabeçalhos.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core import identity as identity_module
from app.core.identity import LEVEL_ADMIN, LEVEL_COORDENADOR, LEVEL_PESQUISADOR, HorunIdentity, get_identity

COORDENADOR = "coordenador"
COLABORADOR = "colaborador"


def module_mode() -> bool:
    """Atrás do Core (não desenvolvimento)? Lido a cada chamada, para os
    testes poderem ligar o DEV_MODE."""
    return not identity_module.DEV_MODE


def core_role(identity: HorunIdentity) -> str:
    """Papel no módulo pelo cargo no Horun: níveis 1–2 coordenam, o resto colabora."""
    return COORDENADOR if identity.level <= LEVEL_COORDENADOR else COLABORADOR


def can_edit(identity: HorunIdentity) -> bool:
    """Pode importar e alterar resultados? Níveis 1–3; técnico(a) e IC só veem."""
    return identity.level <= LEVEL_PESQUISADOR


def require_editor(identity: HorunIdentity = Depends(get_identity)) -> HorunIdentity:
    if not can_edit(identity):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Técnicos e ICs só visualizam os resultados.")
    return identity


def require_coordenador(identity: HorunIdentity = Depends(get_identity)) -> HorunIdentity:
    if core_role(identity) != COORDENADOR:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Ação restrita a coordenadores (administrador máximo ou coordenador(a) no Horun).",
        )
    return identity


def require_super_admin(identity: HorunIdentity = Depends(get_identity)) -> HorunIdentity:
    if identity.level != LEVEL_ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o administrador máximo do Horun pode excluir um projeto.")
    return identity


def can_see_history(identity: HorunIdentity) -> bool:
    """Histórico (quem fez o quê): administrador máximo e coordenadores (níveis 1–2)."""
    return identity.level <= LEVEL_COORDENADOR


def require_history_access(identity: HorunIdentity = Depends(get_identity)) -> HorunIdentity:
    if not can_see_history(identity):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Só o administrador máximo e os coordenadores veem o histórico.")
    return identity
