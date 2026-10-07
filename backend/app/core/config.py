"""Configuração deste módulo, lida de variáveis de ambiente — mesmo padrão
dos outros módulos do Horun. Em produção (atrás do Horun Core),
MODULE_DATABASE_URL aponta para o PostgreSQL do módulo (`resultados-db`);
em desenvolvimento standalone, o SQLite local basta.

Este módulo não assina tokens nem guarda senhas (o papel vem do cargo no
Horun, ver core/permissions.py) — por isso não há MODULE_SECRET_KEY.
"""

from __future__ import annotations

import os


class Settings:
    def __init__(self) -> None:
        self.database_url: str = os.environ.get("MODULE_DATABASE_URL", "sqlite:///./resultados_dev.db")
        # Pasta dos arquivos originais enviados (PDF, CSV, HTM, XLSX) — vira um
        # volume Docker nomeado em produção, mesma disciplina do banco.
        self.upload_root: str = os.environ.get("MODULE_UPLOAD_ROOT", "./uploads")
        # Limite por arquivo enviado (MB). Um .zip conta pelo tamanho do .zip.
        self.max_upload_mb: int = int(os.environ.get("MODULE_MAX_UPLOAD_MB", "100"))


settings = Settings()
