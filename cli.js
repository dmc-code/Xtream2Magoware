#!/usr/bin/env node
/* eslint import/no-unassigned-import: 0 */

import 'dotenv/config';
import meow from 'meow';
import App from './src/index.js';
import redisClient from './src/lib/redis-client.js';
import Logger from './src/lib/logging.js';
import gradient from 'gradient-string';

const logger = new Logger();

const cli = meow(
  `
  This module will connect to an xtream codes instance and create a local copy of it's content.
  This local copy will be processed to import each Movie and TV Episode into magoware, setting up categories as needed.

  This only uses public api's for Xtream and Magoware.

  Usage
    $ xtream-to-magoware
    $ node cli.js

  Options
    --cachebust    Empty redis cache
    --unattended   Assume yes for all questions
    --sync-only    Skip import step
    --import-only  Skip sync step

  Examples
    $ xtream-to-magoware --cachebust
    This will clear the redis cache of all local data

    $ xtream-to-magoware --unattended
    This is remove the user prompts, perform a full sync with Xtream Codes
    and import the VODs to Magoware

    $ xtream-to-magoware --unattended --sync-only
    This will only sync the redis cache with Xtream Codes

    $ xtream-to-magoware --unattended --import-only
    This will only sync the redis cache with Xtream Codes
`,
  {
    flags: {
      cachebust: {
        type: 'string',
        default: 'no'
      },
      unattended: {
        type: 'boolean',
        default: false
      },
      syncOnly: {
        type: 'boolean',
        default: false
      },
      importOnly: {
        type: 'boolean',
        default: false
      },
      tvOnly: {
        type: 'boolean',
        default: false
      }
    }
  }
);

if (!cli.flags.unattended) {
  const possibleGradients = [
    'atlas',
    'cristal',
    'teen',
    'mind',
    'morning',
    'vice',
    'passion',
    'fruit',
    'instagram',
    'retro',
    'summer',
    'rainbow',
    'pastel'
  ];

  const namedGradient =
    possibleGradients[Math.floor(Math.random() * possibleGradients.length)];

  const figlet = gradient[namedGradient].multiline(
    [
      '                      ███████████████                             ',
      '                     ██████████████████                           ',
      '                     ███████████████████                          ',
      '                     ███████     ███████                          ',
      '███████      ███████             ███████     ███████    ███████   ',
      ' ███████    ███████              ███████   ██████████  ██████████ ',
      '  █▓▓▓▓▓█  █▓▓▓▓▓█            ████▓▓▓▓█   █▓▓▓▓▓▓▓▓▓▓██▓▓▓▓▓▓▓▓▓▓█',
      '   █▓▓▓▓▓██▓▓▓▓▓█        █████▓▓▓▓▓▓██    █▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓█',
      '    █▓▓▓▓▓▓▓▓▓▓█       ██▓▓▓▓▓▓▓▓███      █▓▓▓▓▓███▓▓▓▓▓▓███▓▓▓▓▓█',
      '     █▒▒▒▒▒▒▒▒█       █▒▒▒▒▒█████         █▒▒▒▒█   █▒▒▒▒█   █▒▒▒▒█',
      '    █▒▒▒▒▒▒▒▒▒▒█     █▒▒▒▒▒█              █▒▒▒▒█   █▒▒▒▒█   █▒▒▒▒█',
      '   █░░░░░██░░░░░█    █░░░░░█       ██████ █░░░░█   █░░░░█   █░░░░█',
      '  █░░░░░█  █░░░░░█   █░░░░░░███████░░░░░█ █░░░░█   █░░░░█   █░░░░█',
      ' █░░░░░█    █░░░░░█  █░░░░░░░░░░░░░░░░░░█ █░░░░█   █░░░░█   █░░░░█',
      '███████      ███████ ████████████████████ ██████   ██████   ██████'
    ].join('\n')
  );

  process.stdout.write('\n\n\n' + figlet + '\n\n\n');
}

const app = new App(redisClient, {
  ...cli.flags,
  xtream: {
    url: process.env.XTREAM_URL,
    user: process.env.XTREAM_USER,
    password: process.env.XTREAM_PASS
  },
  magoware: {
    url: process.env.MAGOWARE_URL,
    user: process.env.MAGOWARE_USER,
    password: process.env.MAGOWARE_PASS
  }
});

//
const oldExit = process.exit;
process.exit = (code) => {
  app.endProcessGracefully(() => {
    oldExit(code);
  });
};

process.on('SIGINT', () => {
  process.stdout.write('\n\n');
  process.exit(0);
});

(async () => {
  if (['', 'all', 'movies', 'tv'].includes(cli.flags.cachebust)) {
    if (cli.flags.importOnly) {
      logger.error(
        'You asked for a cachebust whilst passing the --import-only flag. Cannot run an import without a primed cached, please edit your flags.'
      );
    } else {
      if (cli.flags.cachebust === 'movies') {
        logger.info('Removing Movies from cache');
        const keys = await redisClient.getKeysMatching('movies*');
        await redisClient.del(keys.join(' '));
      } else if (cli.flags.cachebust === 'tv') {
        logger.info('Gathering keys, this may take a moment');
        const [a, b, c] = await Promise.all([
          redisClient.getKeysMatching('episode*'),
          redisClient.getKeysMatching('season*'),
          redisClient.getKeysMatching('show*')
        ]);
        const keys = [...a, ...b, ...c];
        logger.info('Removing TV Shows, Seasons & Episodes from cache');
        await redisClient.del(keys);
      } else {
        await redisClient.flushall();
      }

      logger.success('Redis Cache Flushed');
    }

    await redisClient.disconnect();
    process.exit(0);
  } else {
    redisClient.on('ready', () => {
      app.begin();
    });
  }
})();
