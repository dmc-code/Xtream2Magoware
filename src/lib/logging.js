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
      this.log = (message, bar) => {
        if (bar?.curr <= bar?.total) {
          bar.interrupt(message);
        } else {
          process.stdout.write(message + '\n');
        }
      };
    }
  }

  success(message, bar) {
    this.log(chalk.greenBright(`✔ ${message}`), bar);
  }

  error(message, bar) {
    this.log(chalk.red(`✖ ${message}`), bar);
  }

  info(message, bar) {
    this.log(`ℹ ${message}`, bar);
  }

  warn(message, bar) {
    this.log(chalk.yellow(`⚠ ${message}`), bar);
  }
}

export default Logger;
