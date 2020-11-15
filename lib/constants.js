const chalk = require("chalk");

const TerminalColors = {
  ORANGE: '#F2746F',
  GREEN: '#1CA586'
};

const Tones = {
  INFO: {
    bearer: '🐠',
    color: chalk.magenta
  },
  WARN: {
    bearer: '⚠️',
    color: chalk.hex(TerminalColors.ORANGE)
  },
  SUCCESS: {
    bearer: '✅',
    color: chalk.hex(TerminalColors.GREEN)
  },
  ERROR: {
    bearer: '❌',
    color: chalk.hex(TerminalColors.ORANGE)
  },
};

module.exports = { TerminalColors };
