import json

from revitstubs.cli import main


def _touch(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")


def test_list_json(tmp_path, capsys):
    _touch(tmp_path / "Revit 2024" / "RevitAPI.dll")
    _touch(tmp_path / "Revit 2025" / "RevitAPI.dll")
    _touch(tmp_path / "Revit 2025" / "RevitAPIIFC.dll")
    (tmp_path / "Revit 2023").mkdir()
    assert main(["list", "--revit-root", str(tmp_path), "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert [d["year"] for d in data] == [2024, 2025]
    assert [d["dotnet_core"] for d in data] == [False, True]
    assert data[0]["optional_assemblies"] == []
    assert data[1]["optional_assemblies"] == ["RevitAPIIFC.dll"]
    assert data[0]["root"].endswith("Revit 2024")
    assert data[1]["root"].endswith("Revit 2025")


def test_list_json_empty(tmp_path, capsys):
    assert main(["list", "--revit-root", str(tmp_path), "--json"]) == 1
    assert json.loads(capsys.readouterr().out) == []
