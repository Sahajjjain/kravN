function attachMovieAutocomplete({ inputId, dropdownId, onSelect }) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  if (!input || !dropdown) return;

  let debounceTimer;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();

    if (query.length < 2) {
      closeDropdown();
      return;
    }

    debounceTimer = setTimeout(() => fetchSuggestions(query), 350);
  });

  async function fetchSuggestions(query) {
    try {
      const response = await fetch(`/api/movie-search?q=${encodeURIComponent(query)}`);
      const movies = await response.json();
      renderSuggestions(movies);
    } catch (err) {
      console.error('Search failed:', err);
      closeDropdown();
    }
  }

  function renderSuggestions(movies) {
    if (movies.length === 0) {
      closeDropdown();
      return;
    }

    dropdown.innerHTML = movies.slice(0, 6).map(movie => `
      <div class="suggestion-item" data-title="${movie.title.replace(/"/g, '&quot;')}">
        ${movie.poster && movie.poster !== 'N/A'
          ? `<img src="${movie.poster}" alt="">`
          : `<div class="suggestion-poster-placeholder">🎬</div>`
        }
        <div>
          <div class="suggestion-title">${movie.title}</div>
          <div class="suggestion-year">${movie.year}</div>
        </div>
      </div>
    `).join('');

    dropdown.classList.add('visible');

    dropdown.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        input.value = item.dataset.title;
        closeDropdown();
        if (onSelect) onSelect(item.dataset.title);
      });
    });
  }

  function closeDropdown() {
    dropdown.innerHTML = '';
    dropdown.classList.remove('visible');
  }

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      closeDropdown();
    }
  });
}
