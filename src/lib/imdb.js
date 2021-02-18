import { searchMovie, scrapper, stopCacheClear } from 'imdb-scrapper';
import querystring from 'querystring';
import stringSimilarity from 'string-similarity';

import Logger from './logging.js';
const logger = new Logger({ disable: true });

stopCacheClear();

class IMDB {
  constructor() {
    this.client = { searchMovie, scrapper };
  }

  async findMovie(title) {
    try {
      logger.info('Searching IMDB for ' + title);
      const movieResults = await this.client.searchMovie(
        querystring.escape(title)
      );
      if (movieResults.length > 0) {
        const result = movieResults[0];

        let similarity = stringSimilarity.compareTwoStrings(
          result.title.toLowerCase(),
          title.toLowerCase()
        );

        if (
          result.title !== result.originalTitle &&
          typeof result.originalTitle !== 'undefined'
        ) {
          const newSimilarity = stringSimilarity.compareTwoStrings(
            result.originalTitle.toLowerCase(),
            title.toLowerCase()
          );

          if (newSimilarity > similarity) {
            similarity = newSimilarity;
          }
        }

        if (similarity > 0.8) {
          const movieIMDB = await this.client.scrapper(result.id);
          return movieIMDB;
        }
      }
    } catch (error) {
      logger.error(`Couldn't search IMDB for ${title}`, {
        error: (error.response && error.response.body) || error
      });
    }

    return false;
  }
}

export default new IMDB();
