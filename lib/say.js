const chalk = require("chalk");

const Tones = {
  INFO: {
    bearer: '🐠',
    color: chalk.magenta
  },
  WARN: {
    bearer: '⚠️',
    color: chalk.yellow
  },
  SUCCESS: {
    bearer: '✅',
    color: chalk.green
  },
  ERROR: {
    bearer: '❌',
    color: chalk.red
  },
};

const say = (tone = Tones.INFO, text) => {
  console.log(tone.color(`${tone.bearer}  ~~~~> ${text}`));
};

module.exports = { say, Tones };
