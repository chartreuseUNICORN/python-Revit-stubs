const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log('[watch] build finished');
    });
  },
};

/** A production build (the VSIX) must ship the revit-stubgen wheel built by `npm run bundle:wheel`. */
function assertBundledWheel() {
  const bundledDir = path.join(__dirname, 'bundled');
  const wheels = fs.existsSync(bundledDir)
    ? fs.readdirSync(bundledDir).filter((f) => /^revit_stubgen-.*\.whl$/.test(f))
    : [];
  if (wheels.length === 0) {
    console.error('✘ [ERROR] production build requires bundled/revit_stubgen-*.whl; run "npm run bundle:wheel" first');
    process.exit(1);
  }
  console.log(`bundled wheel: ${wheels.join(', ')}`);
}

async function main() {
  if (production) {
    assertBundledWheel();
  }
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [esbuildProblemMatcherPlugin],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
