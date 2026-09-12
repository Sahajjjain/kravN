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
    rating: data.imdbRating,
    genre: data.Genre || null, // e.g. "Action, Crime, Drama"
    releaseDate: (data.Released && data.Released !== 'N/A') ? data.Released : (data.Year || null),
    director: (data.Director && data.Director !== 'N/A') ? data.Director : null,
    actors: (data.Actors && data.Actors !== 'N/A') ? data.Actors : null,
    runtime: (data.Runtime && data.Runtime !== 'N/A') ? data.Runtime : null,
    plot: (data.Plot && data.Plot !== 'N/A') ? data.Plot : null
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