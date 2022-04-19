#!/usr/bin / env node
/* eslint-disable no-await-in-loop */
import Provider from './provider.js';
import XtreamClient from '../lib/xtream-codes-client.js';
import Logger from '../lib/logging.js';
import chalk from 'chalk';
import Bottleneck from 'bottleneck';
import ProgressBar from 'progress';
import ora from 'ora';

const logger = new Logger();

function tidyName(string) {
  return string
    .replace(/ 4k$/gi, '')
    .replace(/ cam$/gi, '')
    .replace(/ hd$/gi, '')
    .replace(/^sd :/gi, '')
    .replace(/ \(\d{4}\)$/g, '')
    .replace(/ - \d{4}$/g, '')
    .replace(/ -/g, '')
    .replace(/\\/g, '')
    .trim();
}

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 3000
});

export default class XtreamProvider extends Provider {
  constructor(redis, authorization, unattended = false) {
    const client = new XtreamClient({
      baseUrl: authorization.url,
      auth: {
        username: authorization.user,
        password: authorization.password
      },
      debug: false
    });
    super(redis, client);
    this.authorization = authorization;
    this.unattended = unattended;
  }

  async connect() {
    try {
      await this.client.authenticate();
      logger.success('Xtream Codes Logged In');
    } catch (error) {
      logger.error(
        chalk.bold(
          `Could not log into Xtream Codes using the provided credentials: ${this.authorization.url}, ${this.authorization.user}, ${this.authorization.password}`
        )
      );
      logger.error(
        chalk.bold('The server said: ') +
          error.statusCode +
          ' ' +
          error.statusMessage
      );
      process.exit(1);
    }
  }

  async getMovies() {
    const fetchingSpinner = ora('Fetching Movie List').start();
    const categories = (await this.client.getVodCategories()) || [];
    const streams = (await this.client.getVodStreams()) || [];
    fetchingSpinner.succeed('Received Movie List');
    const stats = {
      numberOfCategories: categories.length,
      numberOfMovies: streams.length
    };

    const bar = new ProgressBar(
      `:bar :current/:total :percent ETA: :eta | ${chalk.dim(
        'Adding movies & categories to cache'
      )}`,
      {
        complete: '\u001B[42m \u001B[0m',
        incomplete: '\u001B[41m \u001B[0m',
        width: 40,
        clear: true,
        total: stats.numberOfMovies + stats.numberOfCategories
      }
    );

    for (const category of categories) {
      const cachedCopy = await this.redis.exists(
        `category:${category.categoryId}`
      );

      if (cachedCopy) {
        bar.tick(1);
        continue;
      }

      this.redis.setnx(
        `category:${category.categoryId}:new`,
        JSON.stringify({
          xtream: category,
          name: tidyName(category.categoryName),
          imported: false
        })
      );
      bar.tick(1);
    }

    for (const movie of streams) {
      const cachedCopy = await this.redis.exists(`movie:${movie.streamId}`);

      if (cachedCopy) {
        bar.tick(1);
        continue;
      }

      this.redis.setnx(
        `movie:${movie.streamId}:new`,
        JSON.stringify({
          xtream: movie,
          name: tidyName(movie.name),
          categoryId: `category:${movie.categoryId}`,
          url: this.client.getStreamUrl({
            streamId: movie.streamId,
            wantedFormat: movie.containerExtension
          }),
          imported: false
        })
      );
      bar.tick(1);
    }

    return stats;
  }

  async processSeasons(seasons, showInfo, showId) {
    if (!seasons || seasons.length === 0) {
      return {
        numberOfSeasons: 0,
        numberOfEpisodes: 0
      };
    }

    let numberOfEpisodes = 0;

    for (const season of seasons) {
      const cachedCopy = await this.redis.exists(`season:${season.id}`);
      if (!cachedCopy) {
        this.redis.setnx(
          `season:${season.id}:new`,
          JSON.stringify({
            xtream: season,
            imported: false,
            showId: `show:${showId}`
          })
        );
      }

      let seasonEpisodesReference = null;
      // Xtream codes returns different types, sometimes it's an array of episodes,
      // sometimes it's an object keyed with episode numbers
      if (typeof showInfo.episodes !== 'undefined') {
        if (Array.isArray(showInfo.episodes) && showInfo.episodes.length > 0) {
          if (typeof showInfo.episodes[season.seasonNumber] !== 'undefined') {
            seasonEpisodesReference = showInfo.episodes[season.seasonNumber];
          }
        } else if (
          typeof showInfo.episodes[String(season.seasonNumber)] !== 'undefined'
        ) {
          seasonEpisodesReference =
            showInfo.episodes[String(season.seasonNumber)];
        }

        await this.processEpisodes(seasonEpisodesReference, season.id, showId);

        numberOfEpisodes += seasonEpisodesReference
          ? seasonEpisodesReference.length
          : 0;
      }
    }

    return {
      numberOfEpisodes,
      numberOfSeasons: seasons.length
    };
  }

  async processEpisodes(episodes, seasonId, showId) {
    if (!episodes || episodes.length === 0) {
      return {
        numberOfEpisodes: 0
      };
    }

    for (const episode of episodes) {
      const cachedCopy = await this.redis.exists(`episode:${episode.id}`);
      if (cachedCopy) continue;

      delete episode.info.video;
      delete episode.info.audio;

      this.redis.setnx(
        `episode:${episode.id}:new`,
        JSON.stringify({
          xtream: episode,
          imported: false,
          seasonId: `season:${seasonId}`,
          showId: `show:${showId}`,
          url: this.client.getStreamUrl(
            {
              streamId: episode.id,
              wantedFormat: episode.containerExtension,
              streamType: 'series'
            },
            true
          )
        })
      );
    }

    return {
      numberOfEpisodes: episodes.length
    };
  }

  async getTV() {
    const throbber = ora('Fetching Series List').start();
    const series = (await this.client.getSeries()) || [];
    const seriesCategories = (await this.client.getSeriesCategories()) || [];
    throbber.succeed('Received Series List');

    const stats = {
      numberOfShows: series.length,
      numberOfSeasons: 0,
      numberOfEpisodes: 0,
      numberOfCategories: seriesCategories.length
    };

    const bar = new ProgressBar(
      `:bar :current/:total :percent ETA: :eta | ${chalk.dim(
        'Caching info for :show'
      )}`,
      {
        complete: '\u001B[42m \u001B[0m',
        incomplete: '\u001B[41m \u001B[0m',
        width: 40,
        clear: true,
        total: stats.numberOfShows + stats.numberOfCategories
      }
    );

    const interruptString = chalk.yellow.bold(
      'This is rate limited to 1 request every 3 seconds to avoid being banned by Xtream for flooding'
    );

    if (this.unattended) {
      console.log(interruptString);
    } else {
      bar.interrupt(interruptString);
    }

    for (const category of seriesCategories) {
      const cachedCopy = await this.redis.exists(
        `category:${category.categoryId}`
      );
      if (cachedCopy) {
        bar.tick({
          show: category.categoryName
        });
        continue;
      }

      this.redis.setnx(
        `category:${category.categoryId}:new`,
        JSON.stringify({
          xtream: category,
          name: tidyName(category.categoryName),
          imported: false
        })
      );

      bar.tick({
        show: category.categoryName
      });
    }

    for (const show of series) {
      const cachedCopy =
        (await this.redis.get(`show:${show.seriesId}`)) ||
        (await this.redis.get(`show:${show.seriesId}:new`));

      let showInfo = cachedCopy ? JSON.parse(cachedCopy).xtream : null;

      if (!cachedCopy) {
        showInfo = await limiter.schedule(() =>
          this.client.getSeriesInfo(show.seriesId)
        );

        const showInfoCopy = { ...showInfo };
        delete showInfoCopy.episodes;
        delete showInfoCopy.seasons;
        this.redis.set(
          `show:${show.seriesId}:new`,
          JSON.stringify({
            xtream: showInfoCopy,
            imported: false,
            name: tidyName(showInfo.info.name),
            categoryId: `category:${show.categoryId}`
          })
        );
      }

      //
      showInfo = await limiter.schedule(() =>
        this.client.getSeriesInfo(show.seriesId)
      );

      if (showInfo.seasons) {
        const { numberOfEpisodes, numberOfSeasons } = await this.processSeasons(
          showInfo.seasons,
          showInfo,
          show.seriesId
        );

        stats.numberOfSeasons += numberOfSeasons;
        stats.numberOfEpisodes += numberOfEpisodes;
      }

      bar.tick({
        show: show.name
      });
    }

    return stats;
  }
}
