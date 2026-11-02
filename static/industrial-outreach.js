/* Map is an optional enhancement. All records and forms work without CDN/tiles. */
(() => {
  const el = document.getElementById('outreach-map');
  if (!el) return;
  if (!window.L) {
    el.textContent = 'Картографическая библиотека недоступна. Пользуйтесь таблицей ниже и ссылками на Яндекс Карты в карточках.';
    return;
  }
  const map = L.map(el).setView([55.7558, 37.6173], 9);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map);
  L.circle([55.7558, 37.6173], {
    radius: 50000, weight: 2, fill: false, color: '#334d6b', dashArray: '7 6'
  }).addTo(map).bindPopup('Ориентировочный радиус 50 км по прямой от центра Москвы — не от МКАД.');
  const zones = {
    'СЕВЕР / ЗАПАД': '#2563eb',
    'ВОСТОК / СЕВЕРО-ВОСТОК': '#e38a22',
    'ЮГ / ЮГО-ЗАПАД': '#159b79'
  };
  const url = new URL(window.location.href);
  const rank = url.searchParams.get('rank') ?? 'A';
  const zone = url.searchParams.get('zone') || '';
  const query = (url.searchParams.get('q') || '').toLocaleLowerCase('ru-RU');
  fetch('/parks/map-data', {credentials: 'same-origin'})
    .then(response => {
      if (!response.ok) throw new Error('Список точек недоступен');
      return response.json();
    })
    .then(data => {
      const markers = [];
      let noGeo = 0;
      for (const park of data) {
        if (rank && !park.focus_rank.startsWith(rank)) continue;
        if (zone && park.zone !== zone) continue;
        if (query && !(park.name + park.address + park.id).toLocaleLowerCase('ru-RU').includes(query)) continue;
        if (park.lat == null || park.lon == null) {noGeo++; continue;}
        const top = park.focus_rank.startsWith('A');
        const marker = L.circleMarker([park.lat, park.lon], {
          radius: top ? 9 : 6, color: top ? '#102c52' : '#fff',
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
        note.style.cssText = 'position:absolute;z-index:400;left:12px;bottom:24px;background:#fff;padding:5px 9px;border-radius:6px;font-size:11px;max-width:230px';
        el.appendChild(note);
      }
    })
    .catch(() => {
      const note = document.createElement('div');
      note.className = 'outreach-geonote';
      note.textContent = 'Не удалось загрузить точки. Список объектов ниже доступен.';
      note.style.cssText = 'position:absolute;z-index:400;left:12px;bottom:24px;background:#fff;padding:7px;border-radius:6px;';
      el.appendChild(note);
    });
})();
