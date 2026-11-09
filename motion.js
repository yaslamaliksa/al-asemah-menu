/* Progressive motion: content and controls work when animations are unavailable. */
(() => {
  'use strict';

  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => Boolean(preference?.matches);
  const watched = new Set();
  const closing = new WeakMap();
  const opening = new WeakMap();
  const activeAnimations = new Set();
  const grid = document.getElementById('products');
  let observer = null;

  function reveal(element) {
    element.dataset.motionState = 'visible';
    observer?.unobserve(element);
    watched.delete(element);
  }

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) reveal(entry.target);
      });
    }, {threshold: 0.05, rootMargin: '0px 0px 32px 0px'});
  }

  function prepare(element, delay = 0, animate = true) {
    element.classList.add('motion-reveal');
    element.style.setProperty('--motion-delay', `${Math.min(120, Math.max(0, delay))}ms`);
    if (!observer || reduced() || !animate) {
      reveal(element);
      element.classList.remove('motion-reveal');
      element.style.removeProperty('--motion-delay');
      for(const animation of element.getAnimations?.()||[]){try{animation.finish()}catch{}}
      return;
    }
    element.dataset.motionState = 'ready';
    watched.add(element);
    observer.observe(element);
  }

  function refreshProducts({animate = true} = {}) {
    // Filters replace the grid. Release old nodes before watching the new cards.
    for (const element of [...watched]) {
      if (!element.isConnected) {
        observer?.unobserve(element);
        watched.delete(element);
      }
    }
    grid?.querySelectorAll('.product-card').forEach((card, index) => {
      prepare(card, (index % 3) * 40, animate);
    });
  }

  function clearOpening(dialog) {
    const cleanup = opening.get(dialog);
    if (cleanup) cleanup();
  }

  function openAnimation(dialog) {
    clearOpening(dialog);
    if (reduced() || closing.has(dialog)) return;
    dialog.classList.add('is-opening');
    let timer;
    const finish = event => {
      if (event && (event.target !== dialog || event.pseudoElement)) return;
      clearTimeout(timer);
      dialog.classList.remove('is-opening');
      dialog.removeEventListener('animationend', finish);
      opening.delete(dialog);
    };
    opening.set(dialog, finish);
    dialog.addEventListener('animationend', finish);
    timer = setTimeout(finish, 320);
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return Promise.resolve();
    const pending = closing.get(dialog);
    if (pending) return pending.promise;

    clearOpening(dialog);
    // Microphone and speech stop immediately, before a visual exit completes.
    dialog.dispatchEvent(new Event('dialogclosing'));
    if (reduced()) {
      dialog.close();
      return Promise.resolve();
    }

    let resolve;
    let timer;
    const wasInert = dialog.inert;
    const promise = new Promise(done => { resolve = done; });
    const finish = event => {
      if (event && (event.target !== dialog || event.pseudoElement)) return;
      clearTimeout(timer);
      dialog.removeEventListener('animationend', finish);
      dialog.classList.remove('is-closing');
      dialog.inert = wasInert;
      closing.delete(dialog);
      if (dialog.open) dialog.close();
      resolve();
    };
    closing.set(dialog, {promise, finish});
    dialog.inert = true;
    dialog.classList.add('is-closing');
    dialog.addEventListener('animationend', finish);
    timer = setTimeout(finish, 260);
    return promise;
  }

  document.querySelectorAll('dialog').forEach(dialog => {
    const changes = new MutationObserver(() => {
      if (dialog.open) openAnimation(dialog);
      else {
        clearOpening(dialog);
        closing.get(dialog)?.finish();
      }
    });
    changes.observe(dialog, {attributes: true, attributeFilter: ['open']});
    dialog.addEventListener('cancel', event => {
      if (reduced()) return;
      event.preventDefault();
      void closeDialog(dialog);
    });
    // A native close from any other caller still clears transition state.
    dialog.addEventListener('close', () => {
      clearOpening(dialog);
      closing.get(dialog)?.finish();
    });
  });

  function pulse(element) {
    if (reduced() || typeof element.animate !== 'function' || element.closest('[hidden]')) return;
    const animation = element.animate([
      {transform: 'scale(1)'},
      {transform: 'scale(1.16)', offset: 0.45},
      {transform: 'scale(1)'}
    ], {duration: 260, easing: 'cubic-bezier(.2,.75,.25,1)'});
    activeAnimations.add(animation);
    animation.finished.then(() => activeAnimations.delete(animation), () => activeAnimations.delete(animation));
  }

  document.querySelectorAll('.cart-count').forEach(badge => {
    let previous = Number(badge.textContent) || 0;
    const changes = new MutationObserver(() => {
      const next = Number(badge.textContent) || 0;
      if (next > previous) pulse(badge);
      previous = next;
    });
    changes.observe(badge, {childList: true, characterData: true, subtree: true});
  });

  function preferenceChanged() {
    if (!reduced()) return;
    [...watched].forEach(reveal);
    document.querySelectorAll('dialog').forEach(dialog => {
      clearOpening(dialog);
      closing.get(dialog)?.finish();
    });
    activeAnimations.forEach(animation => animation.cancel());
    activeAnimations.clear();
  }
  preference?.addEventListener?.('change', preferenceChanged);

  document.querySelectorAll('[data-motion]').forEach(element => {
    prepare(element, Number(element.dataset.motionDelay) || 0);
  });
  refreshProducts();
  window.AlAsemaMotion = Object.freeze({refreshProducts, closeDialog});
})();
