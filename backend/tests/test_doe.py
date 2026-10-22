"""Planejamento fatorial (DOE) e resultados finais do ASE (22/10/2026).
Dados SINTÉTICOS — nada da planilha real do laboratório."""

from __future__ import annotations

import io
import math

import pytest

from app.services import doe, stats
from tests import synthetic as syn
from tests.conftest import COORD, IC, PESQ, TEC, add_members, confirm, upload
from tests.test_results import _rock

FACTORS = [
    {"name": "Número de ciclos", "unit": "ciclos", "kind": "discreto", "low": 3, "high": 6, "low_label": "3 × 10 min", "high_label": "6 × 10 min"},
    {"name": "Solvente", "kind": "categorico", "low": "DCM", "high": "DCM/MeOH 93:7"},
    {"name": "Temperatura", "unit": "°C", "kind": "continuo", "low": 100, "high": 120},
]


# ---------------------------------------------------------------- estatística


def test_distributions_match_tables():
    assert stats.t_quantile(0.975, 8) == pytest.approx(2.306004, abs=1e-5)
    assert stats.t_quantile(0.995, 3) == pytest.approx(5.840909, abs=1e-5)
    assert stats.t_pvalue(2.306004, 8) == pytest.approx(0.05, abs=1e-5)
    assert stats.f_pvalue(4.4590, 2, 8) == pytest.approx(0.05, abs=1e-4)
    assert stats.normal_ppf(0.975) == pytest.approx(1.959964, abs=1e-6)


def _y(coded, rep_sign):
    a, b, c = coded["A"], coded["B"], coded["C"]
    return 10 + 3 * a - 2 * b + 1.5 * a * b + 0.1 * rep_sign


def test_analysis_recovers_known_effects_with_replicates():
    factors = doe.clean_factors(FACTORS)
    obs = []
    for c in doe.conditions(factors):
        for sign in (1, -1):
            obs.append({"condition": c["code"], "y": _y(c["coded"], sign)})
    r = doe.analyze(factors, obs, 0.95)
    assert r["ok"] and r["df_resid"] == 8
    eff = {e["term"]: e for e in r["effects"]}
    assert eff["A"]["effect"] == pytest.approx(6) and eff["B"]["effect"] == pytest.approx(-4)
    assert eff["AB"]["effect"] == pytest.approx(3) and abs(eff["ABC"]["effect"]) < 1e-9
    assert r["mse"] == pytest.approx(0.02)
    assert eff["A"]["se_effect"] == pytest.approx(2 * math.sqrt(0.02 / 16))
    assert eff["A"]["significant"] and not eff["C"]["significant"]
    assert r["t_crit"] == pytest.approx(2.306004, abs=1e-5)
    assert r["r2"] > 0.99 and r["significance_note"] is None
    sources = [row["source"] for row in r["anova"]]
    assert sources[-2:] == ["Resíduo", "Total"]
    # efeitos principais: média alta − baixa = efeito
    a = next(m for m in r["main_effects"] if m["letter"] == "A")
    assert a["mean_high"] - a["mean_low"] == pytest.approx(6)
    # 99 % muda a linha crítica
    assert doe.analyze(factors, obs, 0.99)["t_crit"] == pytest.approx(stats.t_quantile(0.995, 8))


def test_single_run_per_condition_has_no_pvalues():
    factors = doe.clean_factors(FACTORS)
    obs = [{"condition": c["code"], "y": _y(c["coded"], 0)} for c in doe.conditions(factors)]
    r = doe.analyze(factors, obs)
    assert r["ok"] and r["df_resid"] == 0 and r["mse"] is None
    assert all("p" not in e for e in r["effects"])
    assert "não é possível concluir" in r["significance_note"]
    assert len(r["half_normal"]) == 7


def test_missing_condition_is_reported():
    factors = doe.clean_factors(FACTORS)
    obs = [{"condition": c["code"], "y": 1.0} for c in doe.conditions(factors) if c["code"] != "F03"]
    r = doe.analyze(factors, obs)
    assert not r["ok"] and r["missing_conditions"] == ["F03"]


def test_center_points_only_when_physically_possible():
    factors = doe.clean_factors(FACTORS)
    ok, why = doe.center_feasibility(factors)
    assert not ok and "categórico" in why and "4,5" in why
    with pytest.raises(doe.DoeError, match="Ponto central"):
        doe.plan_runs(factors, 2, 2, False, 0)
    cont = doe.clean_factors([{"name": "T", "low": 100, "high": 120}, {"name": "t", "low": 10, "high": 20}])
    runs = doe.plan_runs(cont, 2, 3, True, 42)
    assert len(runs) == 11 and sorted(r["planned_order"] for r in runs) == list(range(1, 12))
    assert doe.plan_runs(cont, 2, 3, True, 42) == runs  # mesma semente, mesma ordem
    # curvatura: centros acima do plano
    obs = [{"condition": c["code"], "y": 5 + c["coded"]["A"] + 0.05 * s} for c in doe.conditions(cont) for s in (1, -1)]
    obs += [{"condition": "C", "y": 8 + d} for d in (0.05, 0, -0.05)]
    r = doe.analyze(cont, obs)
    assert r["curvature"]["significant"] and r["curvature"]["mean_center"] == pytest.approx(8)
    assert next(e for e in r["effects"] if e["term"] == "A")["effect"] == pytest.approx(2)


# ---------------------------------------------------------------- API


@pytest.fixture
def ase_project(client):
    r = client.post("projects", json={"name": "ASE sintético", "profile": {"sample_type": "ase_extracao"}}, headers=COORD)
    assert r.status_code == 201, r.text
    add_members(client, r.json()["id"], PESQ, TEC, IC)
    return r.json()


def _create(client, pid, **extra):
    body = {"name": "Fatorial 2³", "factors": FACTORS, "replicates": 2, "code_template": "HPX_{cond}_R{rep}",
            "method": {"cell": "10 mL", "pressure": "1500 psi"}, **extra}
    r = client.post(f"projects/{pid}/doe", json=body, headers=PESQ)
    assert r.status_code == 201, r.text
    return r.json()


def test_plan_lifecycle_results_and_analysis(client, ase_project):
    pid = ase_project["id"]
    assert client.post(f"projects/{pid}/doe", json={"name": "x", "factors": FACTORS, "center_points": 1}, headers=PESQ).status_code == 400
    assert client.post(f"projects/{pid}/doe", json={"name": "x", "factors": FACTORS}, headers=TEC).status_code == 403
    plan = _create(client, pid)
    assert plan["design"] == "2^3" and plan["n_runs"] == 16 and plan["n_done"] == 0 and not plan["center_possible"]
    assert plan["conditions_matrix"][1]["levels"] == {"A": "6 × 10 min", "B": "DCM", "C": "100 °C"}
    assert plan["runs"][0]["code"] == "HPX_F01_R1"

    runs = {(r["condition"], r["replicate"]): r for r in plan["runs"]}
    for c in plan["conditions_matrix"]:
        for rep, sign in ((1, 1), (2, -1)):
            m1 = _y(c["coded"], sign) * 10
            body = {"results": {"m1_mg": m1, "y_m1": m1 / 2, "m6_mg": m1 + 20, "solvent_ml": "25,0", "solvent_ml_kind": "estimado",
                                "time_min": 40 if c["coded"]["A"] < 0 else 73}}
            r = client.patch(f"projects/{pid}/doe/{plan['id']}/runs/{runs[(c['code'], rep)]['id']}", json=body, headers=PESQ)
            assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["n_done"] == 16
    run = next(x for x in plan["runs"] if x["condition"] == "F01" and x["replicate"] == 1)
    assert run["values"]["eff_solvent"] == pytest.approx(run["values"]["m1_mg"] / 25)
    assert run["values"]["rec_m6"] == pytest.approx(run["values"]["m1_mg"] / run["values"]["m6_mg"] * 100)
    assert run["actual_order"] is not None
    f01 = next(c for c in plan["conditions"] if c["code"] == "F01")
    st = f01["stats"]["m1_mg"]
    assert st["n"] == 2 and st["sd"] == pytest.approx(math.sqrt(2) * 1.0) and st["rsd"] is not None
    assert f01["stats"]["m4_mg"] == {"n": 0, "mean": None, "sd": None, "rsd": None}  # ausente, nunca zero

    an = client.get(f"projects/{pid}/doe/{plan['id']}/analysis?response=m1_mg&confidence=0.9", headers=IC).json()
    eff = {e["term"]: e["effect"] for e in an["effects"]}
    assert an["ok"] and eff["A"] == pytest.approx(60) and an["response"]["unit"] == "mg"
    assert client.get(f"projects/{pid}/doe/{plan['id']}/analysis?response=nada", headers=IC).status_code == 400

    # inválida sai da análise
    client.patch(f"projects/{pid}/doe/{plan['id']}/runs/{run['id']}", json={"valid": False}, headers=PESQ)
    an = client.get(f"projects/{pid}/doe/{plan['id']}/analysis?response=m1_mg", headers=IC).json()
    assert an["n_runs"] == 15

    # réplicas: tirar R2 com dados é recusado; acrescentar R3 cria 8 execuções
    assert client.patch(f"projects/{pid}/doe/{plan['id']}", json={"replicates": 1}, headers=PESQ).status_code == 400
    p3 = client.patch(f"projects/{pid}/doe/{plan['id']}", json={"replicates": 3}, headers=PESQ).json()
    assert p3["n_runs"] == 24 and p3["n_done"] == 16
    assert client.delete(f"projects/{pid}/doe/{plan['id']}", headers=PESQ).status_code == 204
    assert client.get(f"projects/{pid}/doe", headers=PESQ).json()["plans"] == []


def test_only_in_ase_projects(client, project):
    r = client.post(f"projects/{project['id']}/doe", json={"name": "x", "factors": FACTORS}, headers=PESQ)
    assert r.status_code == 400 and "Extração ASE" in r.json()["detail"]


def test_rockeval_post_and_pre_linked_without_retyping(client, ase_project):
    pid = ase_project["id"]
    htm = syn.rockeval_htm([
        {**_rock("r1", "HPX_F01_R1", 2.0), "s1": 0.5, "s2": 4.0},
        {**_rock("r2", "HPX_F01_R1", 2.0), "s1": 0.7, "s2": 4.0},  # repetição analítica: média
        {**_rock("r3", "ROCHA_PRE", 3.0), "s1": 2.4, "s2": 8.0},
    ])
    confirm(client, pid, upload(client, pid, {"re.htm": htm}))
    samples = {s["code"]: s for s in client.get(f"projects/{pid}/samples", headers=PESQ).json()["samples"]}
    assert samples["HPX_F01_R1"]["fraction"] == "RES" and samples["ROCHA_PRE"]["fraction"] == "PRE"
    plan = _create(client, pid, pre_sample_id=samples["ROCHA_PRE"]["id"])
    run = next(r for r in plan["runs"] if r["condition"] == "F01" and r["replicate"] == 1)
    assert run["sample_linked_by"] == "código"
    assert run["values"]["re_S1"] == pytest.approx(0.6) and run["values"]["red_S1"] == pytest.approx(75)
    assert run["values"]["re_TOC"] == pytest.approx(2.0) and run["values"]["red_TOC"] == pytest.approx(100 / 3)
    other = next(r for r in plan["runs"] if r["condition"] == "F02")
    assert other["values"]["re_S1"] is None and other["values"]["red_S1"] is None
    fields = {f["key"]: f for f in plan["fields"]}
    assert fields["re_S1"]["n"] == 1 and fields["m1_mg"]["n"] == 0


def _consolidated_xlsx() -> bytes:
    import openpyxl

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for rep in (1, 2):
        ws = wb.create_sheet(f"Consolidado R{rep}")
        ws.append([f"Consolidado — Réplica {rep}"])
        ws.append([])
        ws.append([])
        ws.append(["Condição", None] + [f"F{i:02d}" for i in range(1, 9)] + ["Maior valor", "Menor valor"])
        ws.append(["Código", None] + [f"COD_F{i:02d}_R{rep}" for i in range(1, 9)])
        ws.append(["Variável", "Unidade"])
        ws.append(["RESULTADOS PRINCIPAIS"])
        ws.append(["Massa de betume extraído (frasco) — CORRIGIDA pelo branco (M1)", "mg"] + [100 + i + rep for i in range(8)])
        ws.append(["Massa de betume extraído (frasco) — SEM correção (M1)", "mg"] + [999] * 8)
        ws.append(["Rendimento de betume — CORRIGIDO (M1)", "mg/g"] + [50 + i for i in range(8)])
        ws.append(["Massa removida — ① rocha pura pré − pós (M6)  [branco não se aplica]", "mg"] + ["#REF!"] + [200] * 7)
        ws.append(["Massa removida — ② papel + rocha pré − pós (M3) — CORRIGIDA pelo branco", "mg"] + [None] * 8)
        ws.append(["Volume de solvente (estimado pela densidade)", "mL"] + [26.5] * 8)
        ws.append(["Tempo total de extração", "min"] + [40, 73] * 4)
        ws.append(["DADOS DE BASE"])
        ws.append(["Massa real de rocha", "g"] + [2.0] * 8)
        ws.append(["MÉTODO 6 · Perda de massa da rocha pura pesada pré e pós"])
        ws.append(["Massa removida da rocha", "mg"] + [200] * 8)
        ws.append(["Rendimento", "mg/g"] + [100] * 8)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_import_consolidated_sheet(client, ase_project):
    pid = ase_project["id"]
    plan = _create(client, pid, code_template="")
    files = {"file": ("res.xlsx", _consolidated_xlsx(), "application/octet-stream")}
    pv = client.post(f"projects/{pid}/doe/{plan['id']}/import", files=files, data={"dry_run": "true"}, headers=PESQ).json()
    assert pv["sheets"] == 2 and len(pv["rows"]) == 16 and any("#REF!" in w for w in pv["warnings"])
    assert client.get(f"projects/{pid}/doe/{plan['id']}", headers=PESQ).json()["n_done"] == 0
    r = client.post(f"projects/{pid}/doe/{plan['id']}/import", files=files, data={"dry_run": "false"}, headers=PESQ)
    assert r.status_code == 200, r.text
    plan = client.get(f"projects/{pid}/doe/{plan['id']}", headers=PESQ).json()
    run = next(x for x in plan["runs"] if x["condition"] == "F02" and x["replicate"] == 2)
    v = run["values"]
    assert v["m1_mg"] == 103 and v["y_m1"] == 51 and v["m6_mg"] == 200 and v["solvent_ml"] == 26.5
    assert run["solvent_ml_kind"] == "estimado" and v["time_min"] == 73 and v["rock_mass_g"] == 2.0 and v["y_m6"] == 100
    assert v["m3_mg"] is None and run["code"] == "COD_F02_R2"
    f01 = next(x for x in plan["runs"] if x["condition"] == "F01" and x["replicate"] == 1)
    assert f01["values"]["m6_mg"] is None  # #REF! ficou de fora
    bad = client.post(f"projects/{pid}/doe/{plan['id']}/import", files={"file": ("x.xlsx", b"nada", "application/octet-stream")}, headers=PESQ)
    assert bad.status_code == 400
