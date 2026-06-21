require('dotenv').config();

async function getMovieInfo(movieName) {
  const apiKey = process.env.OMDB_API_KEY;
  const url = `http://www.omdbapi.com/?apikey=${apiKey}&t=${encodeURIComponent(movieName)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Response === 'False') {
      return null; // movie not found
    }

    return {
      poster: data.Poster,
      year: data.Year,
      rating: data.imdbRating
    };
  } catch (err) {
    console.error('OMDb fetch failed:', err);
    return null;
  }
}

async function searchMovies(query) {
  const apiKey = process.env.OMDB_API_KEY;
  const url = `http://www.omdbapi.com/?apikey=${apiKey}&s=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.Response === 'False') {
      return [];
    }

    return data.Search.map(item => ({
      title: item.Title,
      year: item.Year,
      poster: item.Poster
    }));
  } catch (err) {
    console.error('OMDb search failed:', err);
    return [];
  }
}

module.exports = { getMovieInfo, searchMovies };