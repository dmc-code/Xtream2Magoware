import Logger from '../lib/logging.js';
import chalk from 'chalk';
const logger = new Logger();

const IntlFormatter = new Intl.NumberFormat('en-US');

export default class Provider {
  constructor(redis, client) {
    this.redis = redis;
    this.client = client;
  }

  async connect() {}

  async hydrateLocalCache(shouldGetMovies, shouldGetTV) {
    await this.connect();

    if (shouldGetMovies) {
      try {
        const { numberOfCategories, numberOfMovies } = await this.getMovies();
        logger.success(
          `Synced ${chalk.bold(
            IntlFormatter.format(numberOfMovies)
          )} movies over ${chalk.bold(
            numberOfCategories
          )} categories to local cache`
        );
      } catch (error) {
        logger.error('There was an error syncing movies');
        console.log(error);
      }
    }

    if (shouldGetTV) {
      try {
        const {
          numberOfShows,
          numberOfSeasons,
          numberOfEpisodes,
          numberOfCategories
        } = await this.getTV();
        logger.success(
          `Synced ${chalk.bold(
            IntlFormatter.format(numberOfShows)
          )} shows, ${chalk.bold(
            IntlFormatter.format(numberOfSeasons)
          )} seasons and ${chalk.bold(
            IntlFormatter.format(numberOfEpisodes)
          )} episodes over ${chalk.bold(
            IntlFormatter.format(numberOfCategories)
          )} categories to local cache`
        );
      } catch (error) {
        logger.error('There was an error syncing TV');
        console.log(error);
      }
    }

    return true;
  }

  async destroy() {
    logger.warn('Shutting down Provider');
  }

  async getMovies() {
    const numberOfCategories = 0;
    const numberOfMovies = 0;

    return {
      numberOfCategories,
      numberOfMovies
    };
  }

  async getTV() {
    const numberOfShows = 0;
    const numberOfSeasons = 0;
    const numberOfEpisodes = 0;
    const numberOfCategories = 0;

    return {
      numberOfShows,
      numberOfSeasons,
      numberOfEpisodes,
      numberOfCategories
    };
  }
}
