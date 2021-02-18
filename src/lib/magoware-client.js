/* eslint-disable camelcase */
import querystring from 'querystring';
import got from 'got';
import Logger from './logging.js';
import { AlreadyExistsError } from './errors.js';
import FormData from 'form-data';

const logger = new Logger();

export default class MagowareClient {
  constructor({ url, user, password } = {}) {
    this.hostname = url;
    this.user = user;
    this.password = password;
    this.token = null;
    this.gotDefaults = {
      responseType: 'json',
      retry: 0,
      headers: {
        Authorization: this.token // Set when magoware token granted
      }
    };
  }

  tokenGuard() {
    if (this.token) {
      return true;
    }

    throw new Error('Authorize with magoware first');
  }

  async authorize() {
    logger.info('Logging in to Magoware');
    try {
      const { body } = await got.post(`${this.hostname}/api/auth/login`, {
        json: {
          username: this.user,
          password: this.password
        },
        responseType: 'json'
      });
      logger.success('Magoware access granted');
      this.token = body.token;
      this.gotDefaults.headers.Authorization = this.token;

      this.streamSources = [];

      const { body: streamSourceBody } = await got.get(
        `${this.hostname}/api/VodStreamSources?_end=-1&_start=0`,
        {
          ...this.gotDefaults
        }
      );
      this.streamSources = streamSourceBody;

      return this.token;
    } catch (error) {
      logger.error(`Couldn't obtain magoware token!`, {
        error: (error.response && error.response.body) || error
      });
      throw error;
    }
  }

  async searchTMDB(title, series = false) {
    if (!this.tokenGuard()) return;

    let debug = false;
    if (title === 'Merry Christmas Mr. Bean') {
      debug = true;
    }

    if (debug) console.log('mr bean debug');
    let match = null;
    try {
      const url = series
        ? `${
            this.hostname
          }/api/tmdbseries?_end=1&_orderBy=id&_orderDir=DESC&_start=0&q=${querystring.escape(
            title.replace(/ /g, '+')
          )}`
        : `${
            this.hostname
          }/api/tmdbvods?_end=1&_orderBy=id&_orderDir=DESC&_start=0&q=${querystring.escape(
            title.replace(/ /g, '+')
          )}`;

      const { body } = await got.get(url, { ...this.gotDefaults });
      match = body.length > 0 ? body[0] : false;
    } catch (error) {
      logger.error('Search resulted in an error');
      console.log(error);
    }

    if (match) {
      const url = series
        ? `${this.hostname}/api/tmdbseries/${match.id}`
        : `${this.hostname}/api/tmdbvods/${match.id}`;

      const { body } = await got.get(url, { ...this.gotDefaults });
      return body;
    }

    return false;
  }

  async addVodCategory(category) {
    if (!this.tokenGuard()) return;

    const fullListResponse = await got.get(
      `${this.hostname}/api/VodCategories?_end=100&_orderBy=id&_orderDir=DESC&_start=0`,
      {
        ...this.gotDefaults
      }
    );
    const fullList = fullListResponse.body;

    const foundMatch = fullList.find((magowareCategory) => {
      return (
        magowareCategory.name.trim().toLowerCase() ===
        category.name.trim().toLowerCase()
      );
    });

    if (foundMatch) {
      return foundMatch;
    }

    try {
      const createCategoryTemplate = {
        name: category.name,
        description: '',
        sorting: 1,
        icon_url: null,
        small_icon_url: null,
        password: false,
        isavailable: true,
        template: null
      };

      const { body } = await got.post(`${this.hostname}/api/VodCategories`, {
        ...this.gotDefaults,
        json: createCategoryTemplate
      });

      return body;
    } catch (error) {
      logger.error(`Couldn't import category`, {
        error: (error.response && error.response.body) || error,
        category: category.name
      });
    }
  }

  async uploadImage(url, type = 'icon_url') {
    let image = null;

    try {
      image = await got(url).buffer();
    } catch {
      image = null;
    }

    if (image) {
      const form = new FormData();
      const fileName = url
        .slice(0, url.lastIndexOf('/') + 1)
        .replace(/((\?|#).*)?$/, '');

      form.append('file', image, fileName);

      const request = got.post(
        `${this.hostname}/file-upload/single-file/vod/${type}`,
        {
          ...this.gotDefaults,
          body: form,
          headers: {
            Authorization: this.token,
            'content-type': `multipart/form-data; boundary=${form.getBoundary()}`
          }
        }
      );

      try {
        const response = await request;
        return response.body.result;
      } catch {
        // swallow error
      }
    }

    return url;
  }

  async doesVodExist(id, type = 'Vods') {
    try {
      const { body } = await got.get(`${this.hostname}/api/${type}/${id}`, {
        ...this.gotDefaults
      });

      if (body.id && body.id === id) {
        return true;
      }

      return false;
    } catch (error) {
      if (error.response.statusCode === 404) {
        return false;
      }
    }
  }

  async findSeason(name) {
    const { body } = await got.get(
      `${
        this.hostname
      }/api/Season?_end=60&_orderBy=createdAt&_orderDir=DESC&_start=0&q=${querystring.escape(
        name.replace(/ /g, '+')
      )}`,
      {
        ...this.gotDefaults
      }
    );

    if (Array.isArray(body) && body.length > 0 && body[0].title === name) {
      return body[0];
    }

    return null;
  }

  async findEpisode(name, show) {
    try {
      const { body } = await got.get(
        `${
          this.hostname
        }/api/VodEpisode?_end=60&_orderBy=createdAt&_orderDir=DESC&_start=0&q=${querystring.escape(
          name.replace(/ /g, '+')
        )}&tv_show_title=${querystring.escape(show.replace(/ /g, '+'))}`,
        {
          ...this.gotDefaults
        }
      );

      if (Array.isArray(body) && body.length > 0 && body[0].title === name) {
        return body[0];
      }

      return false;
    } catch (error) {
      if (error.response.statusCode === 404) {
        return false;
      }
    }
  }

  async importEpisode(episode, streamUrl, show) {
    const existingEpisode = await this.findEpisode(episode.title, show.name);
    if (existingEpisode) {
      return existingEpisode;
    }

    if (episode.icon_url.startsWith('http')) {
      const fileLocation = await this.uploadImage(episode.icon_url, 'icon_url');
      episode.icon_url = fileLocation;
    }

    if (episode.image_url.startsWith('http')) {
      const fileLocation = await this.uploadImage(
        episode.icon_url,
        'image_url'
      );
      episode.image_url = fileLocation;
    }

    try {
      const { body } = await got.post(`${this.hostname}/api/VodEpisode`, {
        ...this.gotDefaults,
        json: episode
      });

      const streamSource = {
        tv_episode_id: body.id,
        stream_source_id: 1,
        tv_episode_url: streamUrl,
        stream_resolution: [1, 2, 3, 4, 5, 6],
        stream_format: 3,
        token: false,
        token_url: 'Token Url',
        encryption: false,
        encryption_url: 'Encryption url',
        drm_platform: 'none',
        template: null
      };

      await got.post(`${this.hostname}/api/tv_episode_stream`, {
        ...this.gotDefaults,
        json: streamSource
      });

      return body;
    } catch (error) {
      const errorMessage = (error.response && error.response.body) || error;
      if (
        errorMessage.message &&
        errorMessage.message.includes('SequelizeUniqueConstraintError')
      ) {
        throw new AlreadyExistsError(episode.title);
      }

      throw error;
    }
  }

  async importShow(show) {
    const existingShow = await this.doesVodExist(show.id, 'Series');
    if (existingShow) {
      throw new AlreadyExistsError(show.title);
    }

    if (show.icon_url.startsWith('http')) {
      const fileLocation = await this.uploadImage(show.icon_url, 'icon_url');
      show.icon_url = fileLocation;
    }

    if (show.image_url.startsWith('http')) {
      const fileLocation = await this.uploadImage(show.icon_url, 'image_url');
      show.image_url = fileLocation;
    }

    try {
      const { body } = await got.put(
        `${this.hostname}/api/tmdbseries/${show.id}`,
        {
          ...this.gotDefaults,
          json: show
        }
      );
      return body;
    } catch (error) {
      const errorMessage = (error.response && error.response.body) || error;
      if (
        errorMessage.message &&
        errorMessage.message.includes('SequelizeUniqueConstraintError')
      ) {
        throw new AlreadyExistsError(show.title);
      }

      throw error;
    }
  }

  async importSeason(season) {
    const existingSeason = await this.findSeason(season.title);
    if (existingSeason) {
      return existingSeason;
    }

    if (season.icon_url.startsWith('http')) {
      const fileLocation = await this.uploadImage(season.icon_url, 'icon_url');
      season.icon_url = fileLocation;
    }

    if (season.image_url.startsWith('http')) {
      const fileLocation = await this.uploadImage(season.icon_url, 'image_url');
      season.image_url = fileLocation;
    }

    try {
      const { body } = await got.post(`${this.hostname}/api/Season`, {
        ...this.gotDefaults,
        json: season
      });
      return body;
    } catch (error) {
      const errorMessage = (error.response && error.response.body) || error;
      if (
        errorMessage.message &&
        errorMessage.message.includes('SequelizeUniqueConstraintError')
      ) {
        throw new AlreadyExistsError(season.title);
      }

      throw error;
    }
  }

  async importMovie(movie, streamUrl) {
    const existingMovie = await this.doesVodExist(movie.id);
    if (existingMovie) {
      throw new AlreadyExistsError(movie.title);
    }

    if (movie.icon_url.startsWith('http')) {
      const fileLocation = await this.uploadImage(movie.icon_url, 'icon_url');
      movie.icon_url = fileLocation;
    }

    if (movie.image_url.startsWith('http')) {
      const fileLocation = await this.uploadImage(movie.icon_url, 'image_url');
      movie.image_url = fileLocation;
    }

    let magowareMovieResponse = null;
    try {
      const response = await got.post(`${this.hostname}/api/Vods`, {
        ...this.gotDefaults,
        json: movie
      });
      magowareMovieResponse = response.body;
    } catch (error) {
      const errorMessage = (error.response && error.response.body) || error;
      if (
        errorMessage.message &&
        errorMessage.message.includes('SequelizeUniqueConstraintError')
      ) {
        throw new AlreadyExistsError(movie.title);
      } else {
        console.log('importing vod failed', movie);
      }

      throw error;
    }

    const sourceTemplate = {
      vod_id: movie.id,
      stream_source_id: this.streamSources[0].id,
      url: streamUrl,
      stream_resolution: [1, 2, 3, 4, 5, 6],
      stream_format: 3,
      stream_type: 'regular',
      token: false,
      token_url: '',
      encryption: false,
      encryption_url: '',
      drm_platform: 'none',
      template: null
    };

    try {
      await got.post(`${process.env.MAGOWARE_URL}/api/vodstreams`, {
        ...this.gotDefaults,
        json: sourceTemplate
      });
    } catch (error) {
      logger.error("couldn't add stream source", {
        error: (error.response && error.response.body) || error
      });
      console.log(
        error.response && error.response.body ? error.response.body : error
      );
      throw error;
    }

    return magowareMovieResponse;
  }
}
