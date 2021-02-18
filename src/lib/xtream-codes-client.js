import got from 'got';
import qs from 'querystring';
import camelcaseKeys from 'camelcase-keys';

export default class XtreamCodesClient {
  constructor(config = {}) {
    this.config = config;
    this.streams = [];
    this.debug = config.debug;
    this.userInfo = null;
    this.serverInfo = null;
  }

  log(...args) {
    return this.debug ? console.log(args) : false;
  }

  async authenticate() {
    const { userInfo, serverInfo } = await this.sendRequest();
    this.userInfo = userInfo;
    this.serverInfo = serverInfo;
  }

  async sendRequest(action = '', parameters = {}) {
    let file = 'player_api.php';

    if (action === 'xmltv.php') {
      file = action;
    }

    const query = { ...this.user, action, ...parameters };

    const xcUrl = `${this.baseUrl}/${file}?${qs.stringify(query)}`;
    this.log(xcUrl);
    const { body } = await got.get(xcUrl, {
      responseType: 'json'
    });

    return camelcaseKeys(body, { deep: true });
  }

  getStreamUrl(streamConfig, override = false) {
    streamConfig = {
      streamId: 0,
      wantedFormat: 'ts',
      timeshift: undefined,
      ...streamConfig
    };
    // For Live Streams the main format is
    // http(s)://domain:port/live/username/password/streamID.ext ( In allowed_output_formats element you have the available ext )
    // For Movie Streams the format is:
    // http(s)://domain:port/movie/username/password/streamID.ext ( In target_container element you have the available ext )
    // For Series Streams the format is
    // http(s)://domain:port/series/username/password/streamID.ext ( In target_container element you have the available ext )
    // For Timeshift streams the format is
    // http(s)://domain:port/timeshift/username/password/duration-mins/YYYY-MM-DD:HH-MM/streamId.ts

    let stream = this.streams.find((stream) => {
      return stream.streamId === streamConfig.streamId;
    });

    if (typeof stream !== 'undefined' || override) {
      if (override) {
        stream = streamConfig;
      }

      const type = stream.streamType;
      const id = stream.streamId;

      if (!override) {
        if (stream.containerExtension) {
          streamConfig.wantedFormat = stream.containerExtension;
        } else {
          throw new Error('Format unavailable');
        }
      }

      if (typeof streamConfig.timeshift !== 'undefined') {
        return `${this.baseUrl}/timeshift/${this.user.username}/${this.user.password}/${streamConfig.timeshift.duration}/${streamConfig.timeshift.startTime}/${id}.ts`;
      }

      return `${this.baseUrl}/${type}/${this.user.username}/${this.user.password}/${id}.${streamConfig.wantedFormat}`;
    }

    throw new Error('no stream by id');
  }

  async getStreams(categoryId, type = 'live') {
    let parameters = null;

    if (typeof categoryId !== 'undefined') {
      parameters = { category_id: categoryId }; // eslint-disable-line camelcase
    }

    const response = await this.sendRequest(`get_${type}_streams`, parameters);
    const data = camelcaseKeys(response);

    for (let i = 0; i < data.length; i++) {
      this.streams.push(data[i]);
    }
    this.log(`get_${type}`, data);
    return data;
  }

  async getLiveStreams(categoryId) {
    return this.getStreams(categoryId);
  }

  async getVodStreams(categoryId) {
    return this.getStreams(categoryId, 'vod');
  }

  async getCategories(type = 'live') {
    const parameters = null;

    const data = await this.sendRequest(`get_${type}_categories`, parameters);
    this.log(`get_${type}_categories`, data);
    return data;
  }

  async getLiveCategories() {
    return this.getCategories('live');
  }

  async getVodCategories() {
    return this.getCategories('vod');
  }

  async getSeriesCategories() {
    return this.getCategories('series');
  }

  async getSeries(categoryId) {
    let parameters = null;

    if (typeof categoryId !== 'undefined') {
      parameters = { category_id: categoryId }; // eslint-disable-line camelcase
    }

    const data = await this.sendRequest(`get_series`, parameters);
    this.log('get series', data);
    return data;
  }

  async getSeriesInfo(seriesId) {
    if (typeof seriesId === 'undefined') {
      throw new TypeError('seriesId is a required argument');
    }

    const data = await this.sendRequest(`get_series_info`, {
      series_id: seriesId // eslint-disable-line camelcase
    });
    this.log(`get_series_info`, data);
    return data;
  }

  async getVodInfo(vodId) {
    if (typeof vodId === 'undefined') {
      throw new TypeError('vodId is a required argument');
    }

    const data = await this.sendRequest(`get_vod_info`, { vod_id: vodId }); // eslint-disable-line camelcase
    this.log(`get_vod_info`, data);
    return data;
  }

  get baseUrl() {
    return this.config.baseUrl;
  }

  get user() {
    return {
      username: this.config.auth.username,
      password: this.config.auth.password
    };
  }
}
