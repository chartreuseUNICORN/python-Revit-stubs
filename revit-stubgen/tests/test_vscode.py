import json
from revitstubs.vscode import configure, _strip_jsonc


def test_strip_jsonc():
    src = '{\n // c\n "a": "x//y", /* b */ "b": [1,2,],\n}'
    assert json.loads(_strip_jsonc(src)) == {"a": "x//y", "b": [1, 2]}


def test_configure_merges(tmp_path):
    ws = tmp_path / "ws"
    (ws / ".vscode").mkdir(parents=True)
    (ws / ".vscode" / "settings.json").write_text('{ "editor.tabSize": 2, // keep\n "python.analysis.typeCheckingMode": "strict" }')
    stubs = ws / "revit-stubs" / "2025"
    stubs.mkdir(parents=True)
    out = configure(ws, stubs)
    s = json.loads(out.read_text())
    assert s["editor.tabSize"] == 2
    assert s["python.analysis.typeCheckingMode"] == "strict"
    assert s["python.analysis.stubPath"] == "${workspaceFolder}/revit-stubs/2025"
    assert s["python.analysis.diagnosticSeverityOverrides"]["reportMissingModuleSource"] == "none"
