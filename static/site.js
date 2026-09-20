(() => {
  'use strict';
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  toggle?.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    nav.classList.toggle('is-open', open);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && nav?.classList.contains('is-open')) { toggle.click(); toggle.focus(); }
  });
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-filter]').forEach(b => {
        b.classList.toggle('active', b === button);
        b.setAttribute('aria-pressed', String(b === button));
      });
      let visible = 0;
      document.querySelectorAll('[data-category]').forEach(card => {
        card.hidden = button.dataset.filter !== 'all' && card.dataset.category !== button.dataset.filter;
        if (!card.hidden) visible++;
      });
      const empty = document.querySelector('.filter-empty');
      if (empty) {
        empty.hidden = visible !== 0;
        const link = empty.querySelector('a');
        if (link) link.href = button.dataset.requestUrl || '/request';
        const heading = empty.querySelector('h2');
        if (heading) heading.textContent = button.dataset.filter === 'all' ? 'Фотографии работ' : button.textContent;
      }
    });
  });
  const dialog = document.querySelector('.lightbox');
  document.querySelectorAll('.image-open').forEach(button => {
    button.addEventListener('click', () => {
      dialog.querySelector('img').src = button.dataset.image;
      dialog.querySelector('img').alt = button.dataset.caption;
      dialog.querySelector('p').textContent = button.dataset.caption;
      dialog.showModal();
    });
  });
  dialog?.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  document.querySelector('#start-model')?.addEventListener('click', () => {
    const viewer = document.querySelector('.model-viewer');
    if (!/^[a-f0-9]{32}$/.test(viewer.dataset.model)) return;
    const frame = document.createElement('iframe');
    frame.src = `https://sketchfab.com/models/${viewer.dataset.model}/embed?autostart=1&ui_theme=dark`;
    frame.title = 'Интерактивная 3D-модель здания';
    frame.allow = 'autoplay; fullscreen';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    viewer.querySelector('.model-poster').hidden = true;
    const loading = viewer.querySelector('.viewer-loading');
    loading.hidden = false;
    frame.addEventListener('load', () => { loading.hidden = true; });
    viewer.append(frame);
  });
  document.querySelectorAll('input[type="file"]').forEach(input => {
    input.addEventListener('change', () => {
      const files = Array.from(input.files);
      const error = files.length > 3 ? 'Выберите не более трёх файлов.' : files.some(f => f.size > 10 * 1024 * 1024) ? 'Каждый файл должен быть не больше 10 МБ.' : '';
      input.setCustomValidity(error);
      const feedback = input.parentElement.querySelector('.file-feedback');
      if (feedback) feedback.textContent = error || files.map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} МБ)`).join(', ');
      if (error) input.reportValidity();
    });
  });
  document.querySelector('.form-errors[tabindex]')?.focus();
  const openFileSection = () => {
    if (window.location.hash === '#files') document.querySelector('details#files')?.setAttribute('open', '');
  };
  openFileSection();
  window.addEventListener('hashchange', openFileSection);
  const serviceInputs = Array.from(document.querySelectorAll('.enquiry-form input[name="services"]'));
  const parameterGroups = Array.from(document.querySelectorAll('[data-param-services]'));
  const updateParameters = () => {
    const selected = serviceInputs.filter(input => input.checked).map(input => input.value);
    let visible = 0;
    parameterGroups.forEach(group => {
      const show = group.dataset.paramServices.split(' ').some(service => selected.includes(service));
      group.hidden = !show;
      group.disabled = !show;
      if (show) visible++;
    });
    const hint = document.querySelector('[data-parameters-empty]');
    if (hint) hint.hidden = visible > 0;
  };
  if (parameterGroups.length) {
    serviceInputs.forEach(input => input.addEventListener('change', updateParameters));
    updateParameters();
  }
  document.querySelectorAll('form').forEach(form => {
    form.addEventListener('submit', event => {
      const button = event.submitter;
      if (button && !button.name && !event.defaultPrevented && form.checkValidity()) { button.disabled = true; button.textContent = 'Отправляем…'; }
    });
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) document.querySelectorAll('button[disabled]').forEach(b => { b.disabled = false; b.textContent = 'Отправить'; });
  });
})();

// Approximate snippet preview; plain text only, never HTML from form values.
for (const [inputKey, previewKey] of [['title','title'], ['description','description']]) {
  const input = document.querySelector(`[data-seo-${inputKey}]`);
  const preview = document.querySelector(`[data-seo-preview-${previewKey}]`);
  if (input && preview) input.addEventListener('input', () => {
    preview.textContent = input.value.trim() || preview.dataset.default;
  });
}

// Service text blocks remain ordinary form fields; no HTML from user input is inserted.
document.querySelectorAll('[data-add-block]').forEach(button => {
  button.addEventListener('click', () => {
    const key = button.dataset.addBlock;
    const list = document.querySelector(`[data-block-list="${key}"]`);
    const template = document.getElementById(`service-block-${key}`);
    if (!list || !template) return;
    if (list.children.length >= Number(list.dataset.maxBlocks)) {
      button.textContent = `Добавлено максимум блоков: ${list.dataset.maxBlocks}`;
      return;
    }
    list.append(template.content.cloneNode(true));
    list.lastElementChild.querySelector('input')?.focus();
  });
});
document.querySelectorAll('[data-block-list]').forEach(list => {
  list.addEventListener('click', event => {
    if (event.target.closest('[data-remove-block]')) {
      event.target.closest('.service-text-pair')?.remove();
      document.querySelector('[data-service-main]')?.dispatchEvent(new Event('input', {bubbles: true}));
    }
  });
});

const serviceMainForm = document.querySelector('[data-service-main]');
if (serviceMainForm) {
  let unsavedService = false;
  serviceMainForm.addEventListener('input', () => { unsavedService = true; });
  serviceMainForm.addEventListener('change', () => { unsavedService = true; });
  document.addEventListener('submit', event => {
    if (event.target === serviceMainForm) {
      unsavedService = false;
    } else if (unsavedService) {
      event.preventDefault();
      const note = document.getElementById('service-save-note');
      note.hidden = false;
      serviceMainForm.querySelector('button[value="save"]').focus();
    }
  }, true);
  window.addEventListener('beforeunload', event => {
    if (unsavedService) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
}
