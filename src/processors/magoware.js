#!/usr/bin/env node
/* eslint max-params: ["error", 5] */

import Bottleneck from 'bottleneck';
import ora from 'ora';
import chalk from 'chalk';
import ProgressBar from 'progress';
import Processor from './processor.js';
import MagowareClient from '../lib/magoware-client.js';
import XtreamClient from '../lib/xtream-codes-client.js';
import Logger from '../lib/logging.js';
import IMDB from '../lib/imdb.js';
import {
  normalizeMovieInformation,
  normalizeShowInformation,
  normalizeSeasonInformation,
  normalizeEpisodeInformation
} from '../lib/normalize.js';
import { AlreadyExistsError } from '../lib/errors.js';

const logger = new Logger();

const progressMock = { tick: () => {}, interrupt: console.log };

const IntlFormatter = new Intl.NumberFormat('en-US');

export default class MagowareProcessor extends Processor {
  constructor(redis, authentication, xtream, unattended, tvOnly) {
    const client = new MagowareClient(authentication);
    super(redis, client);

    this.xtreamClient = new XtreamClient({
      baseUrl: xtream.url,
      auth: {
        username: xtream.user,
        password: xtream.password
      },
      debug: false
    });

    this.unattended = unattended;
    this.skipMovieImport = tvOnly;
    this.categoryBar = progressMock;
    this.movieBar = progressMock;
    this.showBar = progressMock;
    this.seasonBar = progressMock;
    this.episodeBar = progressMock;

    this.movieLimiter = new Bottleneck({
      maxConcurrent: 20
    });

    this.xtreamLimiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 3000
    });

    this.categoryLimiter = new Bottleneck({
      maxConcurrent: 40
    });

    this.episodeLimiter = new Bottleneck({
      maxConcurrent: 10
    });

    this.movieErrorCount = 0;
    this.movieSuccessCount = 0;
    this.showErrorCount = 0;
    this.showSuccessCount = 0;
    this.seasonErrorCount = 0;
    this.seasonSuccessCount = 0;
    this.episodeErrorCount = 0;
    this.episodeSuccessCount = 0;
    this.categoryErrorCount = 0;
    this.categorySuccessCount = 0;

    this.categoryKeys = [];
    this.movieKeys = [];
    this.showKeys = [];
    this.seasonKeys = [];
    this.episodeKeys = [];
  }

  async findShow(name, categoryId) {
    try {
      let show = (await this.client.searchTMDB(name, true)) || null;

      if (show) show = normalizeShowInformation(show, categoryId);

      return show;
    } catch (error) {
      logger.error(error);
    }
  }

  async searchTmdb(name) {
    let response = null;
    try {
      response = await this.client.searchTMDB(name);
    } catch (error) {
      logger.error('tmdb error', error);
    }

    return response;
  }

  async searchXtream(id) {
    let response = null;
    try {
      response = await this.xtreamLimiter.schedule(() =>
        this.xtreamClient.getVodInfo(id)
      );

      if (
        typeof response?.info?.tmdbId === 'undefined' ||
        typeof response?.info?.name === 'undefined' ||
        typeof response?.info?.description === 'undefined'
      ) {
        return null;
      }
    } catch (error) {
      logger.error('xtream vod info error', error);
    }

    return response;
  }

  async findMovie(name, xtream, categoryId) {
    try {
      let movie;

      logger.info(`Searching Xtream for: ${name}`, this.movieBar);
      movie = await this.searchXtream(xtream.streamId);

      if (!movie) {
        logger.info(
          `Data not in Xtream. Searching TMDB for: ${name}`,
          this.movieBar
        );
        movie = await this.searchTmdb(name);

        if (!movie) {
          logger.info(
            `Data not in TMDB. Searching IMDB for: ${name}`,
            this.movieBar
          );
          movie = await IMDB.findMovie(name);
        }
      }

      if (movie) movie = normalizeMovieInformation(movie, categoryId);

      return movie;
    } catch (error) {
      logger.error(`find movie error for ${name}`, this.movieBar);
      console.log(error);
    }
  }

  async getCategory(categoryKey) {
    const record =
      (await this.redis.get(categoryKey)) ||
      (await this.redis.get(categoryKey + ':new'));

    if (record) {
      const category = JSON.parse(record);

      if (!category.imported) {
        const newCategory = await this.processCategory(
          categoryKey + ':new',
          category
        );
        return {
          id: newCategory.magoware.id,
          name: newCategory.name
        };
      }

      return {
        id: category.magoware.id,
        name: category.name
      };
    }
  }

  async processCategory(key, data) {
    let category = false;
    if (data) {
      category = data;
    } else {
      const response = (await this.redis.get(key)) || null;

      if (response) {
        category = JSON.parse(response);
      }
    }

    const name = category.xtream.categoryName;

    const magowareResponse = await this.client.addVodCategory({ name });
    category.magoware = magowareResponse;
    category.imported = true;

    await this.redis.set(key, JSON.stringify(category));
    await this.redis.rename(key, key.replace(':new', ''));

    this.categoryBar.tick(1);
    return { success: true, key };
  }

  async processMovie(key) {
    const record = await this.redis.get(key);
    const movie = JSON.parse(record);

    // The .getCategory() method will process the category if it has not yet been imported
    // if we have it in cache it will return a simplified category object
    const { id: categoryId } = await this.getCategory(movie.categoryId);

    // Use cached movieInformation or go find movie details
    const movieInformation =
      movie.movieInformation ||
      (await this.findMovie(movie.name, movie.xtream, categoryId));

    // Skip import if we can't find any movie details
    if (!movieInformation) {
      this.movieErrorCount++;
      this.movieBar.interrupt(
        chalk.dim('Skipping movie ' + chalk.bold(movie.name))
      );
      this.movieBar.tick(1);
      return false;
    }

    // Update cache with our import template
    movie.movieInformation = movieInformation;
    await this.redis.set(key, JSON.stringify(movie));

    if (movie.imported === false) {
      try {
        if (!movieInformation.duplicated) {
          const magowareMovie = await this.client.importMovie(
            movieInformation,
            movie.url
          );
          movie.imported = true;
          movie.magoware = magowareMovie;
        }
      } catch (error) {
        if (error instanceof AlreadyExistsError) {
          movie.imported = true;
          movie.magoware = { id: movieInformation.id, duplicated: true };
        } else {
          this.movieBar.interrupt(
            chalk.red(`Failed! ${chalk.bold(movie.name)}`)
          );
          this.movieErrorCount++;
        }
      }
    }

    if (movie.imported) {
      await this.redis.set(key, JSON.stringify(movie));

      // Report of our success
      this.movieSuccessCount++;

      // Removing :new from the key removes this entry from the job queue
      await this.redis.rename(key, key.replace(':new', ''));
    }

    this.movieBar.tick(1);
    return { success: true, key };
  }

  async getAllLocalEpisodeData(key) {
    const container = {
      category: null,
      show: null,
      season: null,
      episode: null
    };
    const recordEpisode = await this.redis.get(key);

    container.episode = recordEpisode ? JSON.parse(recordEpisode) : null;

    if (container.episode) {
      const recordShow = await this.redis.get(container.episode.showId);

      const recordSeason = await this.redis.get(container.episode.seasonId);

      container.show = recordShow ? JSON.parse(recordShow) : null;
      container.season = recordSeason ? JSON.parse(recordSeason) : null;

      if (container.show) {
        container.category = await this.getCategory(container.show.categoryId);
      }
    }

    return container;
  }

  async processSeason(key) {
    const response = (await this.redis.get(key)) || null;
    const season = response ? JSON.parse(response) : null;

    if (season) {
      const showResponse = await this.redis.get(season.showId);
      const show = JSON.parse(showResponse);

      if (!show) {
        console.log('\n\nShow was null for', show, '\n\n');
        this.seasonErrorCount++;
        this.seasonBar.interrupt(
          chalk.dim('Skipping season ' + chalk.bold(seasonInformation.name))
        );
        this.seasonBar.tick(1);
        return false;
      }

      const seasonInformation =
        season.seasonInformation ||
        normalizeSeasonInformation(season.xtream, show);

      // Skip import if we can't find any details
      if (!seasonInformation) {
        this.seasonErrorCount++;
        this.seasonBar.interrupt(
          chalk.dim('Skipping season ' + chalk.bold(seasonInformation.name))
        );
        this.seasonBar.tick(1);
        return false;
      }

      // Update cache with our import template
      season.seasonInformation = seasonInformation;
      await this.redis.set(key, JSON.stringify(season));

      try {
        const magowareResponse = await this.client.importSeason(
          season.seasonInformation
        );
        season.magoware = magowareResponse;
        season.imported = true;
      } catch (error) {
        if (error instanceof AlreadyExistsError) {
          season.imported = true;
          season.magoware = { id: seasonInformation.id, duplicated: true };
        } else {
          console.log(error);
        }
      }

      if (season.imported) {
        await this.redis.set(key, JSON.stringify(season));
        await this.redis.rename(key, key.replace(':new', ''));

        this.seasonBar.tick(1);
        this.seasonSuccessCount++;
      }

      return { success: true, key };
    }
  }

  async processShow(key) {
    const response = (await this.redis.get(key)) || null;
    const show = response ? JSON.parse(response) : null;

    const { id: categoryId } = await this.getCategory(show.categoryId);

    if (show) {
      const showInformation =
        show.showInformation || (await this.findShow(show.name, categoryId));

      // Skip import if we can't find any details
      if (!showInformation) {
        this.showErrorCount++;
        this.showBar.interrupt(
          chalk.dim('Skipping show ' + chalk.bold(show.name))
        );
        this.showBar.tick(1);
        return false;
      }

      // Update cache with our import template
      show.showInformation = showInformation;
      await this.redis.set(key, JSON.stringify(show));

      try {
        const magowareResponse = await this.client.importShow(
          show.showInformation
        );
        show.magoware = magowareResponse;
        show.imported = true;
      } catch (error) {
        if (error instanceof AlreadyExistsError) {
          show.imported = true;
          show.magoware = { id: showInformation.id, duplicated: true };
        } else {
          throw error;
        }
      }

      if (show.imported) {
        await this.redis.set(key, JSON.stringify(show));
        await this.redis.rename(key, key.replace(':new', ''));
        this.showSuccessCount++;
        this.showBar.tick(1);
      }
    }

    return { success: true, key };
  }

  async processEpisode(key) {
    const {
      category,
      show,
      season,
      episode
    } = await this.getAllLocalEpisodeData(key);

    if (category?.id && show?.imported && season?.imported) {
      if (episode?.imported === false) {
        const episodeInformation =
          episode.episodeInformation ||
          normalizeEpisodeInformation(episode.xtream, season, show);

        // Skip import if we can't find any details
        if (!episodeInformation) {
          this.episodeErrorCount++;
          this.episodeBar.interrupt(
            chalk.dim('Skipping episode ' + chalk.bold(episode.xtream.title))
          );
          this.episodeBar.tick(1);
          return false;
        }

        // Update cache with our import template
        episode.episodeInformation = episodeInformation;
        await this.redis.set(key, JSON.stringify(episode));

        try {
          const magowareResponse = await this.client.importEpisode(
            episode.episodeInformation,
            episode.url,
            show
          );
          episode.magoware = magowareResponse;
          episode.imported = true;
        } catch (error) {
          if (error instanceof AlreadyExistsError) {
            episode.imported = true;
            episode.magoware = { id: episodeInformation.id, duplicated: true };
          } else {
            this.episodeErrorCount++;
            console.log(error);
          }
        }

        if (episode.imported) {
          await this.redis.set(key, JSON.stringify(episode));
          await this.redis.rename(key, key.replace(':new', ''));

          this.episodeBar.tick(1);
          this.episodeSuccessCount++;
        }
      }
    } else {
      this.episodeBar.interrupt(
        chalk.dim(`Skipping episode [name] for ${chalk.bold(show.name)}`)
      );
      this.episodeErrorCount++;
      this.episodeBar.tick(1);
      return false;
    }

    return { success: true, key };
  }

  jobErrorHandlers(error) {
    if (error.message === 'Authorize with magoware first') {
      logger.error(error);
      process.exit(1);
    }

    console.log(error);
  }

  async doJobs(categoryKeys, movieKeys, showKeys, seasonKeys, episodeKeys) {
    const barDefaults = {
      complete: '\u001B[42m \u001B[0m',
      incomplete: '\u001B[41m \u001B[0m',
      width: 40,
      clear: true
    };
    const barString = ':bar :current/:total :percent ETA: :eta';

    if (!this.unattended) {
      if (categoryKeys.length > 0) {
        this.categoryBar = new ProgressBar(
          `${barString} | ${chalk.dim('Importing categories to magoware')}`,
          {
            ...barDefaults,
            total: categoryKeys.length
          }
        );
      }

      if (movieKeys.length > 0 && !this.skipMovieImport) {
        this.movieBar = new ProgressBar(
          `${barString} | ${chalk.dim('Importing movies to magoware')}`,
          {
            ...barDefaults,
            total: movieKeys.length
          }
        );
      }

      if (showKeys.length > 0) {
        this.showBar = new ProgressBar(
          `${barString} | ${chalk.dim('Importing tv shows to magoware')}`,
          {
            ...barDefaults,
            total: showKeys.length
          }
        );
      }

      if (seasonKeys.length > 0) {
        this.seasonBar = new ProgressBar(
          `${barString} | ${chalk.dim('Importing tv seasons to magoware')}`,
          {
            ...barDefaults,
            total: seasonKeys.length
          }
        );
      }

      if (episodeKeys.length > 0) {
        this.episodeBar = new ProgressBar(
          `${barString} | ${chalk.dim('Importing tv episodes to magoware')}`,
          {
            ...barDefaults,
            total: episodeKeys.length
          }
        );
      }
    }

    if (categoryKeys.length > 0) {
      const categoryProcessing = categoryKeys.map((key) => {
        return this.categoryLimiter
          .schedule(this.processCategory.bind(this, key))
          .catch(this.jobErrorHandlers);
      });

      await Promise.allSettled(categoryProcessing);
    }

    if (movieKeys.length > 0 && !this.skipMovieImport) {
      const movieProcessing = movieKeys.map((key) => {
        return this.movieLimiter
          .schedule(this.processMovie.bind(this, key))
          .catch(this.jobErrorHandlers);
      });

      await Promise.allSettled(movieProcessing);
    }

    if (showKeys.length > 0) {
      const showProcessing = showKeys.map((key) => {
        return this.movieLimiter
          .schedule(this.processShow.bind(this, key))
          .catch(this.jobErrorHandlers);
      });

      await Promise.allSettled(showProcessing);
    }

    if (seasonKeys.length > 0) {
      const seasonProcessing = seasonKeys.map((key) => {
        return this.movieLimiter
          .schedule(this.processSeason.bind(this, key))
          .catch(this.jobErrorHandlers);
      });

      await Promise.allSettled(seasonProcessing);
    }

    if (episodeKeys.length > 0) {
      const episodeProcessing = episodeKeys.map((key) => {
        return this.episodeLimiter
          .schedule(this.processEpisode.bind(this, key))
          .catch(this.jobErrorHandlers);
      });

      await Promise.allSettled(episodeProcessing);
    }
  }

  async process(tvOnly) {
    super.process();

    if (tvOnly) {
      this.skipMovieImport = tvOnly;
    }

    this.movieErrorCount = 0;
    this.movieSuccessCount = 0;
    this.episodeErrorCount = 0;
    this.episodeSuccessCount = 0;
    this.showErrorCount = 0;
    this.showSuccessCount = 0;
    this.seasonErrorCount = 0;
    this.seasonSuccessCount = 0;
    this.categoryErrorCount = 0;
    this.categorySuccessCount = 0;

    await this.client.authorize();

    const jobsSpinner = ora('Looking for new items to import').start();

    const categoriesPromise = this.redis.getKeysMatching('category:*:new');
    const moviePromise = this.redis.getKeysMatching('movie:*:new');
    const showPromise = this.redis.getKeysMatching('show:*:new');
    const seasonPromise = this.redis.getKeysMatching('season:*:new');
    const episodePromise = this.redis.getKeysMatching('episode:*:new');

    const [
      categoriesKeys,
      movieKeys,
      showKeys,
      seasonKeys,
      episodeKeys
    ] = await Promise.all([
      categoriesPromise,
      moviePromise,
      showPromise,
      seasonPromise,
      episodePromise
    ]);

    this.movieKeys = movieKeys;
    this.episodeKeys = episodeKeys;
    this.categoriesKeys = categoriesKeys;
    this.showKeys = showKeys;
    this.seasonKeys = seasonKeys;

    jobsSpinner.succeed(
      `Found ${IntlFormatter.format(
        (this.skipMovieImport ? 0 : movieKeys.length) +
          episodeKeys.length +
          categoriesKeys.length +
          showKeys.length +
          seasonKeys.length
      )} new jobs!`
    );

    logger.success(
      `${chalk.bold(IntlFormatter.format(categoriesKeys.length))} category jobs`
    );

    if (!this.skipMovieImport) {
      logger.success(
        `${chalk.bold(IntlFormatter.format(movieKeys.length))} movie jobs`
      );
    }

    logger.success(
      `${chalk.bold(IntlFormatter.format(showKeys.length))} show jobs`
    );
    logger.success(
      `${chalk.bold(IntlFormatter.format(seasonKeys.length))} season jobs`
    );
    logger.success(
      `${chalk.bold(IntlFormatter.format(episodeKeys.length))} episode jobs`
    );

    await this.doJobs(
      categoriesKeys,
      movieKeys,
      showKeys,
      seasonKeys,
      episodeKeys
    );
  }

  async destroy() {
    super.destroy();

    const skipped =
      this.movieKeys.length +
      this.episodeKeys.length +
      this.showKeys.length +
      this.seasonKeys.length +
      this.categoryKeys.length -
      this.categoryErrorCount -
      this.categorySuccessCount -
      this.movieErrorCount -
      this.movieSuccessCount -
      this.showErrorCount -
      this.showSuccessCount -
      this.seasonErrorCount -
      this.seasonSuccessCount -
      this.episodeErrorCount -
      this.episodeSuccessCount;

    if (skipped) {
      logger.error(
        `The process was quit before it could finish running ${chalk.bold(
          IntlFormatter.format(skipped)
        )} jobs.`
      );
    }

    if (this.movieSuccessCount) {
      logger.success(
        `Imported ${chalk.bold(
          IntlFormatter.format(this.movieSuccessCount)
        )} movies!`
      );
    }

    if (this.episodeSuccessCount) {
      logger.success(
        `Imported ${chalk.bold(
          IntlFormatter.format(this.episodeSuccessCount)
        )} episodes!`
      );
    }

    if (this.movieErrorCount) {
      logger.error(
        `Could not import ${chalk.bold(
          IntlFormatter.format(this.movieErrorCount)
        )} movies!`
      );
    }

    if (this.showErrorCount) {
      logger.error(
        `Could not import ${chalk.bold(
          IntlFormatter.format(this.showErrorCount)
        )} shows!`
      );
    }

    if (this.episodeErrorCount) {
      logger.error(
        `Could not import ${chalk.bold(
          IntlFormatter.format(this.episodeErrorCount)
        )} episodes!`
      );
    }
  }
}
