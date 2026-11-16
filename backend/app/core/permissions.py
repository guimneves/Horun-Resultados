"""Autorização dentro do módulo (ESPECIFICACAO.md, seção 7) — mesma regra do
Financeiro (`module_mode()/core_role()`), sem cadastro de membros nem senha:

* o papel vem do CARGO no Horun (`X-Horun-Level`): níveis 1 (administrador
  máximo) e 2 (coordenador/a) = **coordenador**; qualquer outra pessoa que
  chegou ao módulo (o Core já conferiu o acesso) = **colaborador**;
* quem pode IMPORTAR, CRIAR e EDITAR (`can_edit`, ampliado em 16/11/2026 a
  pedido do mantenedor — antes eram só os níveis 1–3): todos os níveis, 1–5,
  inclusive técnico(a) (4) e IC (5) — importam resultados, criam e editam
  amostras, corridas, massas, variáveis e os planejamentos/métodos do ASE,
  lançam resultados do ASE, ligam nomes lembrados (sempre só nos projetos em
  que são membros, ver abaixo);
* quem CUIDA dos dados (`can_curate`, níveis 1–3: administrador,
  coordenador/a, pesquisador/a): validar/invalidar amostras e medições
  (decisão de 08/10/2026), excluir amostras, medições, corridas, variáveis e
  planejamentos, unir amostras e escolher as vistas da aba Séries — técnico(a)
  e IC não fazem nada disso;
* coordenador: além disso cria/edita/arquiva projetos e edita a tabela de
  frações;
* histórico (quem fez o quê): administrador máximo e coordenadores (níveis 1–2);
* excluir projeto: só o administrador máximo (nível 1), digitando o nome;
* acesso por projeto (pedido do mantenedor, 08/10/2026): níveis 1–2 veem e
  abrem TODOS os projetos; níveis 3–5 só os projetos em que são membros
  (`ProjectMember`). Coordenadores e pesquisadores (estes dentro dos projetos
  em que estão) adicionam e removem pesquisadores, técnicos e ICs. A regra usa sempre o cargo ATUAL (X-Horun-Level).

No desenvolvimento (HORUN_DEV_MODE=true) vale a mesma regra; o seletor
"Ver como" do frontend troca o nível mandando os cabeçalhos.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core import identity as identity_module
from app.core.identity import LEVEL_ADMIN, LEVEL_COORDENADOR, LEVEL_IC, LEVEL_PESQUISADOR, HorunIdentity, get_identity

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
    """Pode importar, criar e editar resultados e métodos? Todos os níveis (1–5)
    desde 16/11/2026 — técnico(a) e IC inclusive."""
    return identity.level <= LEVEL_IC


def require_editor(identity: HorunIdentity = Depends(get_identity)) -> HorunIdentity:
    if not can_edit(identity):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Seu cargo no Horun não permite alterar os resultados.")
    return identity


def can_curate(identity: HorunIdentity) -> bool:
    """Valida/invalida, exclui e une? Níveis 1–3; técnico(a) e IC não."""
    return identity.level <= LEVEL_PESQUISADOR


def require_curator(identity: HorunIdentity = Depends(get_identity)) -> HorunIdentity:
    if not can_curate(identity):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Validar, excluir e unir é com pesquisadores e coordenadores; técnicos e ICs importam e editam.",
        )
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


def sees_all_projects(identity: HorunIdentity) -> bool:
    """Administrador máximo e coordenadores veem e abrem todos os projetos."""
    return identity.level <= LEVEL_COORDENADOR


def member_levels_manageable(identity: HorunIdentity) -> tuple[int, ...]:
    """Cargos que esta pessoa pode adicionar/remover como membro de um projeto:
    coordenadores e pesquisadores → pesquisadores, técnicos e ICs (pedido do
    usuário, 20/10/2026: pesquisadores também põem outros pesquisadores);
    técnicos e ICs → ninguém. Coordenadores nunca entram como membro (já veem tudo)."""
    if identity.level <= LEVEL_PESQUISADOR:
        return (3, 4, 5)
    return ()


def can_manage_members(identity: HorunIdentity) -> bool:
    return bool(member_levels_manageable(identity))
