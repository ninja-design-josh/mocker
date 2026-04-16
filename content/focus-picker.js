/**
 * Focus Area Picker — injected on-demand into the active tab.
 * Lets the user hover and click DOM elements to mark them as remix focus areas.
 * Communicates selections back to the service worker via chrome.runtime.sendMessage.
 */
(() => {
  // Guard against double-injection
  if (document.querySelector('[data-mocker-picker]')) return;

  const MAX_SELECTIONS = 5;
  const MIN_DIMENSION = 20;
  const selections = []; // { element, overlayEl, badgeEl, data }

  // ── Scoped styles ──────────────────────────────────────────────────
  const style = document.createElement('style');
  style.setAttribute('data-mocker-picker', '');
  style.textContent = `
    [data-mocker-picker-root] {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
    }
    [data-mocker-picker-root] * {
      box-sizing: border-box !important;
    }
    .mocker-hover-overlay {
      position: fixed !important;
      border: 2px solid rgba(59, 130, 246, 0.8) !important;
      background: rgba(59, 130, 246, 0.12) !important;
      pointer-events: none !important;
      transition: top 0.05s, left 0.05s, width 0.05s, height 0.05s !important;
    }
    .mocker-selected-overlay {
      position: fixed !important;
      border: 2px solid rgba(139, 92, 246, 0.85) !important;
      background: rgba(139, 92, 246, 0.10) !important;
      pointer-events: none !important;
    }
    .mocker-badge {
      position: absolute !important;
      top: -10px !important;
      left: -10px !important;
      width: 22px !important;
      height: 22px !important;
      border-radius: 50% !important;
      background: rgba(139, 92, 246, 0.95) !important;
      color: #fff !important;
      font: bold 12px/22px -apple-system, system-ui, sans-serif !important;
      text-align: center !important;
      pointer-events: none !important;
    }
    .mocker-done-btn {
      position: fixed !important;
      top: 16px !important;
      right: 16px !important;
      padding: 8px 18px !important;
      border: none !important;
      border-radius: 8px !important;
      background: rgba(139, 92, 246, 0.95) !important;
      color: #fff !important;
      font: 600 14px/1 -apple-system, system-ui, sans-serif !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
      z-index: 1 !important;
    }
    .mocker-done-btn:hover {
      background: rgba(124, 58, 237, 0.95) !important;
    }
    .mocker-toast {
      position: fixed !important;
      top: 60px !important;
      right: 16px !important;
      padding: 8px 14px !important;
      border-radius: 6px !important;
      background: rgba(0,0,0,0.8) !important;
      color: #fff !important;
      font: 13px/1.3 -apple-system, system-ui, sans-serif !important;
      pointer-events: none !important;
      opacity: 0 !important;
      transition: opacity 0.2s !important;
      z-index: 1 !important;
    }
    .mocker-toast.visible {
      opacity: 1 !important;
    }
    .mocker-cancel-hint {
      position: fixed !important;
      bottom: 16px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      padding: 6px 14px !important;
      border-radius: 6px !important;
      background: rgba(0,0,0,0.7) !important;
      color: #fff !important;
      font: 13px/1.3 -apple-system, system-ui, sans-serif !important;
      pointer-events: none !important;
      z-index: 1 !important;
    }
  `;
  document.head.appendChild(style);

  // ── Overlay container ──────────────────────────────────────────────
  const root = document.createElement('div');
  root.setAttribute('data-mocker-picker-root', '');
  document.body.appendChild(root);

  const hoverOverlay = document.createElement('div');
  hoverOverlay.className = 'mocker-hover-overlay';
  hoverOverlay.style.display = 'none';
  root.appendChild(hoverOverlay);

  // Done button
  const doneBtn = document.createElement('button');
  doneBtn.className = 'mocker-done-btn';
  doneBtn.textContent = 'Done';
  root.appendChild(doneBtn);
  updateDoneBtn();

  // Toast for limit messages
  const toast = document.createElement('div');
  toast.className = 'mocker-toast';
  root.appendChild(toast);

  // Cancel hint
  const cancelHint = document.createElement('div');
  cancelHint.className = 'mocker-cancel-hint';
  cancelHint.textContent = 'Press Esc to cancel · Click elements to select';
  root.appendChild(cancelHint);

  // ── Helpers ────────────────────────────────────────────────────────

  function isPickerElement(el) {
    return el && (root.contains(el) || el === root || el === style);
  }

  function getElementAtPoint(x, y) {
    // Temporarily hide overlays to hit the real page element
    root.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    root.style.display = '';
    return el;
  }

  function positionOverlay(overlayEl, rect) {
    overlayEl.style.top = rect.top + 'px';
    overlayEl.style.left = rect.left + 'px';
    overlayEl.style.width = rect.width + 'px';
    overlayEl.style.height = rect.height + 'px';
  }

  function generateSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);

    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList)
      .filter(c => !c.startsWith('mocker-'))
      .map(c => '.' + CSS.escape(c))
      .join('');

    // Try tag+classes first
    const candidate = tag + classes;
    if (classes && document.querySelectorAll(candidate).length === 1) {
      return candidate;
    }

    // Fall back to nth-child path
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const parent = current.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      const idx = siblings.indexOf(current) + 1;
      const t = current.tagName.toLowerCase();
      parts.unshift(siblings.length > 1 ? `${t}:nth-of-type(${idx})` : t);
      current = parent;
    }
    return parts.join(' > ');
  }

  function buildAreaData(el, index) {
    const rect = el.getBoundingClientRect();
    const text = (el.textContent || '').trim();
    return {
      index,
      selector: generateSelector(el),
      tagName: el.tagName.toLowerCase(),
      id: el.id || '',
      classes: Array.from(el.classList).filter(c => !c.startsWith('mocker-')),
      textPreview: text.length > 80 ? text.slice(0, 80) + '...' : text,
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }

  function findSelectionByElement(el) {
    return selections.findIndex(s => s.element === el);
  }

  function updateDoneBtn() {
    const n = selections.length;
    doneBtn.textContent = n > 0 ? `Done (${n} selected)` : 'Done';
  }

  function renumberBadges() {
    selections.forEach((s, i) => {
      const num = i + 1;
      s.badgeEl.textContent = num;
      s.data.index = num;
    });
    updateDoneBtn();
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('visible'), 2000);
  }

  function refreshOverlayPositions() {
    for (const s of selections) {
      const rect = s.element.getBoundingClientRect();
      positionOverlay(s.overlayEl, rect);
    }
  }

  // ── Selection management ───────────────────────────────────────────

  function addSelection(el) {
    if (selections.length >= MAX_SELECTIONS) {
      showToast(`Maximum ${MAX_SELECTIONS} focus areas`);
      return;
    }

    const index = selections.length + 1;
    const rect = el.getBoundingClientRect();

    const overlay = document.createElement('div');
    overlay.className = 'mocker-selected-overlay';
    positionOverlay(overlay, rect);

    const badge = document.createElement('div');
    badge.className = 'mocker-badge';
    badge.textContent = index;
    overlay.appendChild(badge);

    root.appendChild(overlay);

    selections.push({
      element: el,
      overlayEl: overlay,
      badgeEl: badge,
      data: buildAreaData(el, index),
    });
    updateDoneBtn();
  }

  function removeSelection(idx) {
    const s = selections[idx];
    s.overlayEl.remove();
    selections.splice(idx, 1);
    renumberBadges();
  }

  // ── Event handlers ─────────────────────────────────────────────────

  let hoveredEl = null;

  function onMouseMove(e) {
    const el = getElementAtPoint(e.clientX, e.clientY);
    if (!el || el === hoveredEl) return;
    hoveredEl = el;

    if (isPickerElement(el) || el === document.body || el === document.documentElement) {
      hoverOverlay.style.display = 'none';
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_DIMENSION || rect.height < MIN_DIMENSION) {
      hoverOverlay.style.display = 'none';
      return;
    }

    positionOverlay(hoverOverlay, rect);
    hoverOverlay.style.display = '';
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = getElementAtPoint(e.clientX, e.clientY);
    if (!el || isPickerElement(el) || el === document.body || el === document.documentElement) return;

    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_DIMENSION || rect.height < MIN_DIMENSION) return;

    const existingIdx = findSelectionByElement(el);
    if (existingIdx >= 0) {
      removeSelection(existingIdx);
    } else {
      addSelection(el);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (selections.length === 0) {
        chrome.runtime.sendMessage({ action: 'focusAreasCancelled' });
        cleanup();
      } else {
        finalize();
      }
    }
  }

  function onScroll() {
    refreshOverlayPositions();
    // Update hover position too
    if (hoveredEl) {
      const rect = hoveredEl.getBoundingClientRect();
      positionOverlay(hoverOverlay, rect);
    }
  }

  // ── Finalize / cleanup ─────────────────────────────────────────────

  function finalize() {
    // Refresh positions one last time before screenshot
    refreshOverlayPositions();

    // Hide hover overlay and UI chrome so only selection overlays show in screenshot
    hoverOverlay.style.display = 'none';
    doneBtn.style.display = 'none';
    toast.style.display = 'none';
    cancelHint.style.display = 'none';

    const areas = selections.map(s => buildAreaData(s.element, s.data.index));

    // Tell service worker we're ready — it will take a screenshot then tell us to clean up
    chrome.runtime.sendMessage({ action: 'focusAreasReady', areas });
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll, true);
    root.remove();
    style.remove();
  }

  // Listen for cleanup signal from service worker
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'cleanupPicker') {
      cleanup();
    }
  });

  // ── Done button handler ────────────────────────────────────────────
  doneBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selections.length === 0) {
      chrome.runtime.sendMessage({ action: 'focusAreasCancelled' });
      cleanup();
    } else {
      finalize();
    }
  });

  // ── Attach listeners ──────────────────────────────────────────────
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll, true);
})();
