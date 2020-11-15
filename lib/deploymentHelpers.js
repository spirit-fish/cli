const fs = require('fs');
const retry = require('async-retry')
const globby = require('globby');
const cliProgress = require('cli-progress');
const Sentry = require("@sentry/node");
const { TerminalColors } = require('./constants');
const ora = require('ora');
const chalk = require('chalk');

const syncFolderToStorage = async (bunny, storagezoneName, localFolder, remoteFolder) => {
  const paths = await globby(['**/*'], {
    cwd: localFolder,
    ignore: ['node_modules/**/*', '.git/**/*']
  });

  if (!paths.includes('index.html')) {
    return { status: 'error', reason: 'deployment.no_index' };
  }
  if (paths.includes('package.json')) {
    return { status: 'error', reason: 'deployment.has_package_json' };
  }

  for (const path of paths) {
    const data = fs.readFileSync(`${localFolder}/${path}`, { encoding: 'utf8', flag: 'r' });
    await retry(async (bail, retry) => {
      await bunny.storage.update(`${storagezoneName}/${remoteFolder}/${path}`, data);
    }, {
      retries: 2,
      onRetry: Sentry.captureException
    });
  }
  return { status: 'ok' };
};

const traverseDeploymentFiles = async (bunny, directory) => {
  let paths = [];
  for (const node of await bunny.storage.get(directory)) {
    const nodePath = `${node.Path}${node.ObjectName}`;
    if (node.IsDirectory) paths = [...paths, ...(await traverseDeploymentFiles(bunny, nodePath))];
    else paths = [...paths, `${nodePath}`];
  }
  return paths;
};

const fetchCurrentDeployment = async (bunny, storagezoneName) => {
  let currentHash = 0;
  try {
    currentHash = await bunny.storage.getFile(`${storagezoneName}/__SPIRIT_FISH_DEPLOYMENTS_META__/current`);
  } catch(e) {
    /* A 404 means it's our first deploy */
    if (!e.response || e.response.status !== 404) throw e;
  }
  return currentHash;
};

const aliasFile = async (bunny, from, to) => {
  await retry(async (bail, retry) => {
    await bunny.storage.update(to, await bunny.storage.getFile(from));
  }, {
    retries: 2,
    onRetry: Sentry.captureException
  });
};

const activateDeployment = async (bunny, storagezoneName, deploymentHash) => {
  const deploymentBasePath = `/${storagezoneName}/__SPIRIT_FISH_DEPLOYMENTS__/${deploymentHash}`;
  const deploymentFilePaths = await traverseDeploymentFiles(bunny, deploymentBasePath);

  if (deploymentFilePaths.length === 0) {
    return { status: 'error', reason: 'deployment.no_files' };
  }
  if (!deploymentFilePaths.map(path => path.replace(deploymentBasePath, '')).includes("/index.html")) {
    return { status: 'error', reason: 'deployment.no_index' };
  }

  const loadedDeploymentFiles = {};
  for (const path of deploymentFilePaths) {
    loadedDeploymentFiles[path] = await bunny.storage.getFile(path);
  }

  let has404 = false;
  for (const path in loadedDeploymentFiles) {
    if (!loadedDeploymentFiles.hasOwnProperty(path)) continue;
    const rawPath = path.replace(deploymentBasePath, '');
    if (rawPath === "/index.html") continue;
    if (rawPath === "/404.html") has404 = true;
    await retry(async (bail, retry) => {
      await bunny.storage.update(`${storagezoneName}${rawPath}`, loadedDeploymentFiles[path]);
    }, {
      retries: 2,
      onRetry: Sentry.captureException
    });
  }

  if (has404) {
    /* The user declared a 404.html file, so it's not an SPA. */
    await aliasFile(bunny, `${deploymentBasePath}/404.html`, `${storagezoneName}/bunnycdn_errors/404.html`);
  } else {
    /* The user did not declare a 404.html file, so alias index.html as 404. */
    await aliasFile(bunny, `${deploymentBasePath}/index.html`, `${storagezoneName}/bunnycdn_errors/404.html`);
  }

  /* We activate index.html last, because it's what actually sets the new version live! */
  await aliasFile(bunny, `${deploymentBasePath}/index.html`, `${storagezoneName}/index.html`);

  /* Store the new deployment hash */
  await retry(async (bail, retry) => {
    await bunny.storage.update(
      `${storagezoneName}/__SPIRIT_FISH_DEPLOYMENTS_META__/current`,
      deploymentHash
    );
  }, {
    retries: 5,
    onRetry: Sentry.captureException
  });

  return { status: 'ok' };
};

const attemptActivateDeployment = async (bunny, results, storagezoneName, hash, spinner) => {
  const currentHash = await fetchCurrentDeployment(bunny, storagezoneName);
  results.operations.activate.currentHash = currentHash;
  results.operations.activate.hash = hash;

  try {
    Sentry.addBreadcrumb({ message: "WILL_ACTIVATE_VERSION", level: Sentry.Severity.Info });

    const activateResult = await activateDeployment(bunny, storagezoneName, hash);
    if (activateResult.status === "ok") {
      spinner.succeed(`${spinner.text}... ${chalk.hex(TerminalColors.GREEN).bold('done!')}`);
      Sentry.addBreadcrumb({ message: "DID_ACTIVATE_VERSION", level: Sentry.Severity.Info });
      return { status: "ok" };
    } else {
      spinner.fail(`${spinner.text}... ${chalk.hex(TerminalColors.ORANGE).bold(`Activation failed: ${activateResult.reason}`)}`);
      Sentry.addBreadcrumb({ message: "ACTIVATE_VERSION_DID_FAIL", level: Sentry.Severity.Warning });
      results.operations.activate.warnings = [...results.operations.activate.warnings, activateResult.reason];
      return activateResult;
    }
  } catch (e) {
    spinner.stop();

    if (currentHash !== 0 && (currentHash !== hash)) {
      console.log(
        chalk.hex(TerminalColors.ORANGE).bold(
          `Activation for v.${hash} failed unexpectedly. Attempting to rollback to the previous version.`
        )
      );
      results.operations.rollback = { currentHash, warnings: [] };
      Sentry.addBreadcrumb({ message: "WILL_ROLLBACK_VERSION", level: Sentry.Severity.Info });
      try {
        spinner = ora(`Rolling back to ${currentHash}...`).start();
        const rollbackResult = await activateDeployment(bunny, storagezoneName, currentHash, hash);
        if (rollbackResult.status === "ok") {
          spinner.succeed(`${spinner.text}... ${chalk.hex(TerminalColors.GREEN).bold('done!')}`);
          Sentry.addBreadcrumb({ message: "DID_ROLLBACK_VERSION", level: Sentry.Severity.Info });
          return { status: "ok" };
        } else {
          spinner.fail(`${spinner.text}... ${chalk.hex(TerminalColors.ORANGE).bold(`Failed: ${rollbackResult.reason}`)}`);
          Sentry.addBreadcrumb({ message: "ROLLBACK_VERSION_DID_FAIL", level: Sentry.Severity.Warning });
          results.operations.rollback.warnings = [...results.operations.rollback.warnings, rollbackResult.reason];
          return rollbackResult;
        }
      } catch (e) {
        // If we get here, it's catastrophic. We couldn't deploy and we couldn't rollback!
        spinner.fail(
          chalk.hex(TerminalColors.ORANGE)(
            "We could not rollback to your previous verion. Support has been notified. Please check your project is still working as expected."
          )
        );
        Sentry.addBreadcrumb({ message: "ROLLBACK_VERSION_DID_CRITICALLY_FAIL", level: Sentry.Severity.Error });
        if (e && e.message) {
          results.operations.rollback.warnings = [...results.operations.rollback.warnings, e.message];
        }
        throw e;
      }
    } else {
      // Something went wrong, but there's no version to rollback to.
      console.log(
        chalk.hex(TerminalColors.ORANGE).bold(
          `Activation for v.${hash} failed unexpectedly! There is no previous version to rollback to. Please try again later.`
        )
      );
    }
  }
};

const attemptFlushDeployment = async (bunny, results, storagezoneName, hash) => {
  const currentHash = await fetchCurrentDeployment(bunny, storagezoneName);
  results.operations.flush.currentHash = currentHash;

  if (hash === currentHash) {
    return { status: 'error', reason: 'flush.attempting_flush_current_version' };
  }

  try {
    Sentry.addBreadcrumb({ message: "WILL_FLUSH_VERSION", level: Sentry.Severity.Info });
    await bunny.storage.delete(`${storagezoneName}/__SPIRIT_FISH_DEPLOYMENTS__/${hash}/`);
    Sentry.addBreadcrumb({ message: "DID_FLUSH_VERSION", level: Sentry.Severity.Info });
    return { status: 'ok' };
  } catch (e) {
    if (e.response && e.response.status === 404) {
      return { status: 'error', reason: 'flush.version_not_found' };
    }
    throw e;
  }
};

module.exports = {
  syncFolderToStorage,
  fetchCurrentDeployment,
  attemptActivateDeployment,
  attemptFlushDeployment
};
