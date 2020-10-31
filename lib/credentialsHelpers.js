const os = require('os');
const fs = require('fs');
const path = require('path');
const util = require('util');
const SpiritFish = require('./spiritFish');

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
    return {};
  }
};

const testToken = async (token) => {
  if (!token || token.length === 0) return false;
  try {
    return await SpiritFish.currentUser(token);
  } catch(e) {
    return false;
  }
};

module.exports = { storeCredentials, fetchCredentials, testToken };
