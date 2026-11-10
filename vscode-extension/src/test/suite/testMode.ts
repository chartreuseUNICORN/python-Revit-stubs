/**
 * runTest.ts launches the test host twice: once on a single folder ('single') and once on a
 * two-folder .code-workspace ('multiroot'). Every suite runs in both hosts and skips itself
 * in the mode it does not target.
 */
export type TestMode = 'single' | 'multiroot';

export function testMode(): TestMode {
  return process.env.REVIT_STUBS_TEST_MODE === 'multiroot' ? 'multiroot' : 'single';
}

/** Call from a suite's `before` hook; skipping there marks every test in the suite pending. */
export function onlyIn(ctx: Mocha.Context, mode: TestMode): void {
  if (testMode() !== mode) {
    ctx.skip();
  }
}
