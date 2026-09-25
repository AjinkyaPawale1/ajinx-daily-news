const CAT_META = {
  us:       { icon: '🇺🇸', theme: 'theme-us' },
  global:   { icon: '🌍', theme: 'theme-global' },
  india:    { icon: '🇮🇳', theme: 'theme-india' },
  stocks:   { icon: '📈', theme: 'theme-stocks' },
  business: { icon: '💼', theme: 'theme-business' },
  tech:     { icon: '💡', theme: 'theme-tech' },
};
const CAT_ORDER = ['us', 'global', 'india', 'stocks', 'business', 'tech'];
const CAT_LABELS = {
  us: '🇺🇸 US News', global: '🌍 Global', india: '🇮🇳 India',
  stocks: '📈 Stocks', business: '💼 Business', tech: '💡 Tech',
};
const MAX_HISTORY_ITEMS = 5;

const THEME_COLORS = {
  'theme-us':       {c:'#3182ce', l:'#ebf8ff'},
  'theme-global':   {c:'#805ad5', l:'#faf5ff'},
  'theme-india':    {c:'#dd6b20', l:'#fffaf0'},
  'theme-stocks':   {c:'#38a169', l:'#f0fff4'},
  'theme-business': {c:'#2b6cb0', l:'#dbeafe'},
  'theme-tech':     {c:'#e53e3e', l:'#fff5f5'},
};

let currentCat = 'all';

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cardSvg(emoji, theme) {
  const t = THEME_COLORS[theme] || {c:'#666', l:'#f0f0f0'};
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160">
    <rect width="400" height="160" fill="${t.l}"/>
    <circle cx="370" cy="-20" r="120" fill="${t.c}" fill-opacity="0.13"/>
    <circle cx="30" cy="180" r="90" fill="${t.c}" fill-opacity="0.09"/>
    <circle cx="200" cy="80" r="50" fill="${t.c}" fill-opacity="0.06"/>
    <rect x="0" y="130" width="400" height="30" fill="${t.c}" fill-opacity="0.08"/>
    <text x="200" y="88" font-size="62" text-anchor="middle" dominant-baseline="middle">${emoji || '📰'}</text>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function showCat(cat) {
  currentCat = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  document.querySelectorAll('.category-section').forEach(s => {
    s.classList.toggle('visible', cat === 'all' || s.dataset.cat === cat);
  });
}

function buildNav(categories) {
  const nav = document.getElementById('category-nav');
  const keys = CAT_ORDER.filter(k => categories[k]);
  nav.innerHTML = '<button class="cat-btn active" data-cat="all">🌐 All</button>' +
    keys.map(k => `<button class="cat-btn" data-cat="${k}">${esc(CAT_LABELS[k] || k)}</button>`).join('');
  nav.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => showCat(btn.dataset.cat));
  });
}

function renderNews(data) {
  const categories = data.categories || {};
  buildNav(categories);
  currentCat = 'all';

  const main = document.getElementById('main');
  const keys = CAT_ORDER.filter(k => categories[k]);

  if (keys.length === 0) {
    main.innerHTML = '<div class="empty-state">No news data available for this date.</div>';
  } else {
    main.innerHTML = keys.map(id => {
      const cat = categories[id];
      const theme = CAT_META[id]?.theme || 'theme-tech';
      const icon = cat.icon || CAT_META[id]?.icon || '📰';
      const cards = (cat.articles || []).map(a => `
        <div class="news-card ${theme}">
          <div class="card-image ${theme}">
            <img src="${cardSvg(a.emoji, theme)}" alt="${esc(a.title)}">
          </div>
          <div class="card-body">
            <span class="card-category-tag">${esc(cat.label || id)}</span>
            <h3 class="card-title">${esc(a.title)}</h3>
            <ul class="card-bullets">
              ${(a.bullets || []).map(b => `<li>${esc(b)}</li>`).join('')}
            </ul>
            <div class="card-footer">
              <span class="card-source">${esc(a.source)}</span>
              ${a.url ? `<a class="card-link" href="${esc(a.url)}" target="_blank" rel="noopener">Read more →</a>` : ''}
            </div>
          </div>
        </div>`).join('');
      return `
        <section class="category-section visible" data-cat="${id}">
          <div class="section-header">
            <div class="section-icon ${theme}">${icon}</div>
            <div>
              <div class="section-title">${esc(cat.label || id)}</div>
              <div class="section-subtitle">${esc(cat.subtitle || '')}</div>
            </div>
          </div>
          <div class="cards-grid">${cards}</div>
        </section>`;
    }).join('');
  }

  document.getElementById('last-updated').textContent = `📅 ${data.displayDate || data.date || ''}`;

  const staleBanner = document.getElementById('stale-banner');
  const isLatestSelected = document.getElementById('history-select').value === (window.__latestDate || '');
  if (isLatestSelected && data.date) {
    const feedDay = new Date(`${data.date}T00:00:00`).toDateString();
    const today = new Date().toDateString();
    staleBanner.style.display = (feedDay !== today) ? 'block' : 'none';
  } else {
    staleBanner.style.display = 'none';
  }
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = `⚠️ ${message}`;
  banner.style.display = 'block';
  document.getElementById('main').innerHTML = '<div class="empty-state">Unable to load news right now. Please try again later.</div>';
}

function formatDateLabel(isoDate, isLatest) {
  const d = new Date(`${isoDate}T00:00:00`);
  const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return isLatest ? `Today · ${label}` : label;
}

async function loadDate(isoDate) {
  try {
    const res = await fetch(`data/history/${isoDate}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    document.getElementById('error-banner').style.display = 'none';
    renderNews(data);
  } catch (err) {
    showError(`Couldn't load news for ${isoDate}. ${err.message || ''}`);
  }
}

async function init() {
  try {
    const res = await fetch('data/index.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    const dates = (manifest.dates || []).slice(0, MAX_HISTORY_ITEMS);

    if (dates.length === 0) throw new Error('No history entries found.');

    window.__latestDate = dates[0];

    const select = document.getElementById('history-select');
    select.innerHTML = dates.map((d, i) =>
      `<option value="${d}">${esc(formatDateLabel(d, i === 0))}</option>`
    ).join('');
    select.addEventListener('change', () => loadDate(select.value));

    await loadDate(dates[0]);
  } catch (err) {
    showError(`Couldn't load the news archive. ${err.message || ''}`);
  }
}

export {
  CAT_ORDER,
  CAT_META,
  CAT_LABELS,
  esc,
  cardSvg,
  showCat,
  buildNav,
  renderNews,
  showError,
  formatDateLabel,
  loadDate,
  init,
};
