"""GC-FID (.gcd) e GC-MS (.qgd) da Shimadzu (21/10/2026) — blocos internos
SINTÉTICOS com a mesma estrutura dos arquivos do laboratório (nenhum dado
real): File Property, status/intensidade do FID, tabela de picos e TIC do MS."""

import math
import random
import struct
from datetime import datetime

import pytest

from app.parsers import parse_file, shimadzu as s
from app.parsers.common import ParseError


def _file_property(name: str, when: datetime, method: str = "C:/Metodos/Metodo_Tabaco.qgm") -> bytes:
    b = bytearray(2600)
    b[4:9] = b"2.42"
    ft = int((when - datetime(1601, 1, 1)).total_seconds() * 10_000_000)
    struct.pack_into("<Q", b, 52, ft)
    b[204:204 + len(name)] = name.encode("cp1252")
    b[268:268 + len(name)] = name.encode("cp1252")
    path = f"C:\\Dados\\{name}.gcd".encode("cp1252")
    b[517:517 + len(path)] = path
    m = method.encode("cp1252")
    b[773:773 + len(m)] = m
    return bytes(b)


def _fid_streams(peaks, n=30000, dt_ms=40, noise=1.0, seed=1):
    rnd = random.Random(seed)
    dt = dt_ms / 1000
    y = []
    for i in range(n):
        t = i * dt
        v = 50 + 0.002 * t  # linha de base com deriva
        for center, height, width in peaks:
            v += height * math.exp(-0.5 * ((t - center) / width) ** 2)
        y.append(v + rnd.gauss(0, noise))
    return {
        "File Property": _file_property("Charuto Alfa_1", datetime(2026, 7, 23, 13, 27)),
        "GC Raw Data-1/Status": struct.pack("<3i", dt_ms, 10, n),
        "GC Raw Data-1/Intensity Data": struct.pack(f"<{n}d", *y),
    }


def test_file_property_fields():
    info = s.file_info(_file_property("Essencia Uva 2", datetime(2026, 7, 23, 13, 27)))
    assert info["sample_name"] == "Essencia Uva 2" and info["acquired"] == "2026-07-23 13:27"
    assert info["method"] == "Metodo_Tabaco.qgm" and info["path"].endswith(".gcd")


def test_fid_integration_finds_peaks_and_areas():
    # três picos gaussianos (centro s, altura, largura σ s): área = h·σ·√(2π)
    peaks = [(200.0, 1000.0, 2.0), (400.0, 500.0, 3.0), (408.0, 300.0, 1.5), (900.0, 2000.0, 2.5)]
    r = s.parse_fid(_fid_streams(peaks), "x.gcd")
    rec = r.records[0]
    assert rec.technique == "gcfid_tab" and rec.raw_name == "Charuto Alfa_1" and rec.analyzed_at == "2026-07-23 13:27"
    found = rec.data["peaks"]
    assert len(found) == 4, [p["rt_min"] for p in found]
    expected = [h * w * math.sqrt(2 * math.pi) for _c, h, w in peaks]
    for p, (c, _h, _w), area in zip(found, peaks, expected):
        assert abs(p["rt_min"] * 60 - c) < 0.2
        # o par de picos que se tocam (400/408 s) é cortado no vale: tolerância maior
        assert abs(p["area"] - area) / area < (0.15 if 395 < c < 410 else 0.03)
    assert abs(sum(p["area_pct"] for p in found) - 100) < 1e-6
    values = {v.parameter: v.value for v in rec.values}
    assert values["n_peaks"] == 4 and abs(values["rt_main_peak"] * 60 - 900) < 0.2
    assert len(rec.data["curve"]["t"]) <= 2 * s._MAX_CURVE_POINTS


def test_fid_only_noise_has_no_peaks():
    r = s.parse_fid(_fid_streams([]), "x.gcd")
    assert r.records[0].data["peaks"] == [] and r.warnings


def _ms_record(rt_min, area, similarity, name):
    r = bytearray(208)
    struct.pack_into("<ii", r, 0, 16, int(rt_min * 60000))
    struct.pack_into("<dd", r, 8, area, area / 2)
    struct.pack_into("<ii", r, 40, int((rt_min - 0.02) * 60000), int((rt_min + 0.02) * 60000))
    struct.pack_into("<h", r, 60, similarity)
    r[80:80 + len(name)] = name.encode("cp1252")
    return bytes(r)


def _ms_streams(rows, capacity=10):
    table = b"".join(_ms_record(*row) for row in rows) + bytes(208 * (capacity - len(rows)))
    info = struct.pack("<H", len(rows)) + bytes(110)
    n = 500
    rt = struct.pack(f"<{n}i", *[60000 + 300 * i for i in range(n)])
    tic = struct.pack(f"<{n}q", *[1000 + (50000 if 200 < i < 210 else 0) for i in range(n)])
    return {
        "File Property": _file_property("ESSENCIA_MENTA_1", datetime(2026, 7, 23, 13, 27)),
        "GCMS Data Processing/MC Peak Info": info,
        "GCMS Data Processing/MC Peak Table": table,
        "GCMS Raw Data/Retention Time": rt,
        "GCMS Raw Data/TIC Data": tic,
    }


def test_ms_compounds_targets_and_identification():
    rows = [
        (8.75, 2000.0, 98, "Propylene Glycol"),
        (11.5, 1000.0, 97, "Furfural"),
        (25.0, 500.0, 95, "5-Hydroxymethylfurfural"),
        (30.1, 1500.0, 92, "Pyridine, 3-(1-methyl-2-pyrrolidinyl)-, (S)-"),
        (31.0, 4000.0, 45, "Glycerin"),  # similaridade baixa: não conta como glicerol
        (40.0, 1000.0, 88, "Nicotinic acid"),  # não é nicotina
    ]
    r = s.parse_ms(_ms_streams(rows), "x.qgd")
    rec = r.records[0]
    assert rec.technique == "gcms_tab" and rec.raw_name == "ESSENCIA_MENTA_1"
    v = {x.parameter: x.value for x in rec.values}
    total = sum(a for _rt, a, _s, _n in rows)
    assert v["n_peaks"] == 6 and v["n_identified"] == 5
    assert v["pct_propylene_glycol"] == pytest.approx(100 * 2000 / total, abs=1e-3)
    assert v["pct_nicotine"] == pytest.approx(100 * 1500 / total, abs=1e-3)
    assert v["pct_glycerol"] == 0 and v["pct_furfural"] > 0 and v["pct_hmf"] > 0
    assert v["pct_identified"] == pytest.approx(100 * (total - 4000) / total, abs=1e-3)
    peaks = rec.data["peaks"]
    assert peaks[0]["name"] == "Propylene Glycol" and peaks[0]["target"] == "pct_propylene_glycol"
    assert len(rec.data["curve"]["t"]) == 500


def test_ms_without_processing_warns():
    st = _ms_streams([])
    r = s.parse_ms(st, "x.qgd")
    assert r.records[0].data["peaks"] == [] and "GCMSsolution" in r.warnings[0]


def test_broken_compound_file_is_a_clear_error():
    with pytest.raises(ParseError, match="composto do Windows"):
        parse_file("x.gcd", s.CFB_MAGIC + b"\x00" * 600)


def test_tobacco_profile_offers_gc(client):
    from tests.conftest import COORD

    r = client.post("projects", json={"name": "Tabaco GC", "profile": {"sample_type": "tabaco"}}, headers=COORD).json()
    assert {"gcfid_tab", "gcms_tab"} <= set(r["profile"]["recipes"])
    assert "pct_nicotine" in r["profile"]["parameters"]["gcms_tab"]


@pytest.mark.parametrize(("raw", "expected"), [
    ("di-julia_FID_0", "di-julia_0"), ("di-julia_MS_0", "di-julia_0"), ("Charuto Alfa MS 2", "Charuto Alfa 2"),
    ("Cigarro_GC-FID", "Cigarro"), ("MSALTA_1", "MSALTA_1"),
])
def test_detector_suffix_leaves_the_sample_name(raw, expected):
    assert s.sample_name(raw) == expected
