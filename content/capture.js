/**
 * Content script injected programmatically into the active tab.
 * Captures the page DOM and collects resource URLs.
 *
 * Returns: { html: string, resourceUrls: string[], stylesheetUrls: string[] }
 */
(function capturePageSnapshot() {
  // 1. Bake current form field values into attributes
  document.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (el.checked) {
          el.setAttribute('checked', 'checked');
        } else {
          el.removeAttribute('checked');
        }
      } else {
        el.setAttribute('value', el.value);
      }
    } else if (el.tagName === 'TEXTAREA') {
      el.textContent = el.value;
    } else if (el.tagName === 'SELECT') {
      for (const opt of el.options) {
        if (opt.selected) {
          opt.setAttribute('selected', 'selected');
        } else {
          opt.removeAttribute('selected');
        }
      }
    }
  });

  // 2. Convert <canvas> elements to <img>
  document.querySelectorAll('canvas').forEach(canvas => {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const img = document.createElement('img');
      img.src = dataUrl;
      img.width = canvas.width;
      img.height = canvas.height;
      img.style.cssText = canvas.style.cssText;
      // Copy class and id
      if (canvas.className) img.className = canvas.className;
      if (canvas.id) img.id = canvas.id;
      canvas.replaceWith(img);
    } catch {
      // Tainted canvas - skip
    }
  });

  // 3. Collect all computed styles from <style> tags and CSS-in-JS injected sheets
  const inlineStyles = [];
  for (const sheet of document.styleSheets) {
    // Only collect sheets that are from <style> tags (not external links)
    if (sheet.ownerNode && sheet.ownerNode.tagName === 'STYLE') {
      try {
        let cssText = '';
        for (const rule of sheet.cssRules) {
          cssText += rule.cssText + '\n';
        }
        inlineStyles.push(cssText);
      } catch {
        // Cross-origin stylesheet - skip
      }
    }
  }

  // 4. Clone the full DOM
  const html = document.documentElement.outerHTML;

  // 5. Collect external stylesheet URLs
  const stylesheetUrls = [];
  document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      stylesheetUrls.push(new URL(href, document.baseURI).href);
    }
  });

  // 6. Collect resource URLs (images, fonts from CSS url() refs, etc.)
  const resourceUrls = new Set();

  // Images
  document.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (src && !src.startsWith('data:')) {
      resourceUrls.add(new URL(src, document.baseURI).href);
    }
    const srcset = img.getAttribute('srcset');
    if (srcset) {
      srcset.split(',').forEach(entry => {
        const url = entry.trim().split(/\s+/)[0];
        if (url && !url.startsWith('data:')) {
          resourceUrls.add(new URL(url, document.baseURI).href);
        }
      });
    }
  });

  // Source tags in picture elements
  document.querySelectorAll('source').forEach(source => {
    const srcset = source.getAttribute('srcset');
    if (srcset) {
      srcset.split(',').forEach(entry => {
        const url = entry.trim().split(/\s+/)[0];
        if (url && !url.startsWith('data:')) {
          resourceUrls.add(new URL(url, document.baseURI).href);
        }
      });
    }
  });

  // Favicons
  document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(link => {
    const href = link.getAttribute('href');
    if (href && !href.startsWith('data:')) {
      resourceUrls.add(new URL(href, document.baseURI).href);
    }
  });

  // Video posters
  document.querySelectorAll('video[poster]').forEach(video => {
    const poster = video.getAttribute('poster');
    if (poster && !poster.startsWith('data:')) {
      resourceUrls.add(new URL(poster, document.baseURI).href);
    }
  });

  // Background images from inline styles
  document.querySelectorAll('[style]').forEach(el => {
    const style = el.getAttribute('style');
    const matches = style.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g);
    for (const match of matches) {
      const url = match[1];
      if (url && !url.startsWith('data:')) {
        try {
          resourceUrls.add(new URL(url, document.baseURI).href);
        } catch {
          // Invalid URL
        }
      }
    }
  });

  return {
    html,
    resourceUrls: [...resourceUrls],
    stylesheetUrls,
    inlineStyles,
    baseURI: document.baseURI,
  };
})();
