"""Write/merge .vscode/settings.json so Pylance picks up the generated stubs."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict


def _strip_jsonc(text: str) -> str:
    """Remove // and /* */ comments and trailing commas (VS Code settings are JSONC)."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(text[i:j + 1])
            i = j + 1
        elif text.startswith("//", i):
            i = text.find("\n", i)
            i = n if i < 0 else i
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def load_settings(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8-sig")
    if not text.strip():
        return {}
    return json.loads(_strip_jsonc(text))


def configure(workspace: Path, stub_dir: Path, extra_paths=(), type_checking: str = "basic") -> Path:
    workspace = Path(workspace).resolve()
    settings_path = workspace / ".vscode" / "settings.json"
    settings = load_settings(settings_path)
    try:
        rel = Path(stub_dir).resolve().relative_to(workspace)
        stub_path = "${workspaceFolder}/" + rel.as_posix()
    except ValueError:
        stub_path = str(Path(stub_dir).resolve())
    settings["python.languageServer"] = "Pylance"
    settings["python.analysis.stubPath"] = stub_path
    settings.setdefault("python.analysis.typeCheckingMode", type_checking)
    settings.setdefault("python.analysis.useLibraryCodeForTypes", True)
    overrides = settings.setdefault("python.analysis.diagnosticSeverityOverrides", {})
    # The stubs have no accompanying source module: silence "could not be resolved from source".
    overrides.setdefault("reportMissingModuleSource", "none")
    if extra_paths:
        paths = settings.setdefault("python.analysis.extraPaths", [])
        for p in extra_paths:
            if p not in paths:
                paths.append(p)
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=4) + "\n", encoding="utf-8")
    return settings_path
