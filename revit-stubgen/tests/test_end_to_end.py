"""Runs the whole pipeline against Python.Runtime.dll (ships in the `pythonnet` wheel)."""
import ast
import importlib.util
from pathlib import Path

import pytest

from revitstubs.cli import build


def _sample_dll():
    spec = importlib.util.find_spec("pythonnet")
    if spec and spec.origin:
        p = Path(spec.origin).parent / "runtime" / "Python.Runtime.dll"
        if p.exists():
            return p
    return None


@pytest.mark.skipif(_sample_dll() is None, reason="pip install pythonnet to get a sample assembly")
def test_pipeline(tmp_path):
    out = build([_sample_dll()], tmp_path / "stubs", "test")
    mod = out / "Python" / "Runtime" / "__init__.pyi"
    text = mod.read_text()
    ast.parse(text)  # valid Python syntax
    assert "class PyObject" in text
    assert "def __enter__(self)" in text          # IDisposable
    assert "@typing.overload" in text
    assert "enum.IntEnum" in text
    assert (out / "clr.pyi").exists() and (out / "_dotnet.pyi").exists()
    for pyi in out.rglob("*.pyi"):
        ast.parse(pyi.read_text())
