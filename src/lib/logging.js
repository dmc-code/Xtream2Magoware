import chalk from 'chalk';

class Logger {
  constructor(options = {}) {
    if (options.disable) {
      this.log = () => {};
      this.success = this.log;
      this.error = this.log;
      this.info = this.log;
      this.warn = this.log;
    } else {
      this.log = (message) => process.stdout.write(message + '\n');
    }
  }

  success(message) {
    this.log(chalk.greenBright(`✔ ${message}`));
  }

  error(message) {
    this.log(chalk.red(`✖ ${message}`));
  }

  info(message) {
    this.log(`ℹ ${message}`);
  }

  warn(message) {
    this.log(chalk.yellow(`⚠ ${message}`));
  }
}

export default Logger;
