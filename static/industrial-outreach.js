/* Map is an optional enhancement. All records and forms work without tiles. */
(() => {
  const el = document.getElementById('outreach-map');
  if (!el) return;
  if (!window.L) {
    el.textContent = 'Картографическая библиотека недоступна. Пользуйтесь таблицей ниже и ссылками на Яндекс Карты в карточках.';
    return;
  }
  el.replaceChildren();
  const touchScreen = window.matchMedia('(pointer: coarse)').matches;
  const map = L.map(el, {dragging: !touchScreen, scrollWheelZoom: false}).setView([55.7558, 37.6173], 9);
  const controls = document.querySelector('.outreach-map-tools');
  const interaction = document.getElementById('map-interaction');
  if (touchScreen && controls && interaction) {
    controls.hidden = false;
    interaction.addEventListener('click', () => {
      const active = interaction.getAttribute('aria-pressed') !== 'true';
      interaction.setAttribute('aria-pressed', String(active));
      interaction.textContent = active ? 'Завершить' : 'Двигать карту';
      document.getElementById('map-help').textContent = active
        ? 'Карту можно двигать одним пальцем. Нажмите «Завершить», чтобы прокручивать страницу.'
        : 'Двумя пальцами — масштаб. Одним — прокрутка страницы.';
      if (active) map.dragging.enable(); else map.dragging.disable();
    });
  }
  const tileNote = document.createElement('p');
  tileNote.className = 'field-note';
  tileNote.hidden = true;
  tileNote.setAttribute('role', 'status');
  tileNote.textContent = 'Подложка карты загрузилась не полностью. Точки и список доступны; для поездки используйте ссылки на Яндекс Карты.';
  el.insertAdjacentElement('afterend', tileNote);
  const yandexKey = el.dataset.yandexKey;
  const tiles = yandexKey
    ? 'https://tiles.api-maps.yandex.ru/v1/tiles/?x={x}&y={y}&z={z}&lang=ru_RU&l=map&projection=web_mercator&scale=' + (window.devicePixelRatio > 1 ? 2 : 1) + '&apikey=' + encodeURIComponent(yandexKey)
    : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileLayer = L.tileLayer(tiles, {
    attribution: yandexKey
      ? '© <a href="https://yandex.ru/maps/" target="_blank" rel="noopener noreferrer">Яндекс Карты</a>'
      : '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    maxZoom: yandexKey ? 20 : 18,
    updateWhenIdle: true, updateInterval: 350, keepBuffer: 1
  }).on('tileerror', () => { tileNote.hidden = false; });
  if (yandexKey) {
    const logo = L.control({position: 'bottomleft'});
    logo.onAdd = () => {
      const link = document.createElement('a');
      link.href = 'https://yandex.ru/maps/';
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.className = 'outreach-yandex-logo';
      const img = document.createElement('img');
      img.src = '/static/vendor/yandex-tiles/yandex-logo-ru.svg';
      img.alt = 'Яндекс Карты'; img.width = 88; img.height = 48;
      link.appendChild(img);
      L.DomEvent.disableClickPropagation(link);
      return link;
    };
    logo.addTo(map);
  }
  L.circle([55.7558, 37.6173], {
    radius: 50000, weight: 2, fill: false, color: '#334d6b', dashArray: '7 6'
  }).addTo(map).bindPopup('Ориентировочный радиус 50 км по прямой от центра Москвы — не от МКАД.');
  const zones = {
    'СЕВЕР / ЗАПАД': '#2563eb',
    'ВОСТОК / СЕВЕРО-ВОСТОК': '#e38a22',
    'ЮГ / ЮГО-ЗАПАД': '#159b79'
  };
  fetch(el.dataset.url, {credentials: 'same-origin'})
    .then(response => {
      if (!response.ok) throw new Error('Список точек недоступен');
      return response.json();
    })
    .then(data => {
      const markers = [];
      let noGeo = 0;
      for (const park of data) {
        if (park.lat == null || park.lon == null) {noGeo++; continue;}
        const top = park.focus_rank.startsWith('A');
        const marker = L.circleMarker([park.lat, park.lon], {
          radius: top ? 10 : 8, color: top ? '#102c52' : '#fff',
          weight: top ? 3 : 1, fillColor: zones[park.zone] || '#7c8da2',
          fillOpacity: park.accuracy.toLowerCase().includes('ориентир') ? 0.6 : 0.94
        }).addTo(map);
        const popup = document.createElement('div');
        const heading = document.createElement('strong');
        heading.textContent = park.name;
        popup.appendChild(heading);
        popup.appendChild(document.createElement('br'));
        const addr = document.createElement('span');
        addr.textContent = park.address;
        popup.appendChild(addr);
        popup.appendChild(document.createElement('br'));
        const status = document.createElement('span');
        status.textContent = 'Выезд: ' + park.visit_status;
        popup.appendChild(status);
        popup.appendChild(document.createElement('br'));
        const link = document.createElement('a');
        link.href = '/parks/' + encodeURIComponent(park.id);
        link.textContent = 'Открыть карточку и заполнить отчёт';
        popup.appendChild(link);
        popup.appendChild(document.createElement('br'));
        if (park.route_url) {
          const route = document.createElement('a');
          route.href = park.route_url;
          route.target = '_blank';
          route.rel = 'noopener noreferrer';
          route.textContent = park.entrance_confirmed
            ? 'Маршрут в Яндекс Картах'
            : 'Маршрут к ориентиру в Яндекс Картах';
          popup.appendChild(route);
          popup.appendChild(document.createElement('br'));
        }
        const search = document.createElement('a');
        search.href = park.search_url;
        search.target = '_blank';
        search.rel = 'noopener noreferrer';
        search.textContent = 'Найти парк по адресу';
        popup.appendChild(search);
        if (!park.entrance_confirmed) {
          popup.appendChild(document.createElement('br'));
          const warning = document.createElement('small');
          warning.textContent = 'Координаты ориентировочные — уточните въезд перед поездкой';
          popup.appendChild(warning);
        }
        marker.bindPopup(popup);
        markers.push(marker);
      }
      if (markers.length) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.13), {maxZoom: 11});
      }
      if (noGeo) {
        const note = document.createElement('div');
        note.className = 'outreach-geonote';
        note.textContent = 'Без подтверждённых координат: ' + noGeo + '. Смотрите список.';
        el.appendChild(note);
      }
    })
    .catch(() => {
      const note = document.createElement('div');
      note.className = 'outreach-geonote';
      note.textContent = 'Не удалось загрузить точки. Список объектов ниже доступен.';
      el.appendChild(note);
    })
    // Load the basemap only after fitting the actual selection, avoiding two
    // initial tile batches (important for bandwidth and the provider's limits).
    .finally(() => tileLayer.addTo(map));
})();
