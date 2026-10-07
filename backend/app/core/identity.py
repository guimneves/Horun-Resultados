"""Identidade do usuário autenticado.

Em produção, o módulo roda atrás do Horun Core e nunca fica exposto direto à
rede do laboratório. O Core valida o login e repassa a identidade em
cabeçalhos internos confiáveis (X-Horun-User-Id/X-Horun-User/X-Horun-Role e o
cargo em X-Horun-Level) — Prompt_Horun_Modulo.md, seção 5. O Core descarta
qualquer versão desses cabeçalhos vinda do navegador.

Em desenvolvimento standalone (HORUN_DEV_MODE=true) não há Core: sem
cabeçalhos, a pessoa é o administrador máximo fixo "dev". Se o frontend mandar
os cabeçalhos por conta própria (seletor "Ver como", só no `npm run dev`),
eles são respeitados — para ver o módulo como coordenador ou colaborador sem
o Core. Nunca acontece em produção, onde DEV_MODE é sempre false.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import Header, HTTPException, status

DEV_MODE = os.environ.get("HORUN_DEV_MODE", "false").lower() == "true"

# Cargos do Horun Core — Prompt_Horun_Modulo.md, seção 5.
LEVEL_ADMIN = 1  # administrador máximo
LEVEL_COORDENADOR = 2  # coordenador(a)
LEVEL_IC = 5  # iniciação científica (ou sem posição) — o menor nível
LEVEL_NAMES = {1: "admin", 2: "coordenador", 3: "pesquisador", 4: "tecnico", 5: "ic"}


def parse_level(raw: str | None, role: str) -> int:
    """Nível a partir de X-Horun-Level. Sem o cabeçalho (Core antigo) ou com
    valor inválido: X-Horun-Role "admin" conta como coordenador(a) (nível 2 —
    o Core manda "admin" para os níveis 1 e 2); qualquer outro, nível 5."""
    try:
        level = int(str(raw).strip())
    except (TypeError, ValueError):
        level = 0
    if 1 <= level <= 5:
        return level
    return LEVEL_COORDENADOR if role == "admin" else LEVEL_IC


@dataclass
class HorunIdentity:
    user_id: str
    username: str
    role: str  # "admin" (níveis 1–2) ou "user"
    level: int = LEVEL_IC

    @property
    def level_name(self) -> str:
        return LEVEL_NAMES.get(self.level, "ic")


def get_identity(
    x_horun_user_id: str | None = Header(default=None),
    x_horun_user: str | None = Header(default=None),
    x_horun_role: str | None = Header(default=None),
    x_horun_level: str | None = Header(default=None),
) -> HorunIdentity:
    if DEV_MODE:
        if x_horun_user_id and x_horun_user:
            role = x_horun_role or "admin"
            return HorunIdentity(x_horun_user_id, x_horun_user, role, parse_level(x_horun_level, role))
        return HorunIdentity(user_id="dev", username="dev", role="admin", level=LEVEL_ADMIN)

    if not x_horun_user_id or not x_horun_user or not x_horun_role:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Identidade não informada — este módulo só deve ser acessado através do Horun Core.",
        )
    return HorunIdentity(x_horun_user_id, x_horun_user, x_horun_role, parse_level(x_horun_level, x_horun_role))
