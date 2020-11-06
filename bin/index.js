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

// Sentry
const Sentry = require("@sentry/node");
const Tracing = require("@sentry/tracing");

// Internal
const SpiritFish = require('../lib/spiritFish');
const { say, Tones } = require('../lib/say');
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

// TODO: Should be able to list tokens and revoke them
// TODO: invalidations after succesful deploy'n'activate, or activate

program
  .option('-t, --token <token>', 'Pass a token instead of using our auth flow. Useful for CI tools.');

program
  .command('authenticate')
  .description('Authenticate your CLI with Spirit Fish')
  .action(async () => {
    if (program.opts().token) return say(Tones.WARN, `You may not pass a --token to this command.`);

    const existingCredentials = fetchCredentials();
    if (existingCredentials && existingCredentials.token) {
      if (await testToken(existingCredentials.token)) {
        return say(Tones.WARN, `You have a valid token. Use "spirit-fish unauthenticate" if you'd like to change users.`);
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
        say(Tones.SUCCESS, `You've been authenticated successfully!`);
        res.writeHead(204);
        res.end("ok");
      } else {
        say(Tones.ERROR, `The authentication request failed. Please try again.`);
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
    say(Tones.INFO, `Waiting for browser auth...`);
    timeout = setTimeout(function() {
      say(Tones.WARNING, `Browser auth timed out. Please try again.`);
      server.close()
    }, 30000);
  });

program
  .command('unauthenticate')
  .description('Unauthenticate your Spirit Fish CLI')
  .action(async () => {
    if (program.opts().token) return say(Tones.WARN, `You may not pass a --token to this command.`);
    storeCredentials({ token: null });
    say(Tones.SUCCESS, `Unauthenticated successfully.`);
  });

program
  .command('whoami')
  .description('Check the current token owner')
  .action(async () => {
    const token = program.opts().token || fetchCredentials().token;
    const currentUser = await testToken(token);
    if (currentUser) {
      return say(Tones.INFO, `Hello, ${currentUser.email}!`);
    } else {
      return say(Tones.WARN, `Invalid auth. Please call "spirit-fish authenticate" or pass a --token`);
    }
  });

program
  .command('token')
  .description('Generate a token for use with CI and the --token param')
  .action(async () => {
    const transaction = Sentry.startTransaction({
      op: "Generate Token",
      name: "Generate a Token",
    });

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) return say(Tones.WARN, `Invalid auth. Please call "spirit-fish authenticate or pass a --token`);

    try {
      const data = await SpiritFish.tokenCreate(token);
      say(Tones.WARN, `Please record this token! For security reasons it can not be retrieved again:`);
      say(Tones.SUCCESS, `Token Created: ${data.token}`);
    } catch(e) {
      console.log(e);
      say(Tones.WARN, `Error creating token`);
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
    const transaction = Sentry.startTransaction({
      op: "Invalidate Renderer",
      name: "Invalidate pages from Renderer",
    });

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) return say(Tones.WARN, `Invalid auth. Please call "spirit-fish authenticate or pass a --token`);

    const paths = args.paths || '*';
    try {
      const invalidation = await SpiritFish.invalidationCreate(token, rendererId, paths);
      say(Tones.SUCCESS, `Invalidated paths: ${paths}`);
    } catch(e) {
      console.log(e);
      say(Tones.WARN, `Error invalidating paths: ${paths}`);
      Sentry.captureException(e);
    } finally {
      transaction.finish();
    }
  });

program
  .command('renderers')
  .description('List all of your renderers')
  .action(async () => {
    const transaction = Sentry.startTransaction({
      op: "List Renderers",
      name: "List all Renderers",
    });

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) return say(Tones.WARN, `Invalid auth. Please call "spirit-fish authenticate or pass a --token`);

    try {
      const renderers = await SpiritFish.renderersIndex(token);
      renderers.forEach(r => say(Tones.INFO, `${r.id} ${r.nickname}`));
    } catch(e) {
      console.log(e);
      Sentry.captureException(e);
    } finally {
      transaction.finish();
    }
  });

program
  .command('deployments <renderer_id>')
  .description('List all of your deployments')
  .action(async (rendererId) => {
    const transaction = Sentry.startTransaction({
      op: "List Deployments",
      name: "List all Deployments for Renderer",
    });

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) return say(Tones.WARN, `Invalid auth. Please call "spirit-fish authenticate or pass a --token`);

    try {
      const data = await SpiritFish.rendererShow(token, rendererId);
      if (!data.storagezone) return say(Tones.WARN, `Never deployed.`);

      const bunny = new Bunny();
      bunny.storage._baseConfig.headers = { AccessKey: data.storagezone.password };

      const deploymentHashes = await bunny.storage.get(`${data.storagezone.name}/__SPIRIT_FISH_DEPLOYMENTS__`);
      if (deploymentHashes.lenth === 0) return say(Tones.WARN, `No deployments found`);

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
        say(h.active? Tones.SUCCESS : Tones.INFO, `${h.version} ${h.createdAt}`)
      });
    } catch(e) {
      console.log(e);
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
    const transaction = Sentry.startTransaction({
      op: "Deploy",
      name: "Deploy a Version",
    });

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) return say(Tones.WARN, `Invalid auth. Please call "spirit-fish authenticate or pass a --token`);

    const results = {
      input: { rendererId, dir, activate: args.activate },
      operations: { deploy: { files: [], warnings: [] } }
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
      Sentry.addBreadcrumb({ message: "DID_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });

      results.input.deploymentId = data.id;
      const storagezoneName = data.storagezone.name;

      const bunny = new Bunny();
      bunny.storage._baseConfig.headers = { AccessKey: data.storagezone.password };

      Sentry.addBreadcrumb({ message: "WILL_DEPLOY_VERSION", level: Sentry.Severity.Info });
      say(Tones.INFO, `Deploying ${dir}...`);

      const deployResult = await syncFolderToStorage(
        bunny,
        storagezoneName,
        path.join(process.cwd(), dir),
        `__SPIRIT_FISH_DEPLOYMENTS__/${hash}`
      );

      if (deployResult.status === "ok") {
        say(Tones.SUCCESS, `Deployed v.${hash}`);
        Sentry.addBreadcrumb({ message: "DID_DEPLOY_VERSION", level: Sentry.Severity.Info });
      } else {
        say(Tones.WARN, `Deployment failed: ${deployResult.reason}`);
        Sentry.addBreadcrumb({ message: "DEPLOY_VERSION_DID_FAIL", level: Sentry.Severity.Warning });
        results.operations.deploy.warnings = [...results.operations.deploy.warnings, deployResult.reason];
      }

      if (deployResult.status === "ok" && args.activate) {
        await attemptActivateDeployment(bunny, results, storagezoneName, hash);
      }
    } catch(e) {
      console.log(e);
      Sentry.captureException(e);
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
    const transaction = Sentry.startTransaction({
      op: "Activate",
      name: "Activate a Version",
    });

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) return say(Tones.WARN, `Invalid auth. Please call "spirit-fish authenticate or pass a --token`);

    if (hash.startsWith('v.')) hash = hash.replace('v.', '');

    const results = {
      input: { rendererId, hash },
      operations: { activate: { warnings: [] } }
    };

    try {
      Sentry.addBreadcrumb({ message: "WILL_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });
      const data = await SpiritFish.deploymentCreate(token, rendererId, { hash, results });
      Sentry.addBreadcrumb({ message: "DID_REGISTER_DEPLOYMENT_WITH_SERVER", level: Sentry.Severity.Info });

      results.input.deploymentId = data.id;
      const storagezoneName = data.storagezone.name;

      const bunny = new Bunny();
      bunny.storage._baseConfig.headers = { AccessKey: data.storagezone.password };
      await attemptActivateDeployment(bunny, results, storagezoneName, hash);
    } catch(e) {
      console.log(e);
      Sentry.captureException(e);
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
    const transaction = Sentry.startTransaction({
      op: "Flush",
      name: "Flush a Version",
    });

    const token = program.opts().token || fetchCredentials().token;
    if (!await testToken(token)) return say(Tones.WARN, `Invalid auth. Please call "spirit-fish authenticate or pass a --token`);

    if (hash.startsWith('v.')) hash = hash.replace('v.', '');

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
      await attemptFlushDeployment(bunny, results, data.storagezone.name, hash);
    } catch(e) {
      console.log(e);
      Sentry.captureException(e);
    } finally {
      transaction.finish();
      if (results.input.deploymentId) {
        await SpiritFish.deploymentUpdate(token, rendererId, results.input.deploymentId, { results });
      }
    }
  });

program.parse(process.argv);
