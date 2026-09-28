// SEO Lens scraper v0.3 — injected into the active tab via chrome.scripting.
// Must stay dependency-free: no imports, no closure variables from outside.
(function () {
  function clean(el) {
    // Strip code/icon nodes so heading/paragraph text never includes
    // script, style or inline-SVG content.
    var c = el.cloneNode(true);
    var junk = c.querySelectorAll('script,style,noscript,template,svg');
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    // <br> contributes no text node, so "CRM<br>for" would fuse into "CRMfor".
    var brs = c.querySelectorAll('br');
    for (var b = 0; b < brs.length; b++) brs[b].parentNode.replaceChild(document.createTextNode(' '), brs[b]);
    return (c.textContent || '').trim().replace(/\s+/g, ' ');
  }

  function metaContent(name) {
    var el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
    return el ? (el.getAttribute('content') || '').trim() : '';
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
  }

  var STOPWORDS = ('a,an,the,and,or,but,if,then,else,when,while,of,at,by,for,with,about,into,' +
    'through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,' +
    'again,further,once,here,there,when,where,why,how,all,any,both,each,few,more,most,' +
    'other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,don,should,' +
    'now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,' +
    'could,ought,i,you,he,she,it,we,they,them,his,her,its,our,their,this,that,these,' +
    'those,as,also,per,via,within,without,between,among,may,might,must,shall,let,say,' +
    'get,got,make,made,many,much,still,even,ever,never,always,often,every,first,one,' +
    'two,new,used,use,using,like,well,however,therefore,thus,hence,although,though,' +
    'because,until,unless,along,across,behind,beyond,plus,except,including,' +
    'your,yours,yourself,yourselves,what,whatever,which,whichever,who,whoever,whom,' +
    'whomever,whose,myself,himself,herself,itself,ourselves,themselves,mine,hers,ours,' +
    'theirs,anyone,anything,anywhere,everyone,everything,everywhere,someone,something,' +
    'somewhere,another,upon,toward,towards,onto,re,vs,etc').split(',');

  // Visible page text only: strips code (<script>/<style>), hidden nodes and
  // non-content elements so keyword stats reflect what readers (and Google)
  // actually see. Works on a clone — never mutates the live page.
  function visibleText() {
    var body = document.body || document.documentElement;
    var clone = body.cloneNode(true);
    var junk = clone.querySelectorAll(
      'script,style,noscript,template,svg,canvas,video,audio,iframe,object,embed,[hidden],#seo-lens-host');
    for (var i = 0; i < junk.length; i++) junk[i].remove();
    var els = clone.querySelectorAll('*');
    for (var j = els.length - 1; j >= 0; j--) {
      if (els[j].style && els[j].style.display === 'none') els[j].remove();
    }
    return (clone.textContent || '').trim().replace(/\s+/g, ' ');
  }

  // Lowercase meaningful tokens: drops punctuation, stopwords, bare numbers
  // and short fragments ("seo" and "crm" survive; "t" and "re" don't).
  // Splits camelCase fusions first: markup like "mo<span>Up</span>" yields
  // "moUp" in textContent, which would otherwise tokenize as junk ("moup").
  function tokenize(text) {
    var out = [];
    text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).forEach(function (w) {
      w = w.replace(/^-+|-+$/g, '');
      if (w.length < 3 || /^\d+$/.test(w) || STOPWORDS.indexOf(w) !== -1) return;
      out.push(w);
    });
    return out;
  }

  function freqTable(items, totalWords, limit) {
    var freq = {};
    items.forEach(function (w) { freq[w] = (freq[w] || 0) + 1; });
    var arr = Object.keys(freq).map(function (w) {
      return { word: w, count: freq[w], density: totalWords ? (freq[w] / totalWords * 100) : 0 };
    });
    arr.sort(function (a, b) { return b.count - a.count || (a.word < b.word ? -1 : 1); });
    return arr.slice(0, limit || 10);
  }

  function topKeywords(tokens, totalWords, limit) {
    return freqTable(tokens, totalWords, limit);
  }

  // Two-word phrases from consecutive meaningful tokens ("track time" from
  // "track the time") — closer to what real SEO tools report.
  function topPhrases(tokens, totalWords, limit) {
    var phrases = [];
    for (var i = 0; i + 1 < tokens.length; i++) {
      if (tokens[i] === tokens[i + 1]) continue; // skip "color color" stutter
      phrases.push(tokens[i] + ' ' + tokens[i + 1]);
    }
    return freqTable(phrases, totalWords, limit);
  }

  function fetchText(url) {
    return fetch(url, { method: 'GET', credentials: 'same-origin', redirect: 'follow' })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); });
  }

  function robotsInfo() {
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve({ checkable: false });
    return fetchText(location.origin + '/robots.txt').then(function (txt) {
      var blocked = false, longest = -1, sitemaps = [];
      // Only rules under "User-agent: *" apply to general crawlers like
      // Googlebot — rules for other named bots must not affect the verdict.
      var groupStar = false, inUAs = false;
      txt.split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        var uam = line.match(/^user-agent\s*:\s*(.+?)\s*$/i);
        if (uam) {
          if (!inUAs) { groupStar = false; inUAs = true; }
          if (uam[1].toLowerCase() === '*') groupStar = true;
          return;
        }
        if (!line) { groupStar = false; inUAs = false; return; }
        var sm = line.match(/^sitemap\s*:\s*(\S+)/i);
        if (sm) { sitemaps.push(sm[1]); return; }
        var m = line.match(/^disallow\s*:\s*(\S*)/i);
        if (m && groupStar && m[1] && location.pathname.indexOf(m[1]) === 0 && m[1].length > longest) {
          longest = m[1].length; blocked = true;
        }
      });
      return { checkable: true, exists: true, blocked: blocked, sitemaps: sitemaps };
    }).catch(function () { return { checkable: true, exists: false }; });
  }

  function sitemapInfo() {
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve({ checkable: false });
    return fetchText(location.origin + '/sitemap.xml').then(function (txt) {
      var bare = location.href.split('#')[0].split('?')[0];
      var contains = txt.indexOf(bare) !== -1 || txt.indexOf(location.pathname) !== -1;
      return { checkable: true, exists: true, containsPage: contains, isIndex: /<sitemapindex/i.test(txt) };
    }).catch(function () { return { checkable: true, exists: false }; });
  }

  // ---- Performance (Core Web Vitals + page weight) ----
  function perfInfo() {
    var out = {
      ttfb: null, domContentLoaded: null, pageLoad: null,
      requests: 0, bytes: 0, topResources: [], lcp: null, cls: null, longTasks: 0, measurable: false
    };
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        out.measurable = true;
        out.ttfb = Math.round(nav.responseStart);
        out.domContentLoaded = Math.round(nav.domContentLoadedEventEnd);
        out.pageLoad = Math.round(nav.loadEventEnd || nav.duration);
      }
      var res = performance.getEntriesByType('resource') || [];
      out.requests = res.length;
      var bytes = 0;
      res.forEach(function (r) { bytes += (r.transferSize || 0); });
      out.bytes = bytes;
      out.topResources = res.filter(function (r) { return (r.transferSize || 0) > 0; })
        .sort(function (a, b) { return (b.transferSize || 0) - (a.transferSize || 0); })
        .slice(0, 5)
        .map(function (r) {
          var name = String(r.name || '').split('?')[0];
          if (name.length > 64) name = name.slice(0, 61) + '…';
          return { name: name, kb: Math.round((r.transferSize || 0) / 1024) };
        });
      if (res.length) out.measurable = true;
      var lcpEntries = performance.getEntriesByType('largest-contentful-paint') || [];
      if (lcpEntries.length) out.lcp = Math.round(lcpEntries[lcpEntries.length - 1].startTime);
      var cls = 0, hasLs = false;
      (performance.getEntriesByType('layout-shift') || []).forEach(function (e) {
        hasLs = true;
        if (!e.hadRecentInput) cls += (e.value || 0);
      });
      if (hasLs) out.cls = Math.round(cls * 1000) / 1000;
      out.longTasks = (performance.getEntriesByType('longtask') || []).length;
    } catch (e) { /* performance API unavailable */ }
    return out;
  }

  // ---- Broken link checker ----
  // Same-origin links get a real status check (HEAD, GET fallback).
  // Cross-origin links get a reachability check only (CORS hides status codes).
  function checkLinks() {
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve({ checkable: false });
    var seen = {}, targets = [];
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
      var href = a.getAttribute('href');
      if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
      var abs;
      try { abs = new URL(href, location.href).href.split('#')[0]; } catch (e) { return; }
      if (!/^https?:/i.test(abs) || seen[abs]) return;
      seen[abs] = true;
      targets.push(abs);
    });
    var MAX = 20, TIMEOUT = 6000, CONCURRENCY = 6, OVERALL_CAP = 25000;
    var list = targets.slice(0, MAX);

    function timed(url, opts) {
      var done = false;
      function finish(r) { if (!done) { done = true; return r; } return null; }
      var attempt = fetch(url, opts).then(function (r) {
        if (r.status === 405 && opts.method === 'HEAD') {
          var o2 = {}; for (var k in opts) o2[k] = opts[k]; o2.method = 'GET';
          return fetch(url, o2).then(function (r2) { return finish({ url: url, status: r2.status, ok: r2.status < 400 }); });
        }
        return finish({ url: url, status: r.status, ok: r.status < 400 });
      }).catch(function () { return finish({ url: url, status: 0, ok: false, error: true }); });
      var timer = new Promise(function (resolve) {
        setTimeout(function () { var r = finish({ url: url, status: 0, ok: false, timeout: true }); if (r) resolve(r); }, TIMEOUT);
      });
      return Promise.race([attempt, timer]).then(function (r) { return r; });
    }

    var i = 0, results = [];
    function worker() {
      if (i >= list.length) return Promise.resolve();
      var url = list[i++];
      var sameOrigin = url.indexOf(location.origin) === 0;
      var p = sameOrigin
        ? timed(url, { method: 'HEAD', credentials: 'same-origin', redirect: 'follow' })
        : timed(url, { method: 'HEAD', mode: 'no-cors', redirect: 'follow' })
            .then(function (r) { if (r) r.reachabilityOnly = true; return r; });
      return p.then(function (r) { if (r) results.push(r); return worker(); });
    }
    var workers = [];
    for (var w = 0; w < CONCURRENCY; w++) workers.push(worker());
    var overall = Promise.all(workers).then(function () { return results; });
    var cap = new Promise(function (resolve) { setTimeout(function () { resolve(results); }, OVERALL_CAP); });
    return Promise.race([overall, cap]).then(function (res) {
      return {
        checkable: true,
        checked: res.length,
        total: targets.length,
        truncated: targets.length > MAX,
        broken: res.filter(function (r) { return !r.ok && !r.reachabilityOnly; }),
        unreachable: res.filter(function (r) { return !r.ok && r.reachabilityOnly; })
      };
    });
  }

  function scrapeSync() {
    var checks = [];
    function add(id, label, status, detail) {
      checks.push({ id: id, label: label, status: status, detail: detail });
    }

    // ---- Title ----
    var title = document.title.trim();
    if (!title) add('title', 'Page title', 'fail', 'Missing <title>.');
    else if (title.length < 30) add('title', 'Page title', 'warn', 'Only ' + title.length + ' characters — aim for 30–60.');
    else if (title.length > 60) add('title', 'Page title', 'warn', title.length + ' characters — may get truncated in search results. Aim for 30–60.');
    else add('title', 'Page title', 'pass', title.length + ' characters. Looks good.');

    // ---- Meta description ----
    var desc = metaContent('description');
    if (!desc) add('meta-description', 'Meta description', 'fail', 'Missing meta description.');
    else if (desc.length < 120) add('meta-description', 'Meta description', 'warn', 'Only ' + desc.length + ' characters — aim for 120–160.');
    else if (desc.length > 160) add('meta-description', 'Meta description', 'warn', desc.length + ' characters — may get truncated. Aim for 120–160.');
    else add('meta-description', 'Meta description', 'pass', desc.length + ' characters. Looks good.');

    // ---- Canonical / robots / viewport / lang ----
    var canonicalEl = document.querySelector('link[rel="canonical"]');
    var canonical = canonicalEl ? (canonicalEl.getAttribute('href') || '') : '';
    if (!canonical) {
      add('canonical', 'Canonical URL', 'warn', 'No canonical link — search engines choose the URL themselves.');
    } else {
      var absCanon = '';
      try { absCanon = new URL(canonical, location.href).href.split('#')[0].replace(/\/$/, ''); } catch (e) {}
      var selfUrl = location.href.split('#')[0].replace(/\/$/, '');
      if (!absCanon) add('canonical', 'Canonical URL', 'warn', 'Canonical href is not a valid URL.');
      else if (!/^https?:\/\//i.test(canonical) && canonical.indexOf('//') !== 0)
        add('canonical', 'Canonical URL', 'warn', 'Canonical is relative ("' + canonical.slice(0, 60) + '") — use an absolute URL.');
      else if (absCanon !== selfUrl)
        add('canonical', 'Canonical URL', 'warn', 'Canonical points to a different URL — this page may not earn its own ranking signal.');
      else add('canonical', 'Canonical URL', 'pass', 'Self-referencing canonical. Good.');
    }

    var robots = metaContent('robots');
    if (/noindex/i.test(robots))
      add('robots', 'Robots meta', 'fail', 'content="noindex" — this page is excluded from search results.');
    else add('robots', 'Robots meta', 'pass', robots ? robots : 'Not set (defaults to index, follow).');

    var viewport = metaContent('viewport');
    add('viewport', 'Viewport meta', viewport ? 'pass' : 'fail',
      viewport ? 'Present — mobile-friendly signal.' : 'Missing viewport meta — hurts mobile experience.');

    var lang = document.documentElement.getAttribute('lang') || '';
    add('lang', 'HTML language', lang ? 'pass' : 'warn',
      lang ? 'lang="' + lang + '"' : 'Missing lang attribute on <html>.');

    // ---- HTTPS + mixed content ----
    var proto = location.protocol;
    var isHttps = proto === 'https:';
    if (isHttps) add('https', 'HTTPS', 'pass', 'Page served over HTTPS.');
    else if (proto === 'http:') add('https', 'HTTPS', 'fail', 'Page served over plain HTTP — browsers flag this as "not secure".');
    else add('https', 'HTTPS', 'warn', 'Not served over HTTP(S) — check skipped.');

    var mixed = [];
    if (isHttps) {
      var resEls = document.querySelectorAll('img[src], script[src], link[href], iframe[src], video[src], audio[src], source[src], embed[src], img[srcset], source[srcset]');
      Array.prototype.forEach.call(resEls, function (el) {
        var s = el.getAttribute('src') || el.getAttribute('href') || '';
        if (/^http:/i.test(s)) mixed.push(s.slice(0, 120));
        // srcset="http://… 1x, http://… 2x" — check each candidate URL too
        var ss = el.getAttribute('srcset') || '';
        ss.split(',').forEach(function (part) {
          var u = (part.trim().split(/\s+/)[0] || '');
          if (/^http:/i.test(u)) mixed.push(u.slice(0, 120));
        });
      });
    }
    if (!isHttps) add('mixed', 'Mixed content', 'pass', 'Only relevant on HTTPS pages.');
    else if (mixed.length) add('mixed', 'Mixed content', 'fail', mixed.length + ' insecure (http://) resource(s) on an HTTPS page.');
    else add('mixed', 'Mixed content', 'pass', 'No insecure resources detected.');

    // ---- Headings ----
    var headingEls = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    var headings = headingEls.map(function (el) {
      return { level: parseInt(el.tagName.charAt(1), 10), text: clean(el).slice(0, 120) };
    });
    var h1Count = headings.filter(function (h) { return h.level === 1; }).length;
    if (h1Count === 0) add('h1', 'Single H1', 'fail', 'No H1 found.');
    else if (h1Count > 1) add('h1', 'Single H1', 'warn', h1Count + ' H1 tags — ideally one per page.');
    else add('h1', 'Single H1', 'pass', 'Exactly one H1.');
    var h1Text = headings.filter(function (h) { return h.level === 1; }).map(function (h) { return h.text; }).join(' ');

    var skipped = false;
    for (var i = 1; i < headings.length; i++) {
      if (headings[i].level - headings[i - 1].level > 1) { skipped = true; break; }
    }
    if (headings.length === 0) add('heading-order', 'Heading order', 'warn', 'No headings found.');
    else if (skipped) add('heading-order', 'Heading order', 'warn', 'Skipped heading levels detected (e.g. H2 → H4).');
    else add('heading-order', 'Heading order', 'pass', 'Heading levels flow cleanly.');

    // ---- Images ----
    var imgs = Array.prototype.slice.call(document.querySelectorAll('img'));
    var missingAlt = [];
    var oversized = [];
    var missingDims = 0;
    var lazyCount = 0;
    imgs.forEach(function (img) {
      var alt = (img.getAttribute('alt') || '').trim();
      if (!alt) missingAlt.push((img.getAttribute('src') || '(no src)').slice(0, 120));
      var nw = img.naturalWidth || 0, dw = img.clientWidth || 0;
      if (nw > 0 && dw > 0 && nw > dw * 1.5) {
        oversized.push({ src: (img.getAttribute('src') || '(no src)').slice(0, 80), natural: nw + 'px', displayed: dw + 'px' });
      }
      if (!img.getAttribute('width') || !img.getAttribute('height')) missingDims++;
      if ((img.getAttribute('loading') || '').toLowerCase() === 'lazy') lazyCount++;
    });
    if (imgs.length === 0) add('img-alt', 'Image alt text', 'pass', 'No images on page.');
    else if (missingAlt.length === 0) add('img-alt', 'Image alt text', 'pass', 'All ' + imgs.length + ' images have alt text.');
    else add('img-alt', 'Image alt text', 'warn', missingAlt.length + ' of ' + imgs.length + ' images missing alt text.');
    if (imgs.length && oversized.length) add('img-size', 'Image sizing', 'warn',
      oversized.length + ' image(s) served much larger than displayed — wastes bandwidth.');
    else if (imgs.length) add('img-size', 'Image sizing', 'pass', 'No oversized images detected.');

    // ---- Links ----
    var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
    var host = location.hostname;
    var internal = 0, external = 0, nofollow = 0;
    anchors.forEach(function (a) {
      var rel = (a.getAttribute('rel') || '').toLowerCase();
      if (rel.indexOf('nofollow') !== -1) nofollow++;
      var href = a.getAttribute('href') || '';
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return; // not crawlable links
      try {
        var u = new URL(href, location.href);
        if (!/^https?:$/.test(u.protocol)) return;
        if (u.hostname === host) internal++; else external++;
      } catch (e) { /* invalid URL, ignore */ }
    });

    // ---- Social tags ----
    var ogTags = ['og:title', 'og:description', 'og:image'];
    var og = {};
    ogTags.forEach(function (t) { og[t] = metaContent(t); });
    var ogMissing = ogTags.filter(function (t) { return !og[t]; });
    if (ogMissing.length === 0) {
      if (!/^https?:\/\//i.test(og['og:image']))
        add('og', 'Open Graph tags', 'warn', 'All present, but og:image is not an absolute URL — link previews may break.');
      else add('og', 'Open Graph tags', 'pass', 'og:title, og:description, og:image all present.');
    }
    else add('og', 'Open Graph tags', 'warn', 'Missing: ' + ogMissing.join(', '));

    var twCard = metaContent('twitter:card');
    add('twitter', 'Twitter card', twCard ? 'pass' : 'warn',
      twCard ? 'twitter:card = ' + twCard : 'No twitter:card tag.');

    // ---- Structured data ----
    var ldBlocks = Array.prototype.slice.call(document.querySelectorAll('script[type="application/ld+json"]'));
    var types = {};
    ldBlocks.forEach(function (el) {
      try {
        var data = JSON.parse(el.textContent);
        var items = Array.isArray(data) ? data : [data];
        items.forEach(function (item) {
          if (item && item['@type']) {
            var t = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
            t.forEach(function (x) { types[x] = true; });
          }
        });
      } catch (e) { /* invalid JSON-LD, ignore */ }
    });
    var typeList = Object.keys(types);
    if (ldBlocks.length > 0) add('schema', 'Structured data', 'pass',
      ldBlocks.length + ' JSON-LD block(s): ' + (typeList.join(', ') || 'unknown types'));
    else add('schema', 'Structured data', 'warn', 'No JSON-LD structured data found.');

    // ---- Words + keywords (visible text only — no code, no hidden nodes) ----
    var bodyText = visibleText();
    var wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
    add('wordcount', 'Content length', wordCount >= 300 ? 'pass' : 'warn',
      wordCount + ' words' + (wordCount < 300 ? ' — thin content may underperform.' : '.'));

    var tokens = tokenize(bodyText);
    var keywords = topKeywords(tokens, wordCount, 10);
    var phrases = topPhrases(tokens, wordCount, 10);

    var top = keywords[0] || null;
    var placements = [];
    if (top) {
      var intro = bodyText.split(/\s+/).slice(0, 100).join(' ').toLowerCase();
      keywords.slice(0, 3).forEach(function (k) {
        if (k.count < 2) return; // single mentions are noise, not keywords
        var kw = k.word;
        var placed = {
          keyword: kw,
          inTitle: title.toLowerCase().indexOf(kw) !== -1,
          inH1: h1Text.toLowerCase().indexOf(kw) !== -1,
          inUrl: location.href.toLowerCase().indexOf(kw) !== -1,
          inIntro: intro.indexOf(kw) !== -1
        };
        placed.score = [placed.inTitle, placed.inH1, placed.inUrl, placed.inIntro].filter(Boolean).length;
        placements.push(placed);
      });
      var p0 = placements[0];
      if (p0) {
        add('keyword-placement', 'Keyword placement ("' + p0.keyword + '")',
          p0.score >= 3 ? 'pass' : 'warn',
          'Found in ' + p0.score + ' of 4 key spots: title, H1, URL, intro.');
      }
    }

    // ---- Performance checks ----
    var perf = perfInfo();
    if (!perf.measurable) {
      add('perf', 'Performance data', 'warn', 'Could not measure timing on this page.');
    } else {
      var mb = perf.bytes / 1048576;
      if (perf.bytes === 0) add('page-weight', 'Page weight', 'warn', 'Transfer size not measurable (cross-origin resources hide it).');
      else if (mb < 1) add('page-weight', 'Page weight', 'pass', mb.toFixed(2) + ' MB transferred.');
      else if (mb < 3) add('page-weight', 'Page weight', 'warn', mb.toFixed(2) + ' MB transferred — aim for under 1 MB.');
      else add('page-weight', 'Page weight', 'fail', mb.toFixed(2) + ' MB transferred — heavy pages rank and convert worse.');

      if (perf.requests === 0) add('requests', 'Request count', 'warn', 'Could not count requests.');
      else if (perf.requests < 50) add('requests', 'Request count', 'pass', perf.requests + ' requests.');
      else if (perf.requests <= 100) add('requests', 'Request count', 'warn', perf.requests + ' requests — consider bundling.');
      else add('requests', 'Request count', 'fail', perf.requests + ' requests — very chatty page.');

      if (perf.lcp == null) add('lcp', 'Largest Contentful Paint', 'warn', 'Not measurable yet (try scrolling / waiting for load).');
      else if (perf.lcp < 2500) add('lcp', 'Largest Contentful Paint', 'pass', (perf.lcp / 1000).toFixed(2) + 's — good.');
      else if (perf.lcp < 4000) add('lcp', 'Largest Contentful Paint', 'warn', (perf.lcp / 1000).toFixed(2) + 's — needs improvement (target < 2.5s).');
      else add('lcp', 'Largest Contentful Paint', 'fail', (perf.lcp / 1000).toFixed(2) + 's — poor (target < 2.5s).');

      if (perf.cls == null) add('cls', 'Cumulative Layout Shift', 'warn', 'No layout shifts recorded yet.');
      else if (perf.cls < 0.1) add('cls', 'Cumulative Layout Shift', 'pass', perf.cls + ' — good.');
      else if (perf.cls < 0.25) add('cls', 'Cumulative Layout Shift', 'warn', perf.cls + ' — needs improvement (target < 0.1).');
      else add('cls', 'Cumulative Layout Shift', 'fail', perf.cls + ' — poor (target < 0.1).');

      if (perf.ttfb != null) add('ttfb', 'Time to First Byte', perf.ttfb < 800 ? 'pass' : 'warn',
        (perf.ttfb / 1000).toFixed(2) + 's' + (perf.ttfb < 800 ? ' — good.' : ' — slow server response.'));
    }

    // ---- SERP preview data ----
    var displayUrl = host + location.pathname;
    if (displayUrl.length > 48) displayUrl = displayUrl.slice(0, 45) + '…';

    return {
      url: location.href,
      host: host,
      title: title,
      url: location.href,
      lastModified: document.lastModified || null, // browser-reported; dynamic pages often report load time
      meta: {
        description: desc, descriptionLength: desc.length,
        robots: robots || null, canonical: canonical || null,
        viewport: viewport || null, lang: lang || null,
        charset: document.characterSet || ''
      },
      og: og, ogMissing: ogMissing, twitterCard: twCard || null,
      headings: headings, h1Count: h1Count, h1Text: h1Text,
      images: {
        total: imgs.length,
        missingAltCount: missingAlt.length, missingAlt: missingAlt.slice(0, 50),
        oversized: oversized.slice(0, 20), oversizedCount: oversized.length,
        missingDims: missingDims, lazyCount: lazyCount
      },
      links: { total: anchors.length, internal: internal, external: external, nofollow: nofollow },
      jsonld: { blocks: ldBlocks.length, types: typeList },
      wordCount: wordCount, bodyText: bodyText,
      keywords: keywords, phrases: phrases, keywordPlacements: placements,
      serp: {
        title: title, titleLen: title.length, titleTruncated: title.length > 60,
        displayUrl: displayUrl,
        description: desc, descLen: desc.length, descTruncated: desc.length > 160
      },
      security: { https: isHttps, protocol: proto, mixedContent: mixed.slice(0, 20), mixedCount: mixed.length },
      performance: perf,
      checks: checks
    };
  }

  // ---- Smart suggestions (rule-based) ----
  function buildSuggestions(d) {
    var out = [];
    function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

    if (d.meta.robots && /noindex/i.test(d.meta.robots)) {
      out.push({
        title: 'Remove noindex — this page is invisible to Google',
        why: 'The robots meta tag tells search engines to exclude this page from results. Only keep noindex on pages you truly want hidden (admin, thank-you pages).',
        snippet: '<meta name="robots" content="index, follow">'
      });
    }
    if (!d.title && d.h1Text) {
      out.push({
        title: 'Add a missing page title',
        why: 'Search engines invent their own title when none exists — usually a bad one.',
        snippet: '<title>' + truncate(d.h1Text + ' | ' + d.host, 60) + '</title>'
      });
    } else if (d.title.length > 60) {
      out.push({
        title: 'Shorten the title tag',
        why: 'Long titles get cut off in search results, hiding your message.',
        snippet: '<title>' + truncate(d.title, 60) + '</title>'
      });
    }
    if (!d.meta.description) {
      // Only visible paragraphs — hidden modal/drawer copy must not become the snippet.
      var paras = Array.prototype.slice.call(document.querySelectorAll('p'))
        .filter(function (p) { return p.getClientRects().length > 0; })
        .map(clean).filter(function (p) { return p.length > 80; })
        .sort(function (a, b) { return b.length - a.length; });
      if (paras[0]) {
        out.push({
          title: 'Add a meta description',
          why: 'This snippet is what searchers read before clicking.',
          snippet: '<meta name="description" content="' + truncate(paras[0], 155).replace(/"/g, '&quot;') + '">'
        });
      }
    }
    var ps = d.keywordPlacements || [];
    ps.forEach(function (p) {
      if (!p.inTitle && d.title) {
        out.push({
          title: 'Work "' + p.keyword + '" into the title',
          why: 'Your top keyword "' + p.keyword + '" appears nowhere in the title.',
          snippet: '<title>' + truncate(cap(p.keyword) + ' — ' + d.title, 60) + '</title>'
        });
      }
    });
    if (d.ogMissing && d.ogMissing.length) {
      out.push({
        title: 'Complete your Open Graph tags',
        why: 'Missing tags mean ugly link previews when shared on social.',
        snippet: d.ogMissing.map(function (t) {
          var val = t === 'og:title' ? d.title : (t === 'og:description' ? truncate(d.meta.description, 155) : d.url);
          return '<meta property="' + t + '" content="' + String(val || '').replace(/"/g, '&quot;') + '">';
        }).join('\n')
      });
    }
    if (d.images.oversizedCount > 0) {
      var imgLines = d.images.oversized.slice(0, 8).map(function (o) {
        var nw = parseInt(o.natural, 10) || 0, dw = parseInt(o.displayed, 10) || 0;
        var waste = (nw > dw && dw > 0) ? Math.round((1 - (dw / nw) * (dw / nw)) * 100) : 0;
        return o.src + '\n  served ' + o.natural + ' wide but displayed ' + o.displayed + ' wide' +
          (waste ? ' (~' + waste + '% of pixels wasted)' : '');
      });
      imgLines.push('Resize to displayed dimensions, or serve responsive versions with srcset.');
      out.push({
        title: 'Resize ' + d.images.oversizedCount + ' oversized image(s)',
        why: 'Serving images larger than displayed wastes bandwidth and slows the page.',
        snippet: imgLines.join('\n')
      });
    }
    if (d.performance.measurable && d.performance.bytes > 3 * 1048576) {
      var weightLines = ['Page transferred ' + (d.performance.bytes / 1048576).toFixed(2) +
        ' MB across ' + d.performance.requests + ' requests.'];
      if (d.performance.topResources && d.performance.topResources.length) {
        weightLines.push('Heaviest resources:');
        d.performance.topResources.forEach(function (r) {
          weightLines.push('- ' + r.name + ' (' + r.kb + ' KB)');
        });
      }
      weightLines.push('Compress images (WebP/AVIF), defer non-critical JS, lazy-load below-fold media.');
      out.push({
        title: 'Slim the page down (' + (d.performance.bytes / 1048576).toFixed(1) + ' MB)',
        why: 'Heavy pages hurt rankings and conversions.',
        snippet: weightLines.join('\n')
      });
    }
    var bl = d.brokenLinks;
    if (bl && bl.checkable && bl.broken.length) {
      out.push({
        title: 'Fix ' + bl.broken.length + ' broken link(s)',
        why: 'Dead links hurt user trust and crawl efficiency.',
        snippet: bl.broken.slice(0, 8).map(function (b) { return b.url + ' (HTTP ' + b.status + ')'; }).join('\n')
      });
    }
    return out;
  }

  // ---- Async wrapper ----
  function scrapeAsync() {
    var data = scrapeSync();
    return Promise.all([robotsInfo(), sitemapInfo(), checkLinks()]).then(function (res) {
      var robots = res[0], sitemap = res[1], links = res[2];
      data.crawl = { robots: robots, sitemap: sitemap };
      data.brokenLinks = links;

      if (!robots.checkable) data.checks.push({ id: 'robots-txt', label: 'robots.txt', status: 'warn', detail: 'Could not check — non-HTTP page.' });
      else if (!robots.exists) data.checks.push({ id: 'robots-txt', label: 'robots.txt', status: 'pass', detail: 'No robots.txt found (not required — defaults apply).' });
      else if (robots.blocked) data.checks.push({ id: 'robots-txt', label: 'robots.txt', status: 'fail', detail: 'This page is DISALLOWED by robots.txt — search engines will not crawl it!' });
      else data.checks.push({ id: 'robots-txt', label: 'robots.txt', status: 'pass', detail: 'Page is allowed by robots.txt.' + (robots.sitemaps.length ? ' Sitemap directive found.' : '') });

      if (!sitemap.checkable) data.checks.push({ id: 'sitemap', label: 'sitemap.xml', status: 'warn', detail: 'Could not check — non-HTTP page.' });
      else if (!sitemap.exists) data.checks.push({ id: 'sitemap', label: 'sitemap.xml', status: 'warn', detail: 'No sitemap.xml found at the site root.' });
      else if (sitemap.containsPage) data.checks.push({ id: 'sitemap', label: 'sitemap.xml', status: 'pass', detail: 'This page is listed in sitemap.xml.' + (sitemap.isIndex ? ' (sitemap index)' : '') });
      else data.checks.push({ id: 'sitemap', label: 'sitemap.xml', status: 'warn', detail: 'sitemap.xml exists but does not list this page.' });

      if (!links.checkable) data.checks.push({ id: 'broken-links', label: 'Broken links', status: 'warn', detail: 'Could not check — non-HTTP page.' });
      else if (links.broken.length) data.checks.push({ id: 'broken-links', label: 'Broken links', status: 'fail', detail: links.broken.length + ' broken link(s) found (checked ' + links.checked + ').' });
      else if (links.unreachable.length) data.checks.push({ id: 'broken-links', label: 'Broken links', status: 'warn', detail: links.unreachable.length + ' external link(s) unreachable (checked ' + links.checked + ').' });
      else if (links.checked === 0) data.checks.push({ id: 'broken-links', label: 'Broken links', status: 'pass', detail: 'No links to check on this page.' });
      else data.checks.push({ id: 'broken-links', label: 'Broken links', status: 'pass', detail: 'All ' + links.checked + ' checked links resolve.' + (links.truncated ? ' (first 20 of ' + links.total + ')' : '') });

      data.suggestions = buildSuggestions(data);

      // Score only the stable, DOM-derived checks. Volatile measurement-based
      // checks (timings, live link/crawl fetches) are reported but excluded so
      // the score doesn't wobble between reloads.
      var UNSCORED = {
        'perf': 1, 'page-weight': 1, 'requests': 1, 'lcp': 1, 'cls': 1, 'ttfb': 1,
        'robots-txt': 1, 'sitemap': 1, 'broken-links': 1
      };
      var score = 100;
      data.checks.forEach(function (c) {
        if (UNSCORED[c.id]) return;
        if (c.status === 'fail') score -= 12;
        else if (c.status === 'warn') score -= 5;
      });
      data.score = Math.max(0, score);
      delete data.bodyText; // no need to ship the full text to the popup
      return data;
    });
  }

  window.__seoLensScrape = scrapeAsync;
})();
