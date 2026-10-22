/* WorldUnlocked – final release. No external API key or backend required. */
document.addEventListener('DOMContentLoaded', async () => {
  const STORAGE_KEY = 'worldUnlockedCountries'; // Compatible with the original version
  const PHOTO_LIMIT = 5;
  const PHOTO_SIZE_LIMIT = 4 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  const mapElement = $('world-map');
  const passportElement = $('passport-stamps');
  const countryModal = $('country-modal');
  const detailModal = $('detail-modal');
  const editor = $('travel-editor');
  let countries = {};
  let database = null;
  let map = null;
  let selectedCode = null;
  let draftCities = [];
  let previousFocus = null;
  let detailCode = null;
  let renderSequence = 0;
  const urls = { editor: [], passport: [], detail: [] };

  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) countries = value;
  } catch (error) { console.warn('Could not read previous travel data:', error); }

  function saveCountries() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(countries));
      return true;
    } catch (error) {
      alert('Could not save travel data. Your browser may be out of storage space.');
      console.error(error);
      return false;
    }
  }
  function countryName(code) {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; }
    catch { return countries[code]?.name || code; }
  }
  function yearOptions() {
    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= 1950; year--) {
      const opt = document.createElement('option');
      opt.value = String(year);
      opt.textContent = String(year);
      $('travel-year').appendChild(opt);
    }
  }
  yearOptions();

  // IndexedDB database name, version, store and schema deliberately unchanged.
  function openDatabase() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('WorldUnlockedPhotos', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
          store.createIndex('country', 'country', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Photo database is blocked'));
    });
  }
  try { database = await openDatabase(); }
  catch (error) { console.warn('Photo storage unavailable:', error); $('photo-message').textContent = 'Photo storage is unavailable in this browser.'; }

  function getPhotos(code) {
    if (!database) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const request = database.transaction('photos', 'readonly')
        .objectStore('photos').index('country').getAll(code);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }
  function putPhoto(code, file) {
    if (!database) return Promise.reject(new Error('Photo storage unavailable'));
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('photos', 'readwrite');
      transaction.objectStore('photos').add({ country: code, image: file, filename: file.name });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  function removePhoto(id) {
    if (!database) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('photos', 'readwrite');
      transaction.objectStore('photos').delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }
  async function clearCountryPhotos(code) {
    for (const photo of await getPhotos(code)) await removePhoto(photo.id);
  }
  function clearImageUrls(area) {
    urls[area].forEach(url => URL.revokeObjectURL(url));
    urls[area] = [];
  }
  function imageUrl(blob, area) {
    const url = URL.createObjectURL(blob);
    urls[area].push(url);
    return url;
  }

  // Use the existing jsVectorMap world map and color choices.
  if (typeof jsVectorMap !== 'undefined') {
    mapElement.textContent = '';
    try {
      map = new jsVectorMap({
        selector: '#world-map', map: 'world', backgroundColor: '#111e31',
        zoomButtons: true, zoomOnScroll: true, draggable: true,
        regionStyle: {
          initial: { fill: '#344760', stroke: '#172235', strokeWidth: .5 },
          hover: { fill: '#7fead4', cursor: 'pointer' }
        },
        series: { regions: [{
          attribute: 'fill',
          scale: { visited: '#40e0c0', wishlist: '#e4b95b' },
          values: {}
        }] },
        onRegionClick: (_event, code) => openCountry(code)
      });
    } catch (error) { mapElement.textContent = 'The map could not be loaded.'; console.error(error); }
  } else { mapElement.textContent = 'The map could not load. Check your internet connection.'; }

  function updateMapAndStats() {
    const colors = {};
    let visited = 0, wishlist = 0, cities = 0;
    for (const [code, data] of Object.entries(countries)) {
      if (!data || !['visited', 'wishlist'].includes(data.status)) continue;
      colors[code] = data.status;
      if (data.status === 'visited') {
        visited++;
        if (Array.isArray(data.cities)) cities += data.cities.length;
      } else wishlist++;
    }
    if (map?.series?.regions?.[0]) {
      map.series.regions[0].clear();
      map.series.regions[0].setValues(colors);
    }
    $('visited-count').textContent = visited;
    $('wishlist-count').textContent = wishlist;
    $('cities-count').textContent = cities;
    const percent = (visited / 195 * 100);
    $('world-progress').textContent = percent.toFixed(1) + '%';
    $('progress-fill').style.width = Math.min(100, percent) + '%';
    $('passport-count').textContent = visited + (visited === 1 ? ' destination' : ' destinations');
  }

  function showOverlay(node) {
    previousFocus = document.activeElement;
    node.hidden = false;
    document.body.classList.add('dialog-open');
    node.querySelector('.close-button')?.focus();
  }
  function closeOverlay(node) {
    node.hidden = true;
    if (countryModal.hidden && detailModal.hidden) document.body.classList.remove('dialog-open');
    if (node === countryModal) { selectedCode = null; $('modal-photo-gallery').replaceChildren(); clearImageUrls('editor'); }
    if (node === detailModal) { detailCode = null; $('detail-gallery').replaceChildren(); clearImageUrls('detail'); }
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
  }
  $('modal-close').addEventListener('click', () => closeOverlay(countryModal));
  $('detail-close').addEventListener('click', () => closeOverlay(detailModal));
  for (const layer of [countryModal, detailModal]) {
    layer.addEventListener('click', event => { if (event.target === layer) closeOverlay(layer); });
  }
  document.addEventListener('keydown', event => {
    const layer = !detailModal.hidden ? detailModal : !countryModal.hidden ? countryModal : null;
    if (!layer) return;
    if (event.key === 'Escape') { closeOverlay(layer); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(layer.querySelectorAll('button,input,select,textarea,a[href]'))
      .filter(node => !node.disabled && node.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  async function openCountry(code) {
    selectedCode = code;
    $('modal-country').textContent = countryName(code);
    $('photo-message').textContent = '';
    $('travel-photos').value = '';
    const country = countries[code];
    editor.hidden = !country || country.status !== 'visited';
    $('travel-year').value = country?.year || '';
    $('travel-notes').value = country?.notes || '';
    draftCities = Array.isArray(country?.cities) ? [...country.cities] : [];
    renderCityChips();
    showOverlay(countryModal);
    if (!editor.hidden) await renderEditorPhotos(code);
    else { $('modal-photo-gallery').replaceChildren(); clearImageUrls('editor'); }
  }

  function renderCityChips() {
    const box = $('city-chips');
    box.replaceChildren();
    draftCities.forEach((city, index) => {
      const chip = document.createElement('span'); chip.className = 'city-chip';
      const text = document.createElement('span'); text.textContent = city;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove ' + city);
      remove.addEventListener('click', () => { draftCities.splice(index, 1); renderCityChips(); });
      chip.append(text, remove); box.append(chip);
    });
  }
  function addCity() {
    const input = $('city-input');
    const city = input.value.replace(/\s+/g, ' ').trim();
    if (!city) return;
    if (draftCities.some(existing => existing.toLocaleLowerCase() === city.toLocaleLowerCase())) {
      input.value = ''; return;
    }
    draftCities.push(city);
    input.value = '';
    renderCityChips(); input.focus();
  }
  $('add-city').addEventListener('click', addCity);
  $('city-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addCity(); } });

  $('choose-visited').addEventListener('click', async () => {
    if (!selectedCode) return;
    const previous = countries[selectedCode] || {};
    countries[selectedCode] = {
      name: countryName(selectedCode), status: 'visited',
      year: previous.year || '', notes: previous.notes || '',
      cities: Array.isArray(previous.cities) ? previous.cities : []
    };
    saveCountries(); updateMapAndStats(); await renderPassport();
    draftCities = [...countries[selectedCode].cities];
    renderCityChips(); editor.hidden = false;
    $('travel-year').value = countries[selectedCode].year;
    $('travel-notes').value = countries[selectedCode].notes;
    await renderEditorPhotos(selectedCode);
    editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  async function changeCountryStatus(status) {
    if (!selectedCode) return;
    const code = selectedCode;
    const original = countries[code];
    const photos = await getPhotos(code);
    if ((original?.status === 'visited' || photos.length) &&
        !confirm('This will permanently delete this country’s saved memories and photos. Continue?')) return;
    // Clear photos before committing the status change, so storage failures cannot silently strand data.
    try { await clearCountryPhotos(code); }
    catch (error) { alert('Could not delete all photos. No changes were made to the country.'); console.error(error); return; }
    if (status === 'remove') delete countries[code];
    else countries[code] = { name: countryName(code), status: 'wishlist' };
    saveCountries(); updateMapAndStats(); await renderPassport(); closeOverlay(countryModal);
  }
  $('choose-wishlist').addEventListener('click', () => changeCountryStatus('wishlist'));
  $('choose-remove').addEventListener('click', () => changeCountryStatus('remove'));
  $('save-travel').addEventListener('click', async () => {
    if (!selectedCode || countries[selectedCode]?.status !== 'visited') return;
    if ($('city-input').value.trim()) addCity();
    const data = countries[selectedCode];
    data.year = $('travel-year').value;
    data.notes = $('travel-notes').value.trim();
    data.cities = [...draftCities];
    if (saveCountries()) { updateMapAndStats(); await renderPassport(); closeOverlay(countryModal); }
  });

  $('travel-photos').addEventListener('change', async event => {
    const code = selectedCode;
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!code || !database) { $('photo-message').textContent = 'Photo storage is not available.'; return; }
    try {
      const existing = await getPhotos(code);
      let available = PHOTO_LIMIT - existing.length;
      const skipped = [];
      for (const file of files) {
        if (available <= 0) { skipped.push('The 5-photo limit was reached.'); break; }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { skipped.push('Unsupported file format.'); continue; }
        if (file.size > PHOTO_SIZE_LIMIT) { skipped.push(file.name + ' is larger than 4 MB.'); continue; }
        await putPhoto(code, file); available--;
      }
      $('photo-message').textContent = skipped.length ? [...new Set(skipped)].join(' ') : 'Photos saved locally.';
      if (selectedCode === code) await renderEditorPhotos(code);
      await renderPassport();
    } catch (error) { console.error(error); $('photo-message').textContent = 'Could not save images. Check browser storage.'; }
  });
  async function renderEditorPhotos(code) {
    try {
      const photos = await getPhotos(code);
      if (selectedCode !== code || countryModal.hidden) return;
      const gallery = $('modal-photo-gallery'); gallery.replaceChildren(); clearImageUrls('editor');
      for (const photo of photos) {
        const item = document.createElement('div'); item.className = 'modal-photo-item';
        const img = document.createElement('img'); img.src = imageUrl(photo.image, 'editor'); img.alt = photo.filename || 'Travel photo';
        const remove = document.createElement('button'); remove.className = 'remove-photo-btn'; remove.type = 'button';
        remove.textContent = '×'; remove.setAttribute('aria-label', 'Delete photo');
        remove.addEventListener('click', async () => {
          if (!confirm('Delete this photo?')) return;
          try { await removePhoto(photo.id); await renderEditorPhotos(code); await renderPassport(); }
          catch (error) { console.error(error); $('photo-message').textContent = 'Could not delete photo.'; }
        });
        item.append(img, remove); gallery.appendChild(item);
      }
    } catch (error) { console.error(error); $('photo-message').textContent = 'Could not load photos.'; }
  }

  async function renderPassport() {
    const sequence = ++renderSequence;
    const visited = Object.entries(countries).filter(([, country]) => country?.status === 'visited')
      .sort((a, b) => countryName(a[0]).localeCompare(countryName(b[0])));
    const results = await Promise.all(visited.map(async ([code, country]) => {
      try { return { code, country, photos: await getPhotos(code) }; }
      catch (error) { console.error(error); return { code, country, photos: [] }; }
    }));
    if (sequence !== renderSequence) return;
    passportElement.replaceChildren(); clearImageUrls('passport');
    if (!results.length) {
      const empty = document.createElement('p'); empty.className = 'empty-passport';
      empty.textContent = 'Your travel collection is waiting. Select a country on the map and mark it Visited.';
      passportElement.appendChild(empty); return;
    }
    for (const { code, country, photos } of results) {
      const card = document.createElement('button'); card.type = 'button'; card.className = 'passport-card';
      card.setAttribute('aria-label', 'Open travel memories for ' + countryName(code));
      const cover = document.createElement('div'); cover.className = 'passport-cover';
      if (photos.length) {
        const img = document.createElement('img'); img.src = imageUrl(photos[0].image, 'passport');
        img.alt = 'Photo from ' + countryName(code); img.loading = 'lazy'; cover.appendChild(img);
      } else {
        const placeholder = document.createElement('span'); placeholder.className = 'passport-cover-placeholder';
        placeholder.textContent = '✧'; cover.appendChild(placeholder);
      }
      const label = document.createElement('span'); label.className = 'cover-label'; label.textContent = 'TRAVEL ARCHIVE'; cover.appendChild(label);
      const body = document.createElement('div'); body.className = 'passport-body';
      const titleRow = document.createElement('div'); titleRow.className = 'passport-title-row';
      const title = document.createElement('h3'); title.textContent = countryName(code);
      const stamp = document.createElement('span'); stamp.className = 'passport-seal'; stamp.textContent = '✈'; titleRow.append(title, stamp);
      const subtitle = document.createElement('p'); subtitle.className = 'passport-sub';
      const count = Array.isArray(country.cities) ? country.cities.length : 0;
      subtitle.textContent = (country.year ? 'VISITED ' + country.year : 'COUNTRY UNLOCKED') + ' · ' + count + (count === 1 ? ' CITY' : ' CITIES');
      const preview = document.createElement('p'); preview.className = 'passport-preview';
      preview.textContent = (Array.isArray(country.cities) && country.cities.length)
        ? country.cities.join(' · ') : (country.notes || 'Your story is waiting to be written.');
      const link = document.createElement('span'); link.className = 'passport-link'; link.textContent = 'OPEN TRAVEL JOURNAL  ↗';
      body.append(titleRow, subtitle, preview, link); card.append(cover, body);
      card.addEventListener('click', () => openDetail(code));
      passportElement.appendChild(card);
    }
  }

  async function openDetail(code) {
    detailCode = code;
    const data = countries[code];
    if (!data || data.status !== 'visited') return;
    $('detail-country').textContent = countryName(code);
    const meta = $('detail-meta'); meta.replaceChildren();
    const parts = [data.year ? 'Visited ' + data.year : 'Country unlocked', ...(Array.isArray(data.cities) ? data.cities : [])];
    for (const part of parts) { const pill = document.createElement('span'); pill.textContent = part; meta.appendChild(pill); }
    $('detail-notes').textContent = data.notes || 'No story added yet. Open Edit this journey to write your memories.';
    showOverlay(detailModal);
    try {
      const photos = await getPhotos(code);
      if (detailCode !== code || detailModal.hidden) return;
      const gallery = $('detail-gallery'); gallery.replaceChildren(); clearImageUrls('detail');
      if (!photos.length) {
        const noPhoto = document.createElement('div'); noPhoto.className = 'detail-no-photo';
        noPhoto.textContent = 'Add photos to bring this chapter to life.'; gallery.appendChild(noPhoto);
      }
      for (const photo of photos) {
        const img = document.createElement('img'); img.src = imageUrl(photo.image, 'detail'); img.alt = photo.filename || 'Travel memory';
        gallery.appendChild(img);
      }
    } catch (error) { console.error(error); }
  }
  $('detail-edit').addEventListener('click', () => {
    const code = detailCode;
    closeOverlay(detailModal);
    if (code) openCountry(code);
  });

  updateMapAndStats();
  await renderPassport();
});
