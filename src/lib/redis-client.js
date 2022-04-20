import Redis from 'ioredis';
import Logger from './logging.js';
import chalk from 'chalk';

const logger = new Logger();

function connectToRedis() {
  let client = null;
  try {
    client = new Redis({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASS,
      db: process.env.REDIS_DATABASE
    });

    client.on('connect', () => {
      logger.success('Connected to redis instance');
    });

    client.on('ready', () => {
      logger.success('Redis instance is ready (data loaded from disk)');
    });

    // Handles redis connection temporarily going down without app crashing
    // If an error is handled here, then redis will attempt to retry the request based on maxRetriesPerRequest
    client.on('error', (error) => {
      logger.error(`Error connecting to redis: "${error}"`);

      if (error.message === 'WRONGPASS invalid username-password pair') {
        logger.error(
          `Fatal error occurred "${error.message}". Stopping server.`
        );
        throw error;
      }

      if (error.message.includes('ECONNREFUSED')) {
        logger.error(
          `Fatal error occurred "${error.message}". Stopping server.`
        );
        throw error;
      }
    });
  } catch (error) {
    logger.error('Could not connect to redis');
    logger.error(chalk.bold('Redis server returned:'));
    throw error;
  }

  client.getKeysMatching = (pattern = '*') => {
    return new Promise((resolve, reject) => {
      const keysArray = [];
      const stream = client.scanStream({
        match: pattern,
        count: 100
      });
      stream.on('data', (keys = []) => {
        for (const key of keys) {
          if (!keysArray.includes(key)) {
            keysArray.push(key);
          }
        }
      });
      stream.on('error', (error) => {
        reject(error);
      });
      stream.on('end', () => {
        resolve(keysArray);
      });
    });
  };

  return client;
}

export default connectToRedis();
