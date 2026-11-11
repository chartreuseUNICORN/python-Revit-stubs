import type { InspectedSettings } from '../config';
import { EXTENSION_IDS } from '../constants';
import { planPylanceLanguageServerUpdate, SettingUpdate } from '../core/lsp/settingsMap';
import { AnalysisAdapter } from './base';

export class PylanceAdapter extends AnalysisAdapter {
  readonly id = 'pylance';
  readonly displayName = 'Pylance';
  readonly extensionId = EXTENSION_IDS.pylance;

  protected override extraUpdates(inspected: InspectedSettings): SettingUpdate[] {
    const ls = planPylanceLanguageServerUpdate(inspected.languageServer);
    return ls ? [ls] : [];
  }
}
