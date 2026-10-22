"""Estatística básica em Python puro (sem numpy/scipy, para não somar
dependências): distribuições t de Student e F (valor-p e quantil), mínimos
quadrados ordinários e escores normais. Usado pela análise de DOE
(app/services/doe.py). Precisão conferida em tests/test_doe.py contra
valores tabelados."""

from __future__ import annotations

import math


def _betacf(a: float, b: float, x: float) -> float:
    """Fração continuada da beta incompleta (Lentz modificado)."""
    tiny = 1e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c, d = 1.0, 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) > tiny else tiny)
    h = d
    for m in range(1, 400):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        d = 1.0 / (d if abs(d) > tiny else tiny)
        c = 1.0 + aa / c
        c = c if abs(c) > tiny else tiny
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-14:
            break
    return h


def betainc(a: float, b: float, x: float) -> float:
    """Beta incompleta regularizada I_x(a, b)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    ln = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
    front = math.exp(ln)
    if x < (a + 1) / (a + b + 2):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1 - x) / b


def t_pvalue(t: float, df: float) -> float:
    """Valor-p bilateral de t com `df` graus de liberdade."""
    if df <= 0 or not math.isfinite(t):
        return float("nan") if df <= 0 else 0.0
    return betainc(df / 2, 0.5, df / (df + t * t))


def t_quantile(p: float, df: float) -> float:
    """Quantil da t (ex.: p = 0,975 → t crítico bilateral de 95 %)."""
    if df <= 0:
        return float("nan")
    if not 0 < p < 1:
        raise ValueError("p fora de (0, 1)")
    if p < 0.5:
        return -t_quantile(1 - p, df)
    target = 2 * (1 - p)  # valor-p bilateral correspondente
    lo, hi = 0.0, 1.0
    while t_pvalue(hi, df) > target:
        hi *= 2
        if hi > 1e8:
            break
    for _ in range(200):
        mid = (lo + hi) / 2
        if t_pvalue(mid, df) > target:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-12 * max(1.0, hi):
            break
    return (lo + hi) / 2


def f_pvalue(f: float, d1: float, d2: float) -> float:
    """P(F > f) com (d1, d2) graus de liberdade."""
    if d1 <= 0 or d2 <= 0:
        return float("nan")
    if f <= 0:
        return 1.0
    return betainc(d2 / 2, d1 / 2, d2 / (d2 + d1 * f))


def normal_ppf(p: float) -> float:
    """Quantil da normal padrão (Acklam, erro relativo < 1e-9)."""
    if not 0 < p < 1:
        raise ValueError("p fora de (0, 1)")
    a = (-3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02, 1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00)
    b = (-5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02, 6.680131188771972e01, -1.328068155288572e01)
    c = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00, -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00)
    d = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00, 3.754408661907416e00)
    lo = 0.02425
    if p < lo:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p > 1 - lo:
        return -normal_ppf(1 - p)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)


def normal_scores(n: int) -> list[float]:
    """Escores normais esperados (Blom) para n pontos ordenados."""
    return [normal_ppf((i + 1 - 0.375) / (n + 0.25)) for i in range(n)]


def invert(m: list[list[float]]) -> list[list[float]] | None:
    """Inversa por Gauss-Jordan com pivoteamento parcial; None se singular."""
    n = len(m)
    a = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(m)]
    scale = max((abs(v) for row in m for v in row), default=1.0) or 1.0
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(a[r][col]))
        if abs(a[piv][col]) < 1e-12 * scale:
            return None
        a[col], a[piv] = a[piv], a[col]
        pv = a[col][col]
        a[col] = [v / pv for v in a[col]]
        for r in range(n):
            if r != col and a[r][col] != 0:
                f = a[r][col]
                a[r] = [v - f * w for v, w in zip(a[r], a[col])]
    return [row[n:] for row in a]


def ols(x: list[list[float]], y: list[float]) -> dict | None:
    """Mínimos quadrados: coeficientes, (X'X)^-1, ajustados, resíduos e
    alavancas (diagonal da matriz chapéu). None se X não tem posto cheio."""
    p = len(x[0])
    xtx = [[sum(r[i] * r[j] for r in x) for j in range(p)] for i in range(p)]
    inv = invert(xtx)
    if inv is None:
        return None
    xty = [sum(r[i] * yy for r, yy in zip(x, y)) for i in range(p)]
    beta = [sum(inv[i][j] * xty[j] for j in range(p)) for i in range(p)]
    fitted = [sum(b * v for b, v in zip(beta, r)) for r in x]
    resid = [yy - f for yy, f in zip(y, fitted)]
    lev = [sum(r[i] * inv[i][j] * r[j] for i in range(p) for j in range(p)) for r in x]
    return {"beta": beta, "inv": inv, "fitted": fitted, "resid": resid, "leverage": lev}
