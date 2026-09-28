// SEO Lens panel v0.4.0, floating bottom-right panel.
// Runs as a content script in the page's isolated world (injected after scraper.js).
// UI lives in a Shadow DOM with constructed stylesheets, so the host page's
// CSS/CSP can't touch it. Dependency-free: no imports.
(function () {
  'use strict';

  var HOST_ID = 'seo-lens-host';

  // Toggle: clicking the toolbar icon while the panel is open closes it.
  var existing = document.getElementById(HOST_ID);
  if (existing) { existing.remove(); return; }

  // Esc closes the panel (wired once per page).
  if (!window.__seoLensPanelEscWired) {
    window.__seoLensPanelEscWired = true;
    document.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') {
        var h = document.getElementById(HOST_ID);
        if (h) h.remove();
      }
    });
  }

  var root = null;    // shadow root, all queries are scoped to it
  var hostEl = null;
  var lastData = null;
  var fontSheet = null; // document-level @font-face sheet; removed with the panel
  var hlSheet = null;   // document-level highlight stylesheet; removed with the panel
  var hlOn = false;

  // The panel's document-level additions (font faces, highlight marks) must be
  // removed when the host goes away (close button, Escape, or toolbar toggle
  // all just remove the host node).
  var fontObs = new MutationObserver(function () {
    if (!document.getElementById(HOST_ID)) { removeFontSheet(); clearPageMarks(); fontObs.disconnect(); }
  });
  fontObs.observe(document.documentElement, { childList: true });

  function el(id) {
    return root.getElementById ? root.getElementById(id) : root.querySelector('#' + id);
  }
  function qsa(sel) { return root.querySelectorAll(sel); }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var TEMPLATE =
    '<div class="sl-root">' +
    '<div id="app">' +
    '  <header>' +
    '    <div id="score-wrap">' +
    '      <svg id="score-ring" viewBox="0 0 72 72" width="72" height="72">' +
    '        <circle cx="36" cy="36" r="30" class="ring-bg"/>' +
    '        <circle cx="36" cy="36" r="30" class="ring-fg" id="ring-fg"/>' +
    '        <text x="36" y="42" text-anchor="middle" id="score-text">–</text>' +
    '      </svg>' +
    '      <div id="score-meta">' +
    '        <div id="score-label">SEO score</div>' +
    '        <div id="page-title" title=""></div>' +
    '        <div id="page-url"></div>' +
    '      </div>' +
    '    </div>' +
    '    <button id="sl-close" title="Close panel">×</button>' +
    '  </header>' +
    '  <div class="tabs-wrap">' +
    '    <button class="tabs-arrow" id="tabs-prev" aria-label="Scroll tabs left" hidden>&#8249;</button>' +
    '    <nav id="tabs">' +
    '      <button data-tab="overview" class="active">Overview</button>' +
    '      <button data-tab="serp">SERP</button>' +
    '      <button data-tab="keywords">Keywords</button>' +
    '      <button data-tab="perf">Performance</button>' +
    '      <button data-tab="fixes">Fixes</button>' +
    '      <button data-tab="headings">Headings</button>' +
    '      <button data-tab="images">Images</button>' +
    '      <button data-tab="links">Links</button>' +
    '      <button data-tab="social">Social</button>' +
    '      <button data-tab="schema">Schema</button>' +
    '      <button data-tab="history">History</button>' +
    '    </nav>' +
    '    <button class="tabs-arrow" id="tabs-next" aria-label="Scroll tabs right" hidden>&#8250;</button>' +
    '  </div>' +
    '  <main>' +
    '    <section id="tab-overview" class="tab-panel active"></section>' +
    '    <section id="tab-serp" class="tab-panel"></section>' +
    '    <section id="tab-keywords" class="tab-panel"></section>' +
    '    <section id="tab-perf" class="tab-panel"></section>' +
    '    <section id="tab-fixes" class="tab-panel"></section>' +
    '    <section id="tab-headings" class="tab-panel"></section>' +
    '    <section id="tab-images" class="tab-panel"></section>' +
    '    <section id="tab-links" class="tab-panel"></section>' +
    '    <section id="tab-social" class="tab-panel"></section>' +
    '    <section id="tab-schema" class="tab-panel"></section>' +
    '    <section id="tab-history" class="tab-panel"></section>' +
    '  </main>' +
    '  <footer>' +
    '    <span>SEO Lens v0.5.4</span>' +
    '    <span class="export-btns">' +
    '      <button id="btn-copy" title="Copy report as Markdown">Copy report</button>' +
    '      <button id="btn-download" title="Download report as Markdown file">Download .md</button>' +
    '    </span>' +
    '  </footer>' +
    '</div>' +
    '<div id="status"></div>' +
    '</div>';

  function applyCss(cssText) {
    // Chrome does not load @font-face fonts declared inside shadow-root
    // stylesheets, so font faces are installed at document level via a
    // constructed stylesheet (CSP-exempt). Font *use* (font-family: Inter)
    // inside the shadow tree still resolves to these document-level faces.
    // Everything else stays scoped to the shadow root.
    var faces = cssText.match(/@font-face\s*{[^}]+}/g) || [];
    var restCss = cssText;
    faces.forEach(function (f) { restCss = restCss.replace(f, ''); });

    // Scoped panel styles.
    // Constructed stylesheets are exempt from the page's CSP; fall back to a
    // plain <style> element on older browsers.
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(restCss);
      root.adoptedStyleSheets = [sheet];
    } catch (e) {
      var st = document.createElement('style');
      st.textContent = restCss;
      root.appendChild(st);
    }

    // Document-level font faces.
    removeFontSheet();
    if (faces.length) {
      try {
        fontSheet = new CSSStyleSheet();
        fontSheet.replaceSync(faces.join('\n'));
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat([fontSheet]);
      } catch (e) { fontSheet = null; }
    }
  }

  function removeFontSheet() {
    if (fontSheet) {
      try {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (s) { return s !== fontSheet; });
      } catch (e) {}
      fontSheet = null;
    }
  }

  // ---- "Highlight issues", reversible visual overlay on the page ----
  // Only adds outline classes to existing elements (never changes content or
  // layout); everything is removed when toggled off or the panel closes.
  function clearPageMarks() {
    hlOn = false;
    if (hlSheet) {
      try {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (s) { return s !== hlSheet; });
      } catch (e) {}
      hlSheet = null;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.__sl-hl'), function (n) {
      n.classList.remove('__sl-hl', '__sl-hl-e', '__sl-hl-w');
    });
  }

  function setHighlight(on) {
    clearPageMarks();
    var btn = null, legend = null;
    try { btn = el('btn-highlight'); legend = el('hl-legend'); } catch (e) {}
    if (!on) {
      if (btn) btn.textContent = 'Highlight issues on page';
      if (legend) legend.style.display = 'none';
      return;
    }
    hlOn = true;
    try {
      hlSheet = new CSSStyleSheet();
      hlSheet.replaceSync(
        '.__sl-hl-e{outline:3px dashed #dc2626 !important;outline-offset:2px !important;}' +
        '.__sl-hl-w{outline:3px dashed #d97706 !important;outline-offset:2px !important;}');
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat([hlSheet]);
    } catch (e) { hlSheet = null; }
    var n = 0;
    function mark(node, cls) {
      if (!node || (node.closest && node.closest('#' + HOST_ID))) return;
      node.classList.add('__sl-hl', cls);
      n++;
    }
    // images missing alt text (error)
    Array.prototype.forEach.call(document.querySelectorAll('img'), function (img) {
      if (!(img.getAttribute('alt') || '').trim()) mark(img, '__sl-hl-e');
    });
    // oversized images (warning)
    Array.prototype.forEach.call(document.querySelectorAll('img'), function (img) {
      try {
        if (img.naturalWidth > 0 && img.clientWidth > 0 && img.naturalWidth > img.clientWidth * 1.5) {
          mark(img, '__sl-hl-w');
        }
      } catch (e) {}
    });
    // broken / unreachable links (error), async results live at data.brokenLinks
    var badUrls = {};
    var bl = lastData && (lastData.brokenLinks || (lastData.links && lastData.links.checkable ? lastData.links : null));
    if (bl) {
      (bl.broken || []).concat(bl.unreachable || []).forEach(function (b) {
        if (b && b.url) badUrls[String(b.url).split('#')[0]] = true;
      });
    }
    if (Object.keys(badUrls).length) {
      Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
        try {
          if (badUrls[new URL(a.getAttribute('href'), location.href).href.split('#')[0]]) mark(a, '__sl-hl-e');
        } catch (e) {}
      });
    }
    // skipped heading levels (warning)
    var prev = 0;
    Array.prototype.forEach.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6'), function (h) {
      var lvl = parseInt(h.tagName.charAt(1), 10);
      if (prev && lvl - prev > 1) mark(h, '__sl-hl-w');
      prev = lvl;
    });
    if (btn) btn.textContent = n ? 'Hide highlights (' + n + ')' : 'No visual issues found';
    if (legend) legend.style.display = n ? 'inline-flex' : 'none';
    if (n) {
      var first = document.querySelector('.__sl-hl');
      if (first && first.scrollIntoView) {
        try { first.scrollIntoView({ block: 'center' }); } catch (e) {}
      }
    } else {
      hlOn = false;
    }
  }

  async function boot() {
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    document.documentElement.appendChild(hostEl);
    root = hostEl.attachShadow({ mode: 'open' });

    var cssText = await fetch(chrome.runtime.getURL('panel.css')).then(function (r) {
      if (!r.ok) throw new Error('Could not load panel styles (HTTP ' + r.status + ').');
      return r.text();
    });
    // Resolve the bundled font URLs (relative URLs would resolve against the page).
    cssText = cssText.split('__FONTS__').join(chrome.runtime.getURL('fonts/'));

    root.innerHTML = TEMPLATE;
    applyCss(cssText);

    el('sl-close').addEventListener('click', function () { hostEl.remove(); });
    wireTabs();
    wireTabArrows();
    el('btn-copy').addEventListener('click', copyReport);
    el('btn-download').addEventListener('click', downloadReport);

    var statusEl = el('status');
    try {
      if (typeof window.__seoLensScrape !== 'function') {
        throw new Error('Scraper did not load on this page.');
      }
      statusEl.innerHTML = '<div class="loading">Analyzing page… (checking links can take a few seconds)</div>';
      var data = await window.__seoLensScrape();
      if (!data) throw new Error('The scraper returned no data.');
      statusEl.innerHTML = '';
      lastData = data;
      render(data);
      saveSnapshot(data, function () { renderHistory(); });
    } catch (err) {
      el('app').style.display = 'none';
      statusEl.innerHTML = '<div class="error">' + escapeHtml(err && err.message ? err.message : String(err)) + '</div>';
    }
  }

  function wireTabs() {
    var buttons = qsa('#tabs button');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) { b.classList.remove('active'); });
        qsa('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
        btn.classList.add('active');
        el('tab-' + btn.dataset.tab).classList.add('active');
        ensureTabVisible(btn);
      });
    });
  }

  // Tab-strip overflow arrows: ‹ › reveal hidden tabs on click; the strip
  // stays natively swipeable/scrollable. Arrows show only when needed.
  function wireTabArrows() {
    var tabs = el('tabs'), prev = el('tabs-prev'), next = el('tabs-next');
    if (!tabs || !prev || !next) return;
    function update() {
      var max = tabs.scrollWidth - tabs.clientWidth;
      if (max <= 1) { prev.hidden = true; next.hidden = true; return; }
      prev.hidden = tabs.scrollLeft <= 1;
      next.hidden = tabs.scrollLeft >= max - 1;
    }
    prev.addEventListener('click', function () { tabs.scrollBy({ left: -200, behavior: 'smooth' }); });
    next.addEventListener('click', function () { tabs.scrollBy({ left: 200, behavior: 'smooth' }); });
    tabs.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // Keep the active tab button inside the visible part of the strip.
  function ensureTabVisible(btn) {
    var tabs = el('tabs');
    if (!tabs) return;
    var r = btn.getBoundingClientRect(), tr = tabs.getBoundingClientRect();
    if (r.left < tr.left) tabs.scrollBy({ left: r.left - tr.left - 10, behavior: 'smooth' });
    else if (r.right > tr.right) tabs.scrollBy({ left: r.right - tr.right + 10, behavior: 'smooth' });
  }

  function ringColor(score) {
    if (score >= 80) return '#22c55e';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }

  function kv(k, v) {
    return '<div class="kv"><span class="k">' + escapeHtml(k) + '</span><span class="v">' + escapeHtml(v) + '</span></div>';
  }

  function render(data) {
    var C = 188.5;
    var ring = el('ring-fg');
    ring.style.strokeDashoffset = String(C - (C * data.score) / 100);
    ring.style.stroke = ringColor(data.score);
    el('score-text').textContent = data.score;
    el('page-title').textContent = data.title || '(no title)';
    el('page-title').title = data.title || '';
    try {
      el('page-url').textContent = new URL(data.url).hostname;
    } catch (e) {
      el('page-url').textContent = data.url;
    }

    renderOverview(data);
    renderSerp(data);
    renderKeywords(data);
    renderPerf(data);
    renderFixes(data);
    renderHeadings(data);
    renderImages(data);
    renderLinks(data);
    renderSocial(data);
    renderSchema(data);
    renderHistory();
  }

  function renderOverview(data) {
    var info = '';
    if (data.lastModified) {
      var lm = new Date(data.lastModified);
      if (!isNaN(lm.getTime())) {
        info = '<div class="page-meta"><div class="kv"><span class="k">Last modified</span><span class="v">' +
          escapeHtml(lm.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })) +
          ' <span class="faint">(as reported by the browser)</span></span></div></div>';
      }
    }
    el('tab-overview').innerHTML = info + data.checks.map(function (c) {
      return '<div class="check"><span class="dot ' + c.status + '"></span>' +
        '<div><div class="label">' + escapeHtml(c.label) + '</div>' +
        '<div class="detail">' + escapeHtml(c.detail) + '</div></div></div>';
    }).join('') +
      '<div class="note">The score covers stable on-page checks only. Performance timings, robots.txt / sitemap.xml, and link availability are reported above for reference and don\'t change the score, so it stays consistent between reloads.</div>';
  }

  function serpCard(s, narrow) {
    var title = s.title || '(no title)';
    var desc = s.description || '(no meta description)';
    return '<div class="serp-card' + (narrow ? ' narrow' : '') + '">' +
      '<div class="serp-url">' + escapeHtml(s.displayUrl) + '</div>' +
      '<div class="serp-title">' + escapeHtml(title) + '</div>' +
      '<div class="serp-desc">' + escapeHtml(desc) + '</div></div>';
  }

  function renderSerp(data) {
    var s = data.serp;
    var warns = '';
    if (!s.title) warns += '<div class="warn-line">No title, so Google will invent one.</div>';
    else if (s.titleTruncated) warns += '<div class="warn-line">Title is ' + s.titleLen + ' characters, likely truncated in results.</div>';
    if (!s.description) warns += '<div class="warn-line">No meta description, so Google will pick its own snippet.</div>';
    else if (s.descTruncated) warns += '<div class="warn-line">Description is ' + s.descLen + ' characters, likely truncated.</div>';
    el('tab-serp').innerHTML =
      '<div class="section-label">Desktop preview</div>' + serpCard(s, false) +
      '<div class="section-label">Mobile preview</div>' + serpCard(s, true) +
      (warns || '<div class="ok-line">Title and description lengths look good.</div>');
  }

  function renderKeywords(data) {
    var kws = data.keywords || [];
    var phrs = data.phrases || [];
    if (!kws.length && !phrs.length) {
      el('tab-keywords').innerHTML = '<div class="empty">Not enough text on this page to analyze keywords.</div>';
      return;
    }
    function kwTable(label, rows) {
      return '<div class="section-label">' + label + '</div><table class="kw-table">' +
        '<tr><th>' + (label === 'Top phrases' ? 'Phrase' : 'Keyword') + '</th><th>Count</th><th>Density</th></tr>' +
        rows.map(function (k) {
          return '<tr><td>' + escapeHtml(k.word) + '</td><td>' + k.count +
            '</td><td>' + k.density.toFixed(2) + '%</td></tr>';
        }).join('') + '</table>';
    }
    var html = '';
    if (kws.length) html += kwTable('Top keywords', kws);
    if (phrs.length) html += kwTable('Top phrases', phrs);

    var ps = data.keywordPlacements || [];
    if (ps.length) {
      html += '<div class="section-label">Keyword placement</div>';
      ps.forEach(function (p) {
        var rows = [
          ['In page title', p.inTitle],
          ['In H1', p.inH1],
          ['In URL', p.inUrl],
          ['In first 100 words', p.inIntro]
        ];
        html += '<div class="place-kw">&ldquo;' + escapeHtml(p.keyword) + '&rdquo;</div>' +
          rows.map(function (r) {
            return '<div class="place-row"><span class="place-' + (r[1] ? 'yes">✓' : 'no">✗') +
              '</span> ' + escapeHtml(r[0]) + '</div>';
          }).join('');
      });
    }
    el('tab-keywords').innerHTML = html;
  }

  function fmtBytes(b) {
    if (b == null) return 'n/a';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }

  function fmtSecs(ms) {
    if (ms == null) return 'n/a';
    return (ms / 1000).toFixed(2) + 's';
  }

  function renderPerf(data) {
    var p = data.performance || {};
    if (!p.measurable) {
      el('tab-perf').innerHTML = '<div class="empty">Performance timing is not measurable on this page.</div>';
      return;
    }
    var cards = [
      ['LCP', fmtSecs(p.lcp), 'Largest Contentful Paint'],
      ['CLS', p.cls == null ? 'n/a' : p.cls, 'Cumulative Layout Shift'],
      ['TTFB', fmtSecs(p.ttfb), 'Time to First Byte'],
      ['Load', fmtSecs(p.pageLoad), 'Full page load']
    ];
    el('tab-perf').innerHTML = '<div class="perf-grid">' +
      cards.map(function (c) {
        return '<div class="perf-card"><div class="perf-val">' + escapeHtml(c[1]) +
          '</div><div class="perf-name">' + escapeHtml(c[0]) + '</div><div class="perf-sub">' +
          escapeHtml(c[2]) + '</div></div>';
      }).join('') + '</div>' +
      kv('Data transferred', fmtBytes(p.bytes)) +
      kv('Requests', p.requests) +
      kv('DOM ready', fmtSecs(p.domContentLoaded)) +
      kv('Long tasks (>50ms)', p.longTasks) +
      '<div class="psi-row"><div class="section-label">Deep analysis</div>' +
      '<div class="psi-btns"><button class="copy-btn" id="btn-psi-mobile">PageSpeed Insights: Mobile</button> ' +
      '<button class="copy-btn" id="btn-psi-desktop">PageSpeed Insights: Desktop</button></div>' +
      '<div class="note">Opens Google PageSpeed Insights for this exact URL in a new tab.</div></div>' +
      '<div class="note">Transfer size excludes cross-origin resources without timing permission, treat as a lower bound.</div>';
    qsa('#btn-psi-mobile, #btn-psi-desktop').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var ff = btn.id === 'btn-psi-mobile' ? 'mobile' : 'desktop';
        window.open('https://pagespeed.web.dev/analysis?url=' +
          encodeURIComponent(data.url || location.href) + '&form_factor=' + ff, '_blank', 'noopener');
      });
    });
  }

  function renderFixes(data) {
    var fixes = data.suggestions || [];
    var hlRow = '<div class="hl-row"><button class="copy-btn" id="btn-highlight">Highlight issues on page</button>' +
      '<span class="hl-legend" id="hl-legend"><i class="sw sw-e"></i>error&nbsp;&nbsp;<i class="sw sw-w"></i>warning</span></div>';
    if (!fixes.length) {
      el('tab-fixes').innerHTML = hlRow +
        '<div class="ok-line">No issues found that have ready-made fixes. Nice work!</div>';
    } else {
      el('tab-fixes').innerHTML = hlRow +
        '<div class="note" style="margin-bottom:10px">Rule-based suggestions generated from this page\u2019s issues. Review before using.</div>' +
        fixes.map(function (f, i) {
          return '<div class="fix-card"><div class="fix-title">' + escapeHtml(f.title) + '</div>' +
            '<div class="fix-why">' + escapeHtml(f.why) + '</div>' +
            '<pre class="fix-snippet">' + escapeHtml(f.snippet) + '</pre>' +
            '<button class="copy-btn" data-fix="' + i + '">Copy snippet</button></div>';
        }).join('');
    }
    el('btn-highlight').addEventListener('click', function () { setHighlight(!hlOn); });
    qsa('#tab-fixes .copy-btn[data-fix]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var f = fixes[parseInt(btn.dataset.fix, 10)];
        copyText(f.snippet).then(function () {
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = 'Copy snippet'; }, 1500);
        });
      });
    });
  }

  function renderHeadings(data) {
    if (!data.headings.length) {
      el('tab-headings').innerHTML = '<div class="empty">No headings found on this page.</div>';
      return;
    }
    el('tab-headings').innerHTML = '<div class="kv"><span class="k">Total headings</span><span class="v">' +
      data.headings.length + ' (H1: ' + data.h1Count + ')</span></div>' +
      data.headings.map(function (h) {
        return '<div class="h h-' + h.level + '"><span class="lvl">H' + h.level + '</span> ' +
          escapeHtml(h.text || '(empty)') + '</div>';
      }).join('');
  }

  function renderImages(data) {
    var im = data.images;
    var html =
      kv('Total images', im.total) +
      kv('Missing alt text', im.missingAltCount) +
      kv('Oversized (wasteful)', im.oversizedCount) +
      kv('Missing width/height attrs', im.missingDims) +
      kv('Lazy-loaded', im.lazyCount);

    if (im.oversizedCount > 0) {
      html += '<div class="section-label">Oversized images</div>' +
        im.oversized.map(function (o) {
          return '<div class="alt-row mono">' + escapeHtml(o.src) +
            '<br>natural ' + escapeHtml(o.natural) + ' → displayed ' + escapeHtml(o.displayed) + '</div>';
        }).join('');
    }
    if (im.missingAltCount > 0) {
      html += '<div class="section-label">Images without alt</div>' +
        im.missingAlt.map(function (src) { return '<div class="alt-row mono">' + escapeHtml(src) + '</div>'; }).join('');
      if (im.missingAltCount > im.missingAlt.length) {
        html += '<div class="empty">…and ' + (im.missingAltCount - im.missingAlt.length) + ' more.</div>';
      }
    }
    el('tab-images').innerHTML = html;
  }

  function renderLinks(data) {
    var html =
      kv('Total links', data.links.total) +
      kv('Internal', data.links.internal) +
      kv('External', data.links.external) +
      kv('Nofollow', data.links.nofollow);

    var bl = data.brokenLinks;
    if (bl && bl.checkable) {
      html += '<div class="section-label">Link health (checked ' + bl.checked +
        (bl.truncated ? ' of ' + bl.total : '') + ')</div>';
      if (bl.broken.length) {
        html += bl.broken.map(function (b) {
          return '<div class="alt-row mono broken">✗ ' + escapeHtml(b.url) +
            ' <span class="status-code">HTTP ' + b.status + (b.timeout ? ' (timeout)' : '') + '</span></div>';
        }).join('');
      } else {
        html += '<div class="ok-line">No broken links found.</div>';
      }
      if (bl.unreachable.length) {
        html += '<div class="section-label">Unreachable external links</div>' +
          bl.unreachable.map(function (b) { return '<div class="alt-row mono">✗ ' + escapeHtml(b.url) + '</div>'; }).join('') +
          '<div class="note">External checks are reachability-only, browsers hide cross-origin status codes.</div>';
      }
    }
    el('tab-links').innerHTML = html;
  }

  function renderSocial(data) {
    var og = data.og || {};
    el('tab-social').innerHTML =
      kv('og:title', og['og:title'] || 'n/a') +
      kv('og:description', og['og:description'] || 'n/a') +
      kv('og:image', og['og:image'] || 'n/a') +
      kv('twitter:card', data.twitterCard || 'n/a');
  }

  function renderSchema(data) {
    var j = data.jsonld || { blocks: 0, types: [] };
    var html = kv('JSON-LD blocks', j.blocks);
    if (j.types && j.types.length) {
      html += '<div class="section-label">Detected types</div>' +
        j.types.map(function (t) { return '<div class="alt-row mono">' + escapeHtml(t) + '</div>'; }).join('');
    } else {
      html += '<div class="empty" style="margin-top:8px">No schema types detected.</div>';
    }
    var crawl = data.crawl || {};
    if (crawl.robots && crawl.robots.checkable) {
      html += '<div class="section-label">robots.txt</div>' +
        kv('Exists', crawl.robots.exists ? 'Yes' : 'No') +
        (crawl.robots.exists ? kv('This page blocked', crawl.robots.blocked ? 'Yes, fix urgently!' : 'No') : '');
    }
    if (crawl.sitemap && crawl.sitemap.checkable) {
      html += '<div class="section-label">sitemap.xml</div>' +
        kv('Exists', crawl.sitemap.exists ? 'Yes' : 'No') +
        (crawl.sitemap.exists ? kv('Page listed', crawl.sitemap.containsPage ? 'Yes' : 'No') : '');
    }
    el('tab-schema').innerHTML = html;
  }

  // ---- Score history (chrome.storage.local, device-only) ----
  var HISTORY_KEY = 'seoLensHistory';
  var HISTORY_MAX = 50;                 // entries kept per page
  var HISTORY_MIN_GAP = 30 * 60 * 1000; // don't spam snapshots within 30 min unless score changed

  function historyStore() {
    try {
      return (window.chrome && chrome.storage && chrome.storage.local) ? chrome.storage.local : null;
    } catch (e) { return null; }
  }

  function historyUrl() {
    try {
      var u = new URL(location.href);
      return u.origin + u.pathname;
    } catch (e) { return String(location.href).split('#')[0]; }
  }

  function loadHistory(cb) {
    var st = historyStore();
    if (!st) { cb({}); return; }
    try {
      st.get(HISTORY_KEY, function (res) {
        cb((res && res[HISTORY_KEY]) || {});
      });
    } catch (e) { cb({}); }
  }

  function saveHistoryObj(h, done) {
    var st = historyStore();
    done = done || function () {};
    if (!st) { done(); return; }
    try {
      var obj = {};
      obj[HISTORY_KEY] = h;
      st.set(obj, function () { done(); });
    } catch (e) { done(); }
  }

  function saveSnapshot(data, done) {
    done = done || function () {};
    if (!historyStore() || !data || typeof data.score !== 'number') { done(); return; }
    var key = historyUrl();
    var entry = { t: Date.now(), s: data.score, pass: 0, warn: 0, fail: 0 };
    (data.checks || []).forEach(function (c) {
      if (c.status === 'pass') entry.pass++;
      else if (c.status === 'warn') entry.warn++;
      else if (c.status === 'fail') entry.fail++;
    });
    loadHistory(function (h) {
      var list = h[key] || [];
      var last = list[list.length - 1];
      if (last && (entry.t - last.t) < HISTORY_MIN_GAP && last.s === entry.s) { done(false); return; }
      list.push(entry);
      if (list.length > HISTORY_MAX) list = list.slice(list.length - HISTORY_MAX);
      h[key] = list;
      saveHistoryObj(h, function () { done(true); });
    });
  }

  function scoreBand(s) {
    return s >= 80 ? 'good' : (s >= 50 ? 'mid' : 'bad');
  }

  function sparkline(entries) {
    var W = 320, H = 60, PAD = 8;
    if (entries.length < 2) {
      return '<div class="note">Not enough scans yet, run the extension again later to build a trend.</div>';
    }
    var scores = entries.map(function (e) { return e.s; });
    var lo = Math.max(0, Math.min.apply(null, scores) - 5);
    var hi = Math.min(100, Math.max.apply(null, scores) + 5);
    if (hi - lo < 10) { hi = Math.min(100, lo + 10); lo = Math.max(0, hi - 10); }
    function x(i) { return PAD + (W - 2 * PAD) * (i / (entries.length - 1)); }
    function y(s) { return H - PAD - (H - 2 * PAD) * ((s - lo) / (hi - lo)); }
    var pts = entries.map(function (e, i) { return x(i).toFixed(1) + ',' + y(e.s).toFixed(1); }).join(' ');
    var dots = entries.map(function (e, i) {
      return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(e.s).toFixed(1) + '" r="3.5" fill="' + ringColor(e.s) + '"/>';
    }).join('');
    return '<div class="spark-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="spark" preserveAspectRatio="none">' +
      '<polyline points="' + pts + '" fill="none" stroke="#4f46e5" stroke-width="2"/>' + dots + '</svg>' +
      '<div class="spark-labels"><span>high ' + hi + '</span><span>low ' + lo + '</span></div></div>';
  }

  function renderHistory() {
    var sec = el('tab-history');
    if (!sec) return;
    sec.innerHTML = '<div class="empty">Loading history…</div>';
    loadHistory(function (h) {
      var list = h[historyUrl()] || [];
      if (!historyStore()) {
        sec.innerHTML = '<div class="empty">History needs the storage permission, which is unavailable here.</div>';
        return;
      }
      if (!list.length) {
        sec.innerHTML = '<div class="empty">No scans saved for this page yet.<br>Each scan is stored automatically on this device.</div>';
        return;
      }
      var ordered = list.slice().reverse(); // newest first
      var rows = ordered.map(function (e, i) {
        var prev = ordered[i + 1];
        var dHtml = '<span class="delta">·</span>';
        if (prev) {
          var d = e.s - prev.s;
          dHtml = d > 0 ? '<span class="delta up">+' + d + '</span>'
            : (d < 0 ? '<span class="delta down">' + d + '</span>' : '<span class="delta">±0</span>');
        }
        var dt = new Date(e.t);
        var when = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' +
          dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        return '<div class="hist-row"><span class="hist-score ' + scoreBand(e.s) + '">' + e.s + '</span>' +
          '<span class="hist-when">' + escapeHtml(when) + '</span>' + dHtml +
          '<span class="hist-counts" title="passed / warnings / failed checks">' +
          e.pass + '✓ ' + e.warn + '⚠ ' + e.fail + '✗</span></div>';
      }).join('');
      sec.innerHTML =
        '<div class="section-label">Score trend, this page</div>' +
        sparkline(list.slice(-20)) +
        '<div class="section-label">Scans (' + list.length + ')</div>' +
        '<div class="hist-list">' + rows + '</div>' +
        '<button class="copy-btn" id="btn-clear-history">Clear history for this page</button>' +
        '<div class="note">Stored only on this device, nothing leaves your browser.</div>';
      el('btn-clear-history').addEventListener('click', function () {
        loadHistory(function (hh) {
          delete hh[historyUrl()];
          saveHistoryObj(hh, function () { renderHistory(); });
        });
      });
    });
  }

  // ---- Report export ----
  function statusIcon(s) { return s === 'pass' ? '✓' : (s === 'warn' ? '⚠' : '✗'); }

  function buildMarkdown(data) {
    var L = [];
    L.push('# SEO Lens report');
    L.push('');
    L.push('- URL: ' + data.url);
    L.push('- Date: ' + new Date().toISOString());
    L.push('- **Score: ' + data.score + '/100**');
    L.push('');
    L.push('## Checks');
    L.push('');
    L.push('| Status | Check | Detail |');
    L.push('|---|---|---|');
    data.checks.forEach(function (c) {
      var detail = String(c.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ');
      L.push('| ' + statusIcon(c.status) + ' | ' + c.label + ' | ' + detail + ' |');
    });
    L.push('');
    if (data.keywords && data.keywords.length) {
      L.push('## Top keywords');
      L.push('');
      L.push('| Keyword | Count | Density |');
      L.push('|---|---|---|');
      data.keywords.forEach(function (k) { L.push('| ' + k.word + ' | ' + k.count + ' | ' + k.density.toFixed(2) + '% |'); });
      L.push('');
    }
    if (data.phrases && data.phrases.length) {
      L.push('## Top phrases');
      L.push('');
      L.push('| Phrase | Count | Density |');
      L.push('|---|---|---|');
      data.phrases.forEach(function (k) { L.push('| ' + k.word + ' | ' + k.count + ' | ' + k.density.toFixed(2) + '% |'); });
      L.push('');
    }
    var kps = data.keywordPlacements || [];
    if (kps.length) {
      L.push('## Keyword placement');
      L.push('');
      kps.forEach(function (p) {
        L.push('- "' + p.keyword + '": title ' + (p.inTitle ? 'yes' : 'no') +
          ', H1 ' + (p.inH1 ? 'yes' : 'no') + ', URL ' + (p.inUrl ? 'yes' : 'no') +
          ', intro ' + (p.inIntro ? 'yes' : 'no'));
      });
      L.push('');
    }
    var p = data.performance;
    if (p && p.measurable) {
      L.push('## Performance');
      L.push('');
      L.push('- LCP: ' + fmtSecs(p.lcp) + ', CLS: ' + (p.cls == null ? 'n/a' : p.cls) +
        ', TTFB: ' + fmtSecs(p.ttfb) + ', Load: ' + fmtSecs(p.pageLoad));
      L.push('- Transferred: ' + fmtBytes(p.bytes) + ' across ' + p.requests + ' requests');
      L.push('');
    }
    var bl = data.brokenLinks;
    if (bl && bl.checkable && bl.broken.length) {
      L.push('## Broken links');
      L.push('');
      bl.broken.forEach(function (b) { L.push('- ' + b.url + ' (HTTP ' + b.status + ')'); });
      L.push('');
    }
    if (data.suggestions && data.suggestions.length) {
      L.push('## Suggested fixes');
      L.push('');
      data.suggestions.forEach(function (s) {
        L.push('### ' + s.title);
        L.push('');
        L.push(s.why);
        L.push('');
        L.push('```');
        L.push(s.snippet);
        L.push('```');
        L.push('');
      });
    }
    L.push('_Generated by SEO Lens v0.5.4_');
    return L.join('\n');
  }

  function legacyCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.documentElement.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).catch(function () { legacyCopy(t); });
    }
    legacyCopy(t);
    return Promise.resolve();
  }

  function copyReport() {
    if (!lastData) return;
    var btn = el('btn-copy');
    copyText(buildMarkdown(lastData)).then(function () {
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = 'Copy report'; }, 1500);
    });
  }

  function downloadReport() {
    if (!lastData) return;
    var blob = new Blob([buildMarkdown(lastData)], { type: 'text/markdown' });
    var a = document.createElement('a');
    var name = 'seo-report';
    try { name = new URL(lastData.url).hostname.replace(/\./g, '-') + '-seo-report'; } catch (e) {}
    a.href = URL.createObjectURL(blob);
    a.download = name + '.md';
    root.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  boot();
})();
