import Logger from '../lib/logging.js';

const logger = new Logger();

export default class Processor {
  constructor(redis, client) {
    this.redis = redis;
    this.client = client;
  }

  async process() {}

  async destroy() {
    logger.warn('Shutting down Processor');
  }
}
