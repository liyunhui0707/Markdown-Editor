import sys
from pathlib import Path

import pytest

_PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PLUGIN_ROOT / "bin"))


@pytest.fixture
def plugin_root() -> Path:
    return _PLUGIN_ROOT


@pytest.fixture
def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]
