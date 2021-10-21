#!/usr/bin/env node
import prompts from 'prompts';
import Logger from './lib/logging.js';
import XtreamProvider from './providers/xtream.js';
import MagowareProcessor from './processors/magoware.js';

const logger = new Logger();

const enableTerminalCursor = () => {
  process.stdout.write('\u001B[?25h');
};

class App {
  constructor(redis, options) {
    this.options = options;
    this.endProcessGracefully = this._endProcessGracefully.bind(this);
    this.redis = redis;
    this.provider = new XtreamProvider(
      this.redis,
      this.options.xtream,
      this.options.unattended
    );
    this.processor = new MagowareProcessor(
      this.redis,
      this.options.magoware,
      this.options.xtream,
      this.options.unattended
    );
    this.onState = this._onState.bind(this);

    this.xtreamQuestions = [
      {
        onState: this.onState,
        type: 'confirm',
        name: 'gotoXtream',
        message: 'Do you want to get data from Xtream Codes?',
        initial: false
      },
      {
        onState: this.onState,
        type: (previous, answers) => (answers.gotoXtream ? 'confirm' : null),
        name: 'getMovieData',
        message: 'Should we get Movie data?',
        initial: false
      },
      {
        onState: this.onState,
        type: (previous, answers) => (answers.gotoXtream ? 'confirm' : null),
        name: 'getTvData',
        message: 'Should we get TV data?',
        initial: false
      }
    ];

    this.processorQuestions = [
      {
        onState: this.onState,
        type: 'confirm',
        name: 'import',
        message: 'Do you want to import data to Magoware?',
        initial: false
      }
    ];
  }

  _onState(state) {
    if (state.aborted) {
      // If we don't re-enable the terminal cursor before exiting
      // the program, the cursor will remain hidden
      enableTerminalCursor();
      process.stdout.write('\n');
      process.exit(0);
    }
  }

  async begin() {
    const xtreamResponses = this.options.unattended
      ? {
          gotoXtream: true,
          getMovieData: true,
          getTvData: true
        }
      : await prompts(this.xtreamQuestions);

    if (xtreamResponses.gotoXtream && !this.options.importOnly) {
      await this.provider.hydrateLocalCache(
        xtreamResponses.getMovieData,
        xtreamResponses.getTvData
      );
    } else if (this.options.importOnly) {
      logger.warn('Import Only flag was passed. Skipping sync.');
    }

    const magowareResponses = this.options.unattended
      ? {
          import: true
        }
      : await prompts(this.processorQuestions);

    if (magowareResponses.import && !this.options.syncOnly) {
      await this.processor.process();
    } else if (this.options.syncOnly) {
      logger.info('Sync Only flag was passed. Skipping Import.');
    }

    // Nothing more to process
    process.exit(0);
  }

  async _endProcessGracefully(callback) {
    try {
      logger.warn('Attempting to exit gracefully...');
      await this.redis.quit();
      logger.success('Disconnected from redis');
      await this.provider.destroy();
      await this.processor.destroy();
      if (typeof callback === 'function') {
        callback();
      } else {
        process.exit(0);
      }
    } catch (error) {
      logger.error('Could not exit gracefully, killing process');
      console.log(error);
      process.kill(process.pid, 'SIGKILL');
    }
  }
}

export default App;
