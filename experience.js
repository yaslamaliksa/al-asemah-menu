/* Interactive showcases and catalog views, progressively enhanced. */
(() => {
  'use strict';

  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  const reduced = () => Boolean(motion?.matches);
  let currentTransition = null;

  function transitionCatalog(update) {
    if (typeof update !== 'function') throw new TypeError('A catalog update callback is required');
    if (reduced() || typeof document.startViewTransition !== 'function') return update({nativeTransition: false});

    try { currentTransition?.skipTransition?.(); } catch { /* A completed transition needs no interruption. */ }
    let called = false;
    let result;
    let updateError;
    const once = (nativeTransition = false) => {
      if (called) {
        if (updateError) throw updateError;
        return result;
      }
      called = true;
      try { result = update({nativeTransition}); return result; }
      catch (error) { updateError = error; throw error; }
    };

    let transition;
    try { transition = document.startViewTransition(() => once(true)); }
    catch (error) {
      // Some browsers expose the API but cannot start it in the current document.
      // The update is never repeated if the browser already invoked it.
      if (updateError) throw updateError;
      return called ? result : once();
    }
    if (!transition) return once();
    currentTransition = transition;
    transition.ready?.catch?.(() => {}); // A skipped visual transition is expected.
    Promise.resolve(transition.finished).catch(() => {}).then(() => {
      if (currentTransition === transition) currentTransition = null;
    });
    if (!transition.updateCallbackDone) return once();
    return Promise.resolve(transition.updateCallbackDone).catch(error => {
      if (!called) return once();
      if (updateError) throw updateError;
      return result; // The update committed; a visual API failure must not repeat it.
    });
  }

  window.AlAsemaExperience = Object.freeze({transitionCatalog});

  const grid = document.getElementById('products');
  const viewButtons = [...document.querySelectorAll('[data-menu-view]')];
  const validView = value => value === 'list' ? 'list' : 'grid';
  let viewRequest = 0;
  function applyView(value, persist = false) {
    const view = validView(value);
    if (grid) grid.dataset.view = view;
    viewButtons.forEach(button => {
      const selected = button.dataset.menuView === view;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (persist) {
      try { localStorage.setItem('asema-menu-view', view); } catch { /* Optional preference. */ }
    }
  }
  let savedView = 'grid';
  try { savedView = validView(localStorage.getItem('asema-menu-view')); } catch { /* Keep the default. */ }
  applyView(savedView);
  viewButtons.forEach(button => button.addEventListener('click', () => {
    const request = ++viewRequest;
    const view = validView(button.dataset.menuView);
    transitionCatalog(({nativeTransition = false} = {}) => {
      if (request === viewRequest) {
        applyView(view, true);
        if (nativeTransition) window.AlAsemaMotion?.refreshProducts({animate: false});
      }
    });
  }));

  const hero = document.querySelector('.hero-showcase');
  const heroButtons = [...document.querySelectorAll('[data-hero-product]')];
  const image = document.getElementById('hero-product-image');
  const title = document.getElementById('hero-product-title');
  const price = document.getElementById('hero-product-price');
  const category = document.getElementById('hero-category');
  const step = document.getElementById('hero-step');
  const announce = document.getElementById('hero-switch-status');
  const preview = document.querySelector('.hero-preview-button');
  const add = document.getElementById('hero-product-add');
  let selectedHero = heroButtons.find(button => button.getAttribute('aria-pressed') === 'true') || heroButtons[0];
  let requestedHero = selectedHero;
  let heroRequest = 0;
  let heroAnimation = null;

  function heroBusy(busy) {
    hero?.setAttribute('aria-busy', String(busy));
    hero?.classList.toggle('is-switching', busy);
  }

  function commitHero(button, notify) {
    if (!button || !image || !title || !price || !category || !preview || !add) return;
    const {heroProduct: id, name, image: source, price: amount, label} = button.dataset;
    image.src = source;
    image.alt = name;
    title.textContent = name;
    price.textContent = `${Number(amount).toLocaleString('en-US')} ر.س`;
    category.textContent = label;
    preview.dataset.product = add.dataset.product = id;
    preview.setAttribute('aria-label', `اختر ${name}`);
    add.setAttribute('aria-label', `أضف ${name} إلى السلة`);
    heroButtons.forEach(choice => {
      const active = choice === button;
      choice.classList.toggle('active', active);
      choice.setAttribute('aria-pressed', String(active));
    });
    if (step) step.textContent = `${String(heroButtons.indexOf(button) + 1).padStart(2, '0')} / ${String(heroButtons.length).padStart(2, '0')}`;
    if (announce && notify) announce.textContent = `${name}، من ${label}. اختره لتخصيص طلبك.`;
    selectedHero = button;
  }

  function loadImage(source) {
    if (typeof window.Image !== 'function') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const loader = new window.Image();
      let done = false;
      const timer = setTimeout(() => finish(false), 8000);
      function finish(success) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        loader.onload = loader.onerror = null;
        if (success) resolve();
        else reject(new Error('Image unavailable'));
      }
      loader.onload = () => finish(true);
      loader.onerror = () => finish(false);
      loader.src = source;
      if (loader.complete && loader.naturalWidth > 0) finish(true);
    });
  }

  function animateImage(frames, duration) {
    if (reduced() || typeof image?.animate !== 'function') return Promise.resolve();
    try {
      const animation = image.animate(frames, {duration, easing: 'cubic-bezier(.22,1,.36,1)'});
      heroAnimation = animation;
      return Promise.resolve(animation.finished).catch(() => {}).then(() => {
        if (heroAnimation === animation) heroAnimation = null;
      });
    } catch { return Promise.resolve(); }
  }

  async function switchHero(button, immediate = false) {
    if (!hero || !image || !button) return;
    const request = ++heroRequest;
    requestedHero = button;
    heroAnimation?.cancel?.();
    heroAnimation = null;
    if (button === selectedHero) { heroBusy(false); return; }
    if (reduced() || immediate) {
      commitHero(button, true);
      heroBusy(false);
      return;
    }
    heroBusy(true);
    try {
      await loadImage(button.dataset.image);
      if (request !== heroRequest) return;
      await animateImage([{opacity: 1, transform: 'scale(1)'}, {opacity: 0, transform: 'scale(.985)'}], 120);
      if (request !== heroRequest) return;
      commitHero(button, true);
      await animateImage([{opacity: 0, transform: 'translateY(10px) scale(1.02)'}, {opacity: 1, transform: 'translateY(0) scale(1)'}], 280);
    } catch {
      if (request === heroRequest) {
        requestedHero = selectedHero;
        if (announce) announce.textContent = 'تعذّر عرض صورة الصنف. جرّب الاختيار مرة أخرى.';
      }
    } finally {
      if (request === heroRequest) heroBusy(false);
    }
  }
  if (hero && image && heroButtons.length) {
    commitHero(selectedHero, false);
    heroButtons.forEach(button => button.addEventListener('click', () => { void switchHero(button); }));
  }

  // A restrained spotlight follows a mouse/trackpad. Touch and reduced-motion users
  // receive a fully static card instead, with no perpetual animation loop.
  let pointerFrame = null;
  let pointerTarget = null;
  let pointerPosition = null;
  function resetPointer() {
    if (pointerFrame !== null) window.cancelAnimationFrame?.(pointerFrame);
    pointerFrame = null;
    if (pointerTarget) {
      delete pointerTarget.dataset.pointerActive;
      pointerTarget.style.removeProperty('--pointer-x');
      pointerTarget.style.removeProperty('--pointer-y');
    }
    pointerTarget = pointerPosition = null;
  }
  if (typeof window.requestAnimationFrame === 'function') {
    document.addEventListener('pointermove', event => {
      if (reduced() || !finePointer?.matches || event.pointerType === 'touch') return;
      const target = event.target.closest?.('.product-visual');
      if (!target) { resetPointer(); return; }
      if (pointerTarget !== target) resetPointer();
      pointerTarget = target;
      pointerPosition = {x: event.clientX, y: event.clientY};
      if (pointerFrame !== null) return;
      pointerFrame = window.requestAnimationFrame(() => {
        pointerFrame = null;
        if (!pointerTarget || !pointerPosition || !pointerTarget.isConnected) return;
        const rect = pointerTarget.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = Math.max(0, Math.min(100, (pointerPosition.x - rect.left) / rect.width * 100));
        const y = Math.max(0, Math.min(100, (pointerPosition.y - rect.top) / rect.height * 100));
        pointerTarget.style.setProperty('--pointer-x', `${x}%`);
        pointerTarget.style.setProperty('--pointer-y', `${y}%`);
        pointerTarget.dataset.pointerActive = 'true';
      });
    }, {passive: true});
    document.addEventListener('pointerout', event => {
      if (!pointerTarget) return;
      if (event.relatedTarget?.closest?.('.product-visual') !== pointerTarget) resetPointer();
    }, {passive: true});
  }
  motion?.addEventListener?.('change', () => {
    if (!reduced()) return;
    resetPointer();
    if (hero) void switchHero(requestedHero, true);
    try { currentTransition?.skipTransition?.(); } catch { /* No visual transition remains. */ }
  });
})();
