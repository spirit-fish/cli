#!/usr/bin/env node

const { Command } = require('commander');
const { v4: uuidv4 } = require('uuid');
const open = require('open');
const http = require('http');
const url = require('url');
const util = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');
const devcert = require('devcert');
const package = require('../package.json');

console.log(package.version);
const program = new Command();
program.version(package.version);

// https://www.gatsbyjs.com/docs/local-https/
// TODO: All commands should take a --token
// TODO: Regular tokens should expire after 30 days, and when used, be bumped by 30 days
// TODO: Should be able to generate a token for CI that never expires --token
// TODO: Should be able to list tokens and revoke them
// TODO: Should be able to see all of my filehosting versions
// TODO: Check for updates

program
  .option('-t, --token <token>', 'Pass a token instead of using our auth flow. Useful for CI tools.');

program
  .command('authenticate')
  .description('Authenticate your CLI with Spirit Fish')
  .action(() => {
    console.log(program.opts().token);
    // TODO: If passed a token, throw
  });

program
  .command('list')
  .description('List all of your renderers')
  .action(() => {
    // TODO
  });

program
  .command('deploy <renderer_id> <dir>')
  .option('-a, --activate <activate>', 'Set the version live immediately')
  .description('Push a new version of your project to a renderer')
  .action((rendererId, dir) => {
    // TODO
    // hash the dir
    // ensure it contains an index.html and no node_modules
    // upload as __spirit-fish-versions__/asdf_2020-Sept-02-timestamp
    // upload as current/__asdf_2020
    // Flush Cache
  });

program
  .command('activate <renderer_id> <version>')
  .description(`Push a new version of your project to a renderer's storage`)
  .action((rendererId, version) => {
    // TODO
  });

program
  .command('flush <renderer_id> <version>')
  .description(`Flush a version from your renderer's storage`)
  .action((rendererId, version) => {
    // TODO
  });

program.parse(process.argv);

const storeCredentials = async credentials => {
  const credentialsDir = `${os.homedir()}/.spirit-fish/`;
  if (!fs.existsSync(credentialsDir)){
    fs.mkdirSync(credentialsDir);
  }
  const credentialsAsJSON = JSON.stringify(credentials);
  const newFile = path.join(credentialsDir, 'credentials.json');
  await util.promisify(fs.writeFile)(newFile, credentialsAsJSON, 'utf8');
};

const fetchCredentials = () => {
  try {
    const credentialsFile = `${os.homedir()}/.spirit-fish/credentials.json`;
    const contents = fs.readFileSync(credentialsFile, 'utf8');
    return JSON.parse(contents);
  } catch(e) {
    return false;
  }
};

if (program.auth) {
  const existingCredentials = fetchCredentials();
  if (existingCredentials && existingCredentials.token) {
    // TODO Test Credentials against Server, if they're good, we back out!
  }

  (async () => {
    let timeout;
    const attempt = uuidv4();
    const ssl = await devcert.certificateFor('localhost');

    const server = http.createServer(ssl, async (req, res) => {
      const parsed = url.parse(req.url, true);
      const token = parsed.query.token;
      const returnedAttempt = parsed.query.attempt;

      if (returnedAttempt === attempt) {
        storeCredentials({ token });
        // TODO: Console Log
        res.writeHead(204);
        res.end();
      } else {
        // TODO: Console Log
        res.writeHead(401);
      }

      // In any case, shut down our server
      if (timeout) clearTimeout(timeout);
      req.connection.end();
      req.connection.destroy();
      server.close();
    }).listen(3474);

    // TODO: Make URL Dynamic
    // Opens the URL in the default browser.
    await open(`http://www.spiritfish.localhost:3000/auth/cli?attempt=${attempt}`);

    console.log("Waiting for browser auth...");
    timeout = setTimeout(function() {
      console.log("Timed out...");
      server.close()
    }, 30000);
  })();
}
