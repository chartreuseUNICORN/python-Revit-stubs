export interface AnalysisTarget {
  stubPath: string;
  extraPaths?: string[];
}

export interface InspectedAnalysis {
  typeCheckingMode?: string;
  useLibraryCodeForTypes?: boolean;
  diagnosticSeverityOverrides?: Record<string, string>;
  extraPaths?: string[];
}

export interface SettingUpdate {
  section: string;
  key: string;
  value: unknown; // undefined means "remove"
  /**
   * The setting's declared VS Code scope. 'window' settings (e.g. python.languageServer) cannot be
   * written to folder settings, so they always go to the workspace. Defaults to 'resource'.
   */
  scope?: 'window' | 'resource';
}

export const ANALYSIS_SECTION = 'python.analysis';

export function planAnalysisUpdates(target: AnalysisTarget, inspected: InspectedAnalysis): SettingUpdate[] {
  const updates: SettingUpdate[] = [
    { section: ANALYSIS_SECTION, key: 'stubPath', value: target.stubPath },
  ];
  if (inspected.useLibraryCodeForTypes !== true) {
    updates.push({ section: ANALYSIS_SECTION, key: 'useLibraryCodeForTypes', value: true });
  }
  if (inspected.typeCheckingMode === undefined) {
    updates.push({ section: ANALYSIS_SECTION, key: 'typeCheckingMode', value: 'basic' });
  }
  const overrides = inspected.diagnosticSeverityOverrides ?? {};
  if (!('reportMissingModuleSource' in overrides)) {
    updates.push({
      section: ANALYSIS_SECTION,
      key: 'diagnosticSeverityOverrides',
      value: { ...overrides, reportMissingModuleSource: 'none' },
    });
  }
  if (target.extraPaths && target.extraPaths.length > 0) {
    const existing = inspected.extraPaths ?? [];
    const merged = [...new Set([...existing, ...target.extraPaths])];
    const same = merged.length === existing.length && merged.every((p, i) => p === existing[i]);
    if (!same) {
      updates.push({ section: ANALYSIS_SECTION, key: 'extraPaths', value: merged });
    }
  }
  return updates;
}

export function planPylanceLanguageServerUpdate(currentLanguageServer: string | undefined): SettingUpdate | undefined {
  if (currentLanguageServer === undefined || currentLanguageServer === 'Default') {
    return { section: 'python', key: 'languageServer', value: 'Pylance', scope: 'window' };
  }
  return undefined;
}

export function planClearUpdates(inspected: InspectedAnalysis & { stubPath?: string }): SettingUpdate[] {
  const updates: SettingUpdate[] = [];
  if (inspected.stubPath !== undefined) {
    updates.push({ section: ANALYSIS_SECTION, key: 'stubPath', value: undefined });
  }
  const overrides = inspected.diagnosticSeverityOverrides;
  if (overrides && overrides.reportMissingModuleSource === 'none') {
    const rest = { ...overrides };
    delete rest.reportMissingModuleSource;
    updates.push({
      section: ANALYSIS_SECTION,
      key: 'diagnosticSeverityOverrides',
      value: Object.keys(rest).length > 0 ? rest : undefined,
    });
  }
  return updates;
}
