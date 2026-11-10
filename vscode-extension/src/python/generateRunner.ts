import * as vscode from 'vscode';
import { TASK_TYPE } from '../constants';
import { buildGenerateArgs, type GenerateRequest } from '../core/generateArgs';

export { buildGenerateArgs };
export type { GenerateRequest };

/** Runs `python -m revitstubs generate …` as a VS Code Task; resolves when it exits with code 0. */
export async function runGenerate(req: GenerateRequest, token?: vscode.CancellationToken): Promise<void> {
  if (token?.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
  const task = new vscode.Task(
    { type: TASK_TYPE, years: req.years.join(',') },
    vscode.TaskScope.Workspace,
    `Generate Revit ${req.years.join(', ')} stubs`,
    'Revit Stubs',
    new vscode.ProcessExecution(req.venvPython, buildGenerateArgs(req), {
      cwd: req.cwd,
      env: req.revitRoot ? { REVIT_ROOT: req.revitRoot } : undefined,
    }),
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    clear: true,
    showReuseMessage: false,
  };

  const disposables: vscode.Disposable[] = [];
  let execution: vscode.TaskExecution | undefined;
  // Exit events that arrive before executeTask resolves are buffered and matched afterwards.
  const early: vscode.TaskProcessEndEvent[] = [];
  try {
    return await new Promise<void>((resolve, reject) => {
      const settle = (exitCode: number | undefined): void => {
        if (exitCode === 0) {
          resolve();
        } else {
          reject(new Error(`revitstubs generate exited with code ${exitCode ?? 'unknown'}`));
        }
      };
      disposables.push(
        vscode.tasks.onDidEndTaskProcess((e) => {
          if (!execution) {
            early.push(e);
          } else if (e.execution === execution) {
            settle(e.exitCode);
          }
        }),
      );
      if (token) {
        disposables.push(
          token.onCancellationRequested(() => {
            execution?.terminate();
            reject(new vscode.CancellationError());
          }),
        );
      }
      vscode.tasks.executeTask(task).then(
        (ex) => {
          execution = ex;
          if (token?.isCancellationRequested) {
            ex.terminate();
            return;
          }
          const ended = early.find((e) => e.execution === ex);
          if (ended) {
            settle(ended.exitCode);
          }
        },
        (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
  } finally {
    disposables.forEach((d) => d.dispose());
  }
}
