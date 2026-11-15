# P1 tests (15 Nov 2026)

`backend/.venv/bin/python -m pytest tests/v3 -q -rA`

```
PASSED tests/v3/test_core_v3.py::test_coverage_union
PASSED tests/v3/test_core_v3.py::test_keep_usable_zero
PASSED tests/v3/test_core_v3.py::test_keep_usable_zero_in_s06
PASSED tests/v3/test_core_v3.py::test_missing_not_zero
PASSED tests/v3/test_core_v3.py::test_missing_not_zero_in_api_json
PASSED tests/v3/test_core_v3.py::test_grid_decimal
PASSED tests/v3/test_core_v3.py::test_lmst_rollover
PASSED tests/v3/test_core_v3.py::test_conformal_nested
PASSED tests/v3/test_core_v3.py::test_interval_inversion
PASSED tests/v3/test_core_v3.py::test_window_union
PASSED tests/v3/test_core_v3.py::test_mk_ties
PASSED tests/v3/test_core_v3.py::test_log_rate_zero
PASSED tests/v3/test_core_v3.py::test_bootstrap_block
PASSED tests/v3/test_core_v3.py::test_aoi_hash
PASSED tests/v3/test_core_v3.py::test_no_clip
PASSED tests/v3/test_core_v3.py::test_year_count_per_month
16 passed, 1 warning in 1.62s
```

Backend suite: 42 passed. Pipeline suite: 4 passed.
