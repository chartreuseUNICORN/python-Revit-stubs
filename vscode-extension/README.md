# Revit Stubs

Real Revit API IntelliSense for Python in VS Code, one Revit year at a time. This
extension generates `.pyi` stubs from your Revit install, keeps them in a per-workspace
or shared store, and points Pylance / Pyright at the year you pick.

## Features

- One-click **Quick Setup**: installs the generator privately, generates stubs, configures the language server.
- Switch Revit year from the status bar or a picker; edit the setting by hand and it re-applies.
- Workspace-local stubs (committable) or a shared per-user store.
- Works with Pylance and Pyright; settings are written through the VS Code API (comments in `settings.json` survive).
- Generation runs as a visible, cancellable VS Code task.
- "Remove Revit Stub Configuration" removes `python.analysis.stubPath`, the `reportMissingModuleSource` diagnostic override, and `revitStubs.currentVersion`. It leaves `python.analysis.typeCheckingMode`, `python.analysis.useLibraryCodeForTypes` and `python.languageServer` as they are.

## Quick start

1. Open your script folder and run **Revit Stubs: Quick Setup (install tool, generate, configure)**.
2. Tick the Revit years to generate, pick workspace or global store, wait (tens of seconds per year).
3. `Revit 2025` appears in the status bar; click it to switch years later.

Quick Setup finds Python >= 3.9 (the Python extension's active interpreter, else `py -3` / `python3` / `python` on PATH), creates a private venv under the extension's global storage and installs the bundled `revit-stubgen` wheel offline. Nothing is installed into your own environments. Re-runnable; already-generated years are shown and unticked.

## Switching Revit versions

One year per workspace folder, because `python.analysis.stubPath` is a single path. `revitStubs.currentVersion` (workspace scope) selects it. Change it via **Select Revit Version**, the status bar item, or by editing the setting.

## Where stubs live

Searched in order; the first hit wins.

| Store | Location | Setting | `stubPath` entry |
| --- | --- | --- | --- |
| Workspace | `${workspaceFolder}/revit-stubs/<year>` | `revitStubs.workspaceStubsRoot` | `${workspaceFolder}/...` |
| Global | `%LOCALAPPDATA%\revit-stubs\<year>` (Windows), `~/.local/share/revit-stubs/<year>` (elsewhere) | `revitStubs.globalStubsRoot` | absolute path |

The workspace store can be committed to the repo.

## Language server support

`revitStubs.languageServer`: `auto` (first installed, Pylance preferred), `pylance` (`ms-python.vscode-pylance`), `pyright` (`ms-pyright.pyright`).

| Setting written | Value |
| --- | --- |
| `python.analysis.stubPath` | always set to the selected year |
| `python.analysis.useLibraryCodeForTypes` | `true` |
| `python.analysis.typeCheckingMode` | `"basic"`, only if unset |
| `python.analysis.diagnosticSeverityOverrides` | `reportMissingModuleSource: "none"`, merged in |
| `python.languageServer` | `"Pylance"`, Pylance only, and only if unset/Default. Window-scoped, so in a multi-root workspace it goes to the `.code-workspace` settings, not the folder's |

## Settings

| Id | Default | Meaning |
| --- | --- | --- |
| `revitStubs.currentVersion` | `""` | Active Revit year, e.g. `2025` (workspace) |
| `revitStubs.workspaceStubsRoot` | `revit-stubs` | Folder (relative to the workspace folder, or absolute) holding one folder per year |
| `revitStubs.globalStubsRoot` | `""` | Machine-wide stub folder; empty = the per-user default above |
| `revitStubs.languageServer` | `auto` | `auto`, `pylance` or `pyright` |
| `revitStubs.revitRoot` | `""` | Folder containing `Revit <year>` installs; empty = `REVIT_ROOT` env var, else `C:\Program Files\Autodesk` |
| `revitStubs.generate.extraArgs` | `[]` | Extra flags for `revitstubs generate`, e.g. `["--all-assemblies"]`, `["--collections", "dotnet"]`, `["--no-clr"]` |

## Commands

| Command | Does |
| --- | --- |
| Revit Stubs: Quick Setup (install tool, generate, configure) | Full guided setup |
| Revit Stubs: Select Revit Version | Pick the active year |
| Revit Stubs: Generate Stubs for Revit Year(s) | Generate without the rest of setup |
| Revit Stubs: Remove Revit Stub Configuration | Undo `stubPath`, the diagnostic override and `currentVersion`; leaves everything else |
| Revit Stubs: Open Settings | Open the extension's settings |

## Status bar states

Right side. Click = Select Revit Version.

| Text | Meaning |
| --- | --- |
| `Revit 2025` | Applied; tooltip shows path, store, language server |
| `Revit 2025` (warning) | Configured year has no stubs on disk |
| `Revit 2025: no language server` (warning) | Neither Pylance nor Pyright installed |
| `Revit: select version` | No year chosen yet |
| `$(error) Revit 2025: settings failed` (error background) | Writing the language-server settings failed; tooltip includes the error message, and an error notification with a "Show Output" button is shown once per distinct error. Switching editors does not retry; changing a setting, re-selecting the version, or stubs appearing on disk does |
| (hidden) | No folder open, or no Revit config and no active Python file |

## Troubleshooting

- **No Revit installs found**: set `revitStubs.revitRoot` (or env `REVIT_ROOT`).
- **No Python 3.9+ interpreter found**: install Python, or pick one via the Python extension.
- **Status bar: no language server**: install Pylance or Pyright, or set `revitStubs.languageServer`.
- **Stubs generated but hover shows nothing**: check `python.analysis.stubPath` in workspace settings, then reload the window.
- **Generation failed**: see "Show Output" or the task terminal.
- **`System.*` types are `Any`**: the matching .NET runtime / reference pack is missing; see "System.* stubs" in the [root README](../README.md).

## Development

```bash
npm install
npm run bundle:wheel   # needs Python >= 3.9 with pip on PATH; builds ../revit-stubgen into bundled/
npm run compile
npm run test:unit
npm test               # downloads VS Code once
npm run package        # vsce; bundles the wheel
```

F5 uses the "Run Extension" launch config. "Extension Tests" runs the single-folder integration suite in the debugger. `npm test` runs the integration suite twice: on a single folder, then on a two-folder `.code-workspace`.

The generator itself (what the stubs contain, flags, limitations) is documented in the [root README](../README.md).
