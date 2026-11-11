export interface GenerateRequest {
  venvPython: string;
  years: string[];
  outRoot: string;
  revitRoot?: string;
  extraArgs?: string[];
  cwd?: string;
}

/** argv (after the interpreter) for `python -m revitstubs generate …`. */
export function buildGenerateArgs(req: GenerateRequest): string[] {
  const args = ['-m', 'revitstubs', 'generate', ...req.years, '--out', req.outRoot];
  if (req.revitRoot) {
    args.push('--revit-root', req.revitRoot);
  }
  args.push(...(req.extraArgs ?? []));
  return args;
}
