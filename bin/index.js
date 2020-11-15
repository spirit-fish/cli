#!/usr/bin/env node

// Packages
const { Command } = require('commander');
const { v4: uuidv4 } = require('uuid');
const open = require('open');
const https = require('https');
const url = require('url');
const path = require('path');
const devcert = require('devcert');
const updateNotifier = require('update-notifier');
const pkg = require('../package.json');
const { hashElement } = require('folder-hash');
const { Bunny, HttpBase } = require("bunnycdn-node");
const ora = require('ora');
const chalk = require('chalk');

// Sentry
const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");

// Internal
const SpiritFish = require('../lib/spiritFish');
const { TerminalColors } = require('../lib/constants');
const {
  storeCredentials,
  fetchCredentials,
  testToken
} = require('../lib/credentialsHelpers');
const {
  syncFolderToStorage,
  fetchCurrentDeployment,
  attemptActivateDeployment,
  attemptFlushDeployment
} = require('../lib/deploymentHelpers');

updateNotifier({ pkg }).notify();

// Setup Sentry
Sentry.init({
  dsn: "https://3948c2634e314cdc9475f63cccbe23c5@o28893.ingest.sentry.io/5499730",
  tracesSampleRate: 1.0,
});

// Turn on Dev Mode
const dev = false;
if (dev) SpiritFish.HATCHERY_URL = `http://www.spiritfish.localhost:3000`;

const program = new Command();
program.version(pkg.version);

// TODO: I should be able to list tokens and revoke them
// TODO: I should be able to give a label to tokens

program
  .option('-t, --token <token>', 'Pass a token instead of using our auth flow. Useful for CI tools.');

program
  .command('authenticate')
  .description('Authenticate your CLI with Spirit Fish')
  .action(async () => {
    const spinner = ora('Authenticating via your browser...').start();

    if (program.opts().token) {
      return spinner.fail(
        chalk.hex(TerminalColors.ORANGE)("You may not pass a --token to this command.")
      );
    }

    const existingCredentials = fetchCredentials();
    if (existingCredentials && existingCredentials.token) {
      if (await testToken(existingCredentials.token)) {
        return spinner.warn(
          chalk.hex(TerminalColors.ORANGE)("You are already authenticated. Use `spirit-fish unauthenticate` if you'd like to change users.")
        );
      }
    }

    let timeout;
    const attempt = uuidv4();
    const ssl = await devcert.certificateFor('spirit-fish.cli', {
      getCaPath: true,
      getCaBuffer: true
    });
    const server = https.createServer(ssl, async (req, res) => {
      const parsed = url.parse(req.url, true);
      const token = parsed.query.token;
      const returnedAttempt = parsed.query.attempt;

      if (returnedAttempt === attempt) {
        storeCredentials({ token });
        spinner.succeed(`${spinner.text} ${chalk.hex(TerminalColors.GREEN).bold('done!')}`);
        res.writeHead(204);
        res.end("ok");
      } else {
        spinner.fail(chalk.hex(TerminalColors.ORANGE)('Failed - please try again.'));
        res.writeHead(401);
        res.end("error");
      }

      // In any case, shut down our server
      if (timeout) clearTimeout(timeout);
      req.connection.end();
      req.connection.destroy();
      server.close();
    }).listen(3474);

    await open(`${SpiritFish.HATCHERY_URL}/auth/cli?attempt=${attempt}`);
    timeout = setTimeout(function() {
      spinner.fail(chalk.hex(TerminalColors.ORANGE)('Timed out - please try again.'));
      server.close()
    }, 30000);
  });

program
  .command('unauthenticate')
  .description('Unauthenticate your Spirit Fish CLI')
  .action(async () => {
    const spinner = ora('Unauthenticating...').start();
    if (program.opts().token) {
      return spinner.fail(
        chalk.hex(TerminalColors.ORANGE)('You may not pass a --token to this command.')
      );
    }
    storeCredentials({ token: null });
    return spinner.succeed(`Unauthenticating... ${chalk.hex(TerminalColors.GREEN).bold('done!')}`);
  });

program
  .command('whoami')
  .description('Check the current token owner')
  .action(async () => {
    const spinner = ora('Hello...').start();
    const token = program.opts().token || fetchCredentials().token;
    const currentUser = await testToken(token);
    if (currentUser) {
      return spinner.succeed(`${spinner.text} ${chalk.hex(TerminalColors.GREEN).bold(currentUser.email)}!`);
    } else {
      return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Invalid auth. Please call `spirit-fish authenticate` or pass a --token"));
    }
  });

program
  .command('token')
  .description('Generate a token for use with CI and the --token param')
  .action(async () => {
    const transaction = Sentry.startTransaction({ op: "Generate Token", name: "Generate a Token" });
    const spinner = ora('Generating token...').start();

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) {
      return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Invalid auth. Please call `spirit-fish authenticate` or pass a --token"));
    }

    try {
      const data = await SpiritFish.tokenCreate(token);
      spinner.succeed(`Please record this token - for security reasons it can not be retrieved again.`);
      console.log(`Token: ${chalk.hex(TerminalColors.GREEN).bold(data.token)}`);
    } catch(e) {
      const message = (e && e.message) ? e.message : "Error. Please try again.";
      spinner.fail(chalk.hex(TerminalColors.ORANGE)(message));
      Sentry.captureException(e);
    } finally {
      transaction.finish();
    }
  });

program
  .command('invalidate <renderer_id>')
  .option('-p, --paths <paths>', 'A comma seperated list of paths to invalidate. Supports wildcards.')
  .description('Invalidate paths in your renderers cache to force a re-render')
  .action(async (rendererId, args) => {
    const transaction = Sentry.startTransaction({ op: "Invalidate Renderer", name: "Invalidate pages from Renderer" });
    const spinner = ora('Invalidating...').start();

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) {
      return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Invalid auth. Please call `spirit-fish authenticate` or pass a --token"));
    }

    const paths = args.paths || '*';
    try {
      const invalidation = await SpiritFish.invalidationCreate(token, rendererId, paths);
      return spinner.succeed(`${spinner.text} ${chalk.hex(TerminalColors.GREEN).bold('done!')}`);
    } catch(e) {
      const message = (e && e.message) ? e.message : "Error. Please try again.";
      spinner.fail(chalk.hex(TerminalColors.ORANGE)(message));
      Sentry.captureException(e);
    } finally {
      transaction.finish();
    }
  });

program
  .command('renderers')
  .description('List all of your renderers')
  .action(async () => {
    const transaction = Sentry.startTransaction({ op: "List Renderers", name: "List all Renderers" });
    const spinner = ora('Loading...').start();

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) {
      return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Invalid auth. Please call `spirit-fish authenticate` or pass a --token"));
    }

    try {
      const renderers = await SpiritFish.renderersIndex(token);
      spinner.stop();
      renderers.forEach(r => {
        console.log(`🐠 ${r.id} - ${chalk.hex(TerminalColors.ORANGE)(`"${r.nickname}"`)}`)
      });
    } catch(e) {
      const message = (e && e.message) ? e.message : "Error. Please try again.";
      spinner.fail(chalk.hex(TerminalColors.ORANGE)(message));
      Sentry.captureException(e);
    } finally {
      transaction.finish();
    }
  });

program
  .command('deployments <renderer_id>')
  .description('List all of your deployments')
  .action(async (rendererId) => {
    const transaction = Sentry.startTransaction({ op: "List Deployments", name: "List all Deployments for Renderer" });
    const spinner = ora('Loading...').start();

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) {
      return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Invalid auth. Please call `spirit-fish authenticate` or pass a --token"));
    }

    try {
      const data = await SpiritFish.rendererShow(token, rendererId);
      if (!data.storagezone) {
        return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Never deployed."));
      }

      const bunny = new Bunny();
      bunny.storage._baseConfig.headers = { AccessKey: data.storagezone.password };

      const deploymentHashes = await bunny.storage.get(`${data.storagezone.name}/__SPIRIT_FISH_DEPLOYMENTS__`);
      if (deploymentHashes.lenth === 0) {
        return spinner.fail(chalk.hex(TerminalColors.ORANGE)("No deployments found"));
      }
      spinner.stop();

      const currentDeploymentHash = await fetchCurrentDeployment(bunny, data.storagezone.name);
      const sorted = deploymentHashes.sort(function(a, b) {
        return new Date(b.DateCreated) - new Date(a.DateCreated);
      }).map(h => {
        return {
          version: `v.${h.ObjectName}`,
          active: h.ObjectName === currentDeploymentHash,
          createdAt: h.DateCreated
        }
      }).forEach(h => {
        if (h.active) {
          console.log(`🐠 ${chalk.hex(TerminalColors.GREEN)(`${h.version} - ${h.createdAt}`)}`)
        } else {
          console.log(`➖ ${chalk.hex(TerminalColors.ORANGE)(`${h.version} - ${h.createdAt}`)}`)
        }
      });
    } catch(e) {
      const message = (e && e.message) ? e.message : "Error. Please try again.";
      spinner.fail(chalk.hex(TerminalColors.ORANGE)(message));
      Sentry.captureException(e);
    } finally {
      transaction.finish();
    }
  });

program
  .command('deploy <renderer_id> <dir>')
  .option('-a, --activate', 'Set the version live immediately')
  .description('Push a new version of your project to a renderer')
  .action(async (rendererId, dir, args) => {
    const transaction = Sentry.startTransaction({ op: "Deploy", name: "Deploy a Version" });
    let spinner = ora(`Deploying ${dir}...`).start();

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) {
      return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Invalid auth. Please call `spirit-fish authenticate` or pass a --token"));
    }

    const results = {
      input: { rendererId, dir, activate: args.activate },
      operations: { deploy: { warnings: [] } }
    };
    if (args.activate) results.operations.activate = { warnings: [] };

    try {
      const { hash } = await hashElement(dir, {
        encoding: 'hex',
        folders: { exclude: ['node_modules', '.git'] }
      });
      results.operations.deploy.hash = hash;

      Sentry.addBreadcrumb({ message: "WILL_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });
      const data = await SpiritFish.deploymentCreate(token, rendererId, { hash, results });
      results.input.deploymentId = data.id;
      Sentry.addBreadcrumb({ message: "DID_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });

      const bunny = new Bunny();
      bunny.storage._baseConfig.headers = { AccessKey: data.storagezone.password };
      Sentry.addBreadcrumb({ message: "WILL_DEPLOY_VERSION", level: Sentry.Severity.Info });

      const deployResult = await syncFolderToStorage(
        bunny,
        data.storagezone.name,
        path.join(process.cwd(), dir),
        `__SPIRIT_FISH_DEPLOYMENTS__/${hash}`
      );

      if (deployResult.status === "ok") {
        spinner.succeed(`${spinner.text} ${chalk.hex(TerminalColors.GREEN).bold(`Deployed v.${hash}`)}`);
        Sentry.addBreadcrumb({ message: "DID_DEPLOY_VERSION", level: Sentry.Severity.Info });
      } else {
        spinner.fail(`${spinner.text} ${chalk.hex(TerminalColors.ORANGE)(`Deployment failed: ${deployResult.reason}`)}`);
        Sentry.addBreadcrumb({ message: "DEPLOY_VERSION_DID_FAIL", level: Sentry.Severity.Warning });
        results.operations.deploy.warnings = [...results.operations.deploy.warnings, deployResult.reason];
      }

      if (deployResult.status === "ok" && args.activate) {
        spinner = ora(`Activating ${hash}...`).start();
        await attemptActivateDeployment(bunny, results, data.storagezone.name, hash, spinner);
      }
    } catch(e) {
      const message = (e && e.message) ? e.message : "Error. Please try again.";
      spinner.fail(chalk.hex(TerminalColors.ORANGE)(message));
      Sentry.withScope(scope => {
        scope.setExtras(results);
        Sentry.captureException(e);
      });
    } finally {
      transaction.finish();
      if (results.input.deploymentId) {
        await SpiritFish.deploymentUpdate(token, rendererId, results.input.deploymentId, { results });
      }
    }
  });

program
  .command('activate <renderer_id> <version>')
  .description(`Set an existing deployment live`)
  .action(async (rendererId, hash) => {
    const transaction = Sentry.startTransaction({ op: "Activate", name: "Activate a Version" });
    if (hash.startsWith('v.')) hash = hash.replace('v.', '');
    const spinner = ora(`Activating v.${hash}...`).start();

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) {
      return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Invalid auth. Please call `spirit-fish authenticate` or pass a --token"));
    }

    const results = {
      input: { rendererId, hash },
      operations: { activate: { warnings: [] } }
    };

    try {
      Sentry.addBreadcrumb({ message: "WILL_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });
      const data = await SpiritFish.deploymentCreate(token, rendererId, { hash, results });
      results.input.deploymentId = data.id;
      Sentry.addBreadcrumb({ message: "DID_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });

      const bunny = new Bunny();
      bunny.storage._baseConfig.headers = { AccessKey: data.storagezone.password };
      await attemptActivateDeployment(bunny, results, data.storagezone.name, hash, spinner);
    } catch(e) {
      const message = (e && e.message) ? e.message : "Error. Please try again.";
      spinner.fail(chalk.hex(TerminalColors.ORANGE)(message));
      Sentry.withScope(scope => {
        scope.setExtras(results);
        Sentry.captureException(e);
      });
    } finally {
      transaction.finish();
      if (results.input.deploymentId) {
        await SpiritFish.deploymentUpdate(token, rendererId, results.input.deploymentId, { results });
      }
    }
  });

program
  .command('flush <renderer_id> <version>')
  .description(`Flush a version from your renderer's storage`)
  .action(async (rendererId, hash) => {
    const transaction = Sentry.startTransaction({ op: "Flush", name: "Flush a Version",});
    if (hash.startsWith('v.')) hash = hash.replace('v.', '');
    const spinner = ora(`Flushing v.${hash}...`).start();

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) {
      return spinner.fail(chalk.hex(TerminalColors.ORANGE)("Invalid auth. Please call `spirit-fish authenticate` or pass a --token"));
    }

    const results = {
      input: { rendererId, hash },
      operations: { flush: { warnings: [] } }
    };

    try {
      Sentry.addBreadcrumb({ message: "WILL_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });
      const data = await SpiritFish.deploymentCreate(token, rendererId, { hash, results });
      results.input.deploymentId = data.id;
      Sentry.addBreadcrumb({ message: "DID_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });

      const bunny = new Bunny();
      bunny.storage._baseConfig.headers = { AccessKey: data.storagezone.password };
      const flushResult = await attemptFlushDeployment(bunny, results, data.storagezone.name, hash);
      if (flushResult.status === "ok") {
        spinner.succeed(`${spinner.text} ${chalk.hex(TerminalColors.GREEN).bold('done!')}`);
      } else {
        spinner.fail(`${spinner.text} ${chalk.hex(TerminalColors.ORANGE)(`Flush failed: ${flushResult.reason}`)}`);
        results.operations.flush.warnings = [...results.operations.flush.warnings, flushResult.reason];
      }
    } catch(e) {
      const message = (e && e.message) ? e.message : "Error. Please try again.";
      spinner.fail(chalk.hex(TerminalColors.ORANGE)(message));
      Sentry.withScope(scope => {
        scope.setExtras(results);
        Sentry.captureException(e);
      });
    } finally {
      transaction.finish();
      if (results.input.deploymentId) {
        await SpiritFish.deploymentUpdate(token, rendererId, results.input.deploymentId, { results });
      }
    }
  });

program.parse(process.argv);
