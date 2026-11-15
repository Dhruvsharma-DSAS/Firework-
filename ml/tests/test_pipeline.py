import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from common import cell_index, local_solar_hour


def test_local_solar_hour_uses_longitude():
    hours = local_solar_hour(pd.Series([600]), pd.Series([90.0]))
    assert abs(hours.iloc[0] - 12.0) < 1e-9


def test_cell_index_rounds_before_floor():
    a = cell_index(pd.Series([0.3]), pd.Series([0.3]), 0.1)
    b = cell_index(pd.Series([0.1 + 0.2]), pd.Series([0.3]), 0.1)
    assert a.iloc[0] == b.iloc[0]


def test_model_cards_exist_after_training():
    models = Path(__file__).resolve().parents[1] / "models"
    assert (models / "source_classifier.card.json").exists()
    assert (models / "harmonise.card.json").exists()
