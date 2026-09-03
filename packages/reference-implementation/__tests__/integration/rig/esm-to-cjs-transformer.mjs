import crypto from 'node:crypto';
import ts from 'typescript';

/**
 * Turns an ESM-only dependency into CommonJS for the rig's jest runtime.
 *
 * pg-boss and two of its dependencies publish only ESM builds, and ts-jest
 * leaves the `import` statements of a JavaScript file in place, so the queue
 * cannot be loaded by the CJS runtime the rig uses without this. The
 * transform is the TypeScript compiler's own module rewrite, which the
 * package already depends on, rather than a Babel preset the workspace does
 * not install directly.
 */
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
  allowJs: true,
};

const esmToCjsTransformer = {
  process(sourceText, sourcePath) {
    // transpileModule reports nothing unless asked, and emits an unparseable
    // statement verbatim, so a broken dependency would surface as a failure
    // deep inside it rather than here.
    const { outputText, diagnostics } = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions,
      reportDiagnostics: true,
    });
    const errors = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length > 0) {
      const messages = errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ');
      throw new Error(`esm-to-cjs transform of ${sourcePath} failed: ${messages}`);
    }
    return { code: outputText };
  },
  getCacheKey(sourceText, sourcePath) {
    // The compiler version and its options are part of the key, so a change to
    // either invalidates jest's cache without a hand-bumped salt.
    return crypto
      .createHash('sha1')
      .update(sourceText)
      .update(sourcePath)
      .update(ts.version)
      .update(JSON.stringify(compilerOptions))
      .digest('hex');
  },
};

export default esmToCjsTransformer;
