import chalk from 'chalk';
import process from 'process';
import terminalLink from 'terminal-link';
import path from 'upath';
import { checkOverwriteViolation, compile, copyAssets } from '../builder';
import { collectVivliostyleConfig, mergeConfig, MergedConfig } from '../config';
import { checkContainerEnvironment } from '../container';
import { buildPDF } from '../pdf';
import { cwd, gracefulError, log, startLogging, stopLogging } from '../util';
import { exportWebPublication } from '../webbook';
import { BuildCliFlags, setupBuildParserProgram } from './build.parser';

try {
  const program = setupBuildParserProgram();
  program.parse(process.argv);
  const options = program.opts();
  build({
    input: program.args?.[0],
    configPath: options.config,
    targets: options.targets,
    theme: options.theme,
    size: options.size,
    style: options.style,
    userStyle: options.userStyle,
    singleDoc: options.singleDoc,
    title: options.title,
    author: options.author,
    language: options.language,
    pressReady: options.pressReady,
    renderMode: options.renderMode || 'local',
    preflight: options.preflight,
    preflightOption: options.preflightOption,
    verbose: options.verbose,
    timeout: options.timeout,
    sandbox: options.sandbox,
    executableChromium: options.executableChromium,
    image: options.image,
    skipCompile: options.skipCompile,
  }).catch(gracefulError);
} catch (err) {
  gracefulError(err);
}

export default async function build(cliFlags: BuildCliFlags) {
  const isInContainer = await checkContainerEnvironment();
  if (!isInContainer) {
    startLogging('Collecting build config');
  }

  const loadedConf = collectVivliostyleConfig(cliFlags);
  const { vivliostyleConfig, vivliostyleConfigPath } = loadedConf;
  cliFlags = loadedConf.cliFlags;

  const context = vivliostyleConfig ? path.dirname(vivliostyleConfigPath) : cwd;

  const config = await mergeConfig(cliFlags, vivliostyleConfig, context);
  checkUnsupportedOutputs(config);

  // check output path not to overwrite source files
  for (const target of config.outputs) {
    checkOverwriteViolation(config, target.path, target.format);
  }

  // build artifacts
  if (config.manifestPath && !cliFlags.skipCompile) {
    await compile(config);
    await copyAssets(config);
  }

  // generate files
  for (const target of config.outputs) {
    let output: string | null = null;
    if (target.format === 'pdf') {
      output = await buildPDF({
        ...config,
        input: (config.manifestPath ??
          config.webbookEntryPath ??
          config.epubOpfPath) as string,
        target,
        customStyle: config.customStyle,
        customUserStyle: config.customUserStyle,
        singleDoc: config.singleDoc,
      });
    } else if (target.format === 'webpub') {
      if (!config.manifestPath) {
        continue;
      }
      output = await exportWebPublication({
        ...config,
        input: config.workspaceDir,
        output: target.path,
      });
    }
    if (output) {
      const formattedOutput = chalk.bold.green(path.relative(cwd, output));
      log(
        `\n${terminalLink(formattedOutput, 'file://' + output, {
          fallback: () => formattedOutput,
        })} has been created.`,
      );
    }
  }

  if (!isInContainer) {
    stopLogging('Built successfully.', '🎉');
  }

  process.exit(0);
}

export function checkUnsupportedOutputs({
  webbookEntryPath,
  epubOpfPath,
  outputs,
}: MergedConfig) {
  if (webbookEntryPath && outputs.some((t) => t.format === 'webpub')) {
    throw new Error(
      'Exporting webpub format from single HTML input is not supported.',
    );
  } else if (epubOpfPath && outputs.some((t) => t.format === 'webpub')) {
    throw new Error(
      'Exporting webpub format from EPUB or OPF file is not supported.',
    );
  }
}
