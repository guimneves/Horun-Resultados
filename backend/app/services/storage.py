"""Arquivos originais enviados — guardados no volume de uploads pelo sha256
(MODULE_UPLOAD_ROOT/ab/abcdef...). O mesmo conteúdo é guardado uma vez só."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from app.core.config import settings


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _path(digest: str) -> Path:
    return Path(settings.upload_root) / digest[:2] / digest


def save(content: bytes) -> str:
    digest = sha256(content)
    path = _path(digest)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(content)
        os.replace(tmp, path)
    return digest


def read(digest: str) -> bytes | None:
    path = _path(digest)
    return path.read_bytes() if path.exists() else None


def delete(digest: str) -> None:
    path = _path(digest)
    if path.exists():
        path.unlink()
