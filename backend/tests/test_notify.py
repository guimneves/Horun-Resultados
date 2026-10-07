"""Avisos pelo Core (Prompt_Horun_Modulo.md, seção 11): sem as variáveis de
ambiente, `notify` não faz nada e nunca quebra a requisição."""

from __future__ import annotations

from app.core import notify


def test_notify_is_noop_without_env(monkeypatch):
    monkeypatch.delenv("HORUN_CORE_URL", raising=False)
    monkeypatch.delenv("HORUN_NOTIFY_TOKEN", raising=False)
    assert notify.notify("x", levels=[1, 2]) is None


def test_notify_sends_in_background_and_swallows_errors(monkeypatch):
    monkeypatch.setenv("HORUN_CORE_URL", "http://127.0.0.1:9")  # porta fechada
    monkeypatch.setenv("HORUN_NOTIFY_TOKEN", "chave-de-teste")
    sent = []
    monkeypatch.setattr(notify, "_send", lambda url, token, payload: sent.append((url, payload)))
    thread = notify.notify("3 amostras importadas em P", levels=[1, 2], email=False)
    thread.join(timeout=2)
    assert sent[0][0] == "http://127.0.0.1:9"
    assert sent[0][1]["levels"] == [1, 2] and sent[0][1]["email"] is False
    assert notify.MODULE_ID == "resultados"
