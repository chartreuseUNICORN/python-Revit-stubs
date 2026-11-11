# Changelog

## 0.1.0 — Unreleased

- Quick Setup command: private venv, offline install of the bundled `revit-stubgen` wheel, Revit detection, generation, configuration.
- Generate Stubs for Revit Year(s) command, run as a cancellable VS Code task.
- Select Revit Version picker and status bar item; `revitStubs.currentVersion` re-applies when edited by hand.
- Workspace-local and shared per-user stub stores, searched in that order.
- Pylance and Pyright support (`auto`, `pylance`, `pyright`) via the VS Code settings API; comments in `settings.json` survive.
- Remove Revit Stub Configuration command and Open Settings command.
- Settings: `currentVersion`, `workspaceStubsRoot`, `globalStubsRoot`, `languageServer`, `revitRoot`, `generate.extraArgs`.
- Status bar states for applied, missing stubs, missing language server, and failed settings writes.
- Multi-root workspaces: `python.languageServer` (window-scoped) is written to the workspace settings; `python.analysis.*` stays per folder.
- A failed settings write is reported once per distinct error, and editor switches never retry a failed write; config changes, new stub folders and explicit commands do.
- The private toolchain is reinstalled when the bundled wheel is rebuilt under the same version (marker records file name, size and mtime; pip runs with `--force-reinstall` so it does not skip the same-version wheel).

### Known limitations

- The bundled wheel is chosen by sorting file names as strings, and the Python probe expects exactly the executable and version on stdout; unusual names or noisy interpreters can mislead them.
- In a multi-root workspace the stub-folder watchers follow the last resolved folder only, and when overlapping applies are coalesced the follow-up run uses the most recently requested folder.
