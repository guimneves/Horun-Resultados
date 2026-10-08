from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import routes_members, routes_projects, routes_results, routes_samples
from app.core.identity import DEV_MODE
from app.db.session import create_db_and_tables


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if DEV_MODE:
        logging.getLogger("uvicorn.error").warning(
            "HORUN_DEV_MODE=true: sem cabeçalhos, toda requisição é o administrador 'dev', SEM login. "
            "Use só em desenvolvimento e nunca exponha esta porta na rede."
        )
    # cria tabelas novas e roda as migrações defensivas (app/db/session.py)
    create_db_and_tables()
    yield


app = FastAPI(title="Horun · Resultados", version="0.1.0", lifespan=lifespan)

_FIELD_LABELS = {"name": "Nome", "code": "Código", "color": "Cor", "action": "Ação", "files": "Arquivos"}


@app.exception_handler(RequestValidationError)
async def _validation_error_pt(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Erro de validação (422) como UMA frase em português no `detail`."""
    messages = []
    for err in exc.errors():
        field = str(err["loc"][-1]) if err.get("loc") else "valor"
        label = _FIELD_LABELS.get(field, field)
        kind = err.get("type", "")
        text = {"missing": "é obrigatório", "string_too_short": "não pode ficar vazio", "string_too_long": "é longo demais"}.get(
            kind, "é inválido"
        )
        messages.append(f"{label}: {text}.")
    return JSONResponse(status_code=422, content={"detail": " ".join(messages) or "Dados inválidos."})


if DEV_MODE:
    # Só no desenvolvimento standalone: frontend (Vite) e backend em portas
    # diferentes. Plugado no Core, tudo roda na mesma origem — sem CORS.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

# Toda a API vive sob /api: plugado no Core, o gateway só encaminha ao backend
# o que começa com /m/resultados/api/... (Prompt_Horun_Modulo.md, seção 6).
for _router in (routes_projects.router, routes_members.router, routes_samples.router, routes_results.router):
    app.include_router(_router, prefix="/api")


@app.get("/health")
def health():
    # Sem autenticação — usado pelo Horun Core para o painel de status.
    return {"status": "ok", "module": "resultados"}
