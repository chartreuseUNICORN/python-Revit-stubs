export const EXT_ID = 'revitStubs';

export const COMMANDS = {
  openSettings: 'revitStubs.openSettings',
  selectVersion: 'revitStubs.selectVersion',
  quickSetup: 'revitStubs.quickSetup',
  generate: 'revitStubs.generate',
  clearConfiguration: 'revitStubs.clearConfiguration',
} as const;

export const SETTINGS = {
  currentVersion: 'currentVersion',
  workspaceStubsRoot: 'workspaceStubsRoot',
  globalStubsRoot: 'globalStubsRoot',
  languageServer: 'languageServer',
  revitRoot: 'revitRoot',
  generateExtraArgs: 'generate.extraArgs',
} as const;

export const EXTENSION_IDS = {
  python: 'ms-python.python',
  pylance: 'ms-python.vscode-pylance',
  pyright: 'ms-pyright.pyright',
} as const;

export const STATUS_BAR_ID = 'revitStubs.version';
export const TASK_TYPE = 'revitStubs';
export const OUTPUT_CHANNEL_NAME = 'Revit Stubs';
