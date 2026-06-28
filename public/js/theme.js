// Apply saved theme immediately on every page load (before render to avoid flash)
const savedTheme = localStorage.getItem('kravn-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('kravn-theme', next);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = next === 'dark' ? '☀' : '🌙';
}

// Set correct icon on load
document.addEventListener('DOMContentLoaded', () => {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = savedTheme === 'dark' ? '☀' : '🌙';
});