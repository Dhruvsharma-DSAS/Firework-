from datetime import date

from app.countries import country_of
from pipeline.build_calendar import baseline_k, cell_id, chunk_starts, local_date, passes_rule


def test_country_lookup():
    assert country_of(30.9, 75.85) == ("India", "IND")
    assert country_of(-12.4, 27.8)[1] == "ZMB"
    assert country_of(0.0, -30.0) == (None, None)


def test_cell_id_matches_atlas_field_card():
    assert cell_id(30.9, 75.85) == "1209_2558"


def test_cell_id_edge_rounds_before_floor():
    assert cell_id(30.1, 75.3) == "1201_2553"


def test_local_date_wraps_to_next_day():
    assert local_date("2026-11-01", "2330", 75.85) == date(2026, 11, 2)
    assert local_date("2026-11-01", "0806", 75.85) == date(2026, 11, 1)


def test_confidence_rule_is_sensor_native():
    assert passes_rule("MODIS_SP", {"confidence": "30", "type": "0"})
    assert not passes_rule("MODIS_SP", {"confidence": "29", "type": "0"})
    assert passes_rule("VIIRS_SNPP_SP", {"confidence": "n", "type": "0"})
    assert not passes_rule("VIIRS_SNPP_SP", {"confidence": "l", "type": "0"})
    assert not passes_rule("VIIRS_SNPP_SP", {"confidence": "h", "type": "3"})


def test_chunks_cover_the_month_in_five_day_steps():
    starts = chunk_starts(2016, 11, date(2012, 1, 20))
    assert starts[0] == date(2016, 10, 31)
    assert all((b - a).days == 5 for a, b in zip(starts, starts[1:]))
    assert starts[-1] >= date(2016, 11, 26)


def test_chunks_skip_dates_before_archive_start():
    assert chunk_starts(2012, 1, date(2012, 1, 20))[0] >= date(2012, 1, 16)


def test_baseline_k_median_and_interval():
    v = {2012 + i: 300 for i in range(10)}
    m = {2012 + i: 100 for i in range(10)}
    k = baseline_k(v, m)
    assert k["k"] == 3.0 and k["lo"] == 3.0 and k["hi"] == 3.0 and k["level"] == 0.95


def test_baseline_k_needs_three_years():
    assert baseline_k({2012: 5, 2013: 6}, {2012: 2, 2013: 3}) is None
