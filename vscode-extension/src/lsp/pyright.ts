import { EXTENSION_IDS } from '../constants';
import type { SettingUpdate } from '../core/lsp/settingsMap';
import { AnalysisAdapter } from './base';

/** Pyright reads the same python.analysis.* keys but has no python.languageServer setting. */
export class PyrightAdapter extends AnalysisAdapter {
  readonly id = 'pyright';
  readonly displayName = 'Pyright';
  readonly extensionId = EXTENSION_IDS.pyright;

  protected extraUpdates(): SettingUpdate[] {
    return [];
  }
}
