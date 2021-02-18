/* eslint-disable camelcase */

function isImdb(source) {
  if (source.id && typeof source.id === 'string') {
    return source.id.startsWith('tt');
  }
}

function timeToSeconds(time) {
  if (time) {
    const reg = /(\d*)h (\d*)min/g;
    if (time.match(reg)) {
      const matches = reg.exec(time);
      const hours = Number(matches[1]);
      const minutes = Number(matches[2]);
      return hours * 60 * 60 + minutes * 60;
    }
  }
}

const defaultMovieTemplate = {
  company_id: 1,
  clicks: 0,
  spoken_languages: [{ iso_639_1: 'en', name: 'English' }],
  tagline: '',
  homepage: 'N/A',
  vote_count: 0,
  popularity: 0,
  trailer_url: '',
  budget: 0,
  original_language: 'en',
  status: 'Released',
  vod_preview_url: '',
  pin_protected: false,
  adult_content: false,
  isavailable: true,
  default_subtitle_id: 0,
  expiration_time: '3018-01-01T00:00:00.000Z',
  price: 0,
  mandatory_ads: false,
  revenue: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  package_vods: [3, 4],
  vod_subtitles: [{ value: 0, label: 'No default subtitles', selected: true }],
  vod_streams: []
};

function normalizeDirector(director) {
  let cleanString = 'N/A';

  if (typeof director === 'string') {
    cleanString = director
      .split(',')
      .slice(0, 2)
      .filter((name) => name !== '')
      .map((name) => name.trim())
      .join(', ');
  }

  if (Array.isArray(director) && director[0].length > 0) {
    cleanString = director
      .slice(0, 2)
      .map((name) => name.trim())
      .filter((name) => name !== '')
      .join(', ');
  }

  return cleanString.slice(0, 100);
}

function normalizeCast(cast) {
  let cleanString = 'N/A';

  if (typeof cast === 'string') {
    cleanString = cast
      .split(',')
      .slice(0, 10)
      .filter((name) => name !== '')
      .map((name) => name.trim())
      .join(', ');
  }

  if (Array.isArray(cast) && cast.length > 0) {
    cleanString = cast
      .slice(0, 10)
      .filter((name) => name !== '')
      .map((name) => name.trim())
      .join(', ');
  }

  return cleanString.slice(0, 999);
}

function normalizeImdb(source, categoryId = 1) {
  const vodId = Number(source.id.replace('tt', ''));
  return {
    ...defaultMovieTemplate,
    id: vodId,
    imdb_id: source.id || '',
    title: source.title || '',
    original_title: source.originalTitle || '',
    description: source.story ? source.story.slice(0, 990) : '',
    icon_url: source.poster || '',
    image_url: source.poster || '',
    rate: source.rating || 1,
    vote_average: source.rating || 5,
    duration: timeToSeconds(source.runtime) || 0,
    director: normalizeDirector(source.director),
    starring: normalizeCast(source.stars),
    release_date: new Date(source.year),
    vod_vod_categories: [categoryId]
  };
}

function normalizeTmdb(source, categoryId = 1) {
  return {
    ...defaultMovieTemplate,
    id: source.id,
    imdb_id: source.imdb_id || '',
    title: source.title || '',
    original_title: source.original_title || '',
    description: source.description ? source.description.slice(0, 990) : '',
    tagline: source.tagline || '',
    homepage: source.homepage || 'N/A',
    icon_url: source.icon_url
      ? 'https://image.tmdb.org/t/p/original' + source.icon_url
      : '',
    image_url: source.image_url
      ? 'https://image.tmdb.org/t/p/original' + source.image_url
      : '',
    rate: source.vote_average || 1,
    vote_average: source.vote_average || 5,
    vote_count: source.vote_count || 0,
    popularity: source.popularity || 0,
    duration: source.duration || 0,
    director: normalizeDirector(source.director),
    starring: normalizeCast(source.starring),
    trailer_url: source.trailer_url || '',
    budget: source.budget || 0,
    original_language: source.original_language || 'en',
    release_date: source.release_date || new Date(),
    vod_vod_categories: [categoryId]
  };
}

export function normalizeMovieInformation(source, categoryId) {
  return isImdb(source)
    ? normalizeImdb(source, categoryId)
    : normalizeTmdb(source, categoryId);
}

export function normalizeShowInformation(source, categoryId) {
  return {
    spoken_languages: [{ iso_639_1: 'en', name: 'English' }],
    original_title: '',
    production_company: '',
    price: 0,
    tagline: source.tagline || '',
    release_date: source.first_air_date || new Date(),
    homepage: source.homepage || 'N/A',
    id: source.id,
    origin_country: source.origin_country || '',
    original_language: source.original_language || '',
    popularity: source.popularity,
    status: source.status || 'Released',
    vote_average: source.vote_average || 0,
    vote_count: source.vote_count || 0,
    trailer_url: source.trailer_url || 'N/A',
    title: source.title,
    description: source.description.slice(0, 990) || 'N/A',
    icon_url: source.icon_url || '',
    image_url: source.image_url || '',
    cast:
      source.cast
        .split(',')
        .slice(0, 10)
        .filter((x) => x !== '')
        .join(', ') || 'N/A',
    director:
      source.director
        .split(',')
        .slice(0, 2)
        .filter((x) => x !== '')
        .join(', ') || 'N/A',
    rate: 0,
    clicks: 0,
    pin_protected: false,
    adult_content: false,
    is_available: true,
    languages: ['en'],
    expiration_time: '3020-09-29T23:00:00.000Z',
    mandatory_ads: false,
    revenue: 0,
    budget: 0,
    company_id: 1,
    tv_series_categories: [categoryId],
    tv_series_packages: [3, 4]
  };
}

export function normalizeSeasonInformation(source, show) {
  return {
    title: `${show.name} ${source.name}`,
    imdb_id: '',
    tv_show_id: show.magoware.id,
    season_number: source.seasonNumber || 0,
    director: 'N/A',
    rate: show.showInformation.rate || 1,
    description: '',
    cast: '',
    trailer_url: show.showInformation.trailer_url || '',
    icon_url: show.showInformation.icon_url || '',
    image_url: show.showInformation.image_url || '',
    is_available: true,
    expiration_time: '3018-01-01T00:00:00.000Z',
    mandatory_ads: false,
    revenue: 0,
    budget: 0,
    template: null
  };
}

export function normalizeEpisodeInformation(source, season, show) {
  const showId = show.magoware.id;
  const seasonNumber = season.magoware.season_number;
  const titleRegex = /(.*)? - ?(s\d{2}e\d{2})(?: ?- ?(.*))?/gi;
  const titleMatches = titleRegex.exec(source.title);
  let episodeTitle = source.title;
  if (titleMatches !== null) {
    episodeTitle =
      titleMatches[3] || titleMatches[2] || `Episode ${source.episodeNumber}`;
  }

  return {
    title: episodeTitle,
    imdb_id: '',
    tv_show_id: showId,
    season_number: seasonNumber,
    episode_number: source.episodeNum,
    director: 'N/A',
    rate: source.info.rating || 5,
    clicks: 0,
    duration: source.info.durationSecs / 60,
    description: source.info.plot ? source.info.plot.slice(0, 999) : '',
    cast: '',
    trailer_url: '',
    vod_preview_url: '',
    icon_url: source.info.movieImage || '',
    image_url: source.info.movieImage || '',
    adult_content: false,
    pin_protected: false,
    is_available: true,
    expiration_time: '3018-01-01T00:00:00.000Z',
    mandatory_ads: false,
    revenue: 0,
    budget: 0,
    template: null
  };
}
