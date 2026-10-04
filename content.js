// Runs in the extension's isolated world. Reinjection must not duplicate listeners.
(() => {
    const VERSION = 3;
    if (globalThis.__eventScraperContentVersion === VERSION) return;
    globalThis.__eventScraperContentVersion = VERSION;

    const LIMITS = { text: 26000, bulkText: 48000, scanText: 120000, nodes: 30000, json: 400000 };
    const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME', 'TEMPLATE', 'NAV', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
    const BLOCK_TAGS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'HEADER', 'HR', 'LI', 'MAIN', 'OL', 'P', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL']);
    const NOISE = /(?:^|[\s_-])(?:cookie\w*|consent\w*|sidebar|rightbox|vertical-column|related(?:-events|-posts)?|recommended|recommendations|comments?|breadcrumb\w*|social-share|share-buttons|site-footer|site-navigation|newsletter)(?:$|[\s_-])/i;
    let lastRightClickedElement = null;

    document.addEventListener('contextmenu', event => { lastRightClickedElement = event.target; }, true);

    function absoluteUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        const raw = value.trim().replace(/^url\(\s*['"]?/, '').replace(/['"]?\s*\)$/, '').replace(/&amp;/g, '&').replace(/WIDTH/g, '1200');
        if (!raw || raw === 'none') return null;
        try {
            const url = new URL(raw, document.baseURI || location.href);
            return /^https?:$/.test(url.protocol) ? url.href : null;
        } catch { return null; }
    }

    function compact(value, max = 1000) {
        return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    }

    function meta(selector) {
        return compact(document.querySelector(selector)?.getAttribute('content'), 3000);
    }

    function isNoise(element, mode = 'single') {
        if (IGNORED_TAGS.has(element.tagName)) return true;
        if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
        if (element.style?.display === 'none' || element.style?.visibility === 'hidden') return true;
        const role = element.getAttribute('role');
        if (role === 'navigation' || role === 'contentinfo') return true;
        if (element.tagName === 'FOOTER' && !element.closest('article')) return true;
        // Event dates and venues are often in an aside; retain those details.
        const identity = `${element.id || ''} ${element.getAttribute('class') || ''}`;
        if (element.tagName !== 'ASIDE' && !NOISE.test(identity)) return false;
        const eventDetails = element.matches('[itemprop="location"], [itemprop="startDate"], [itemprop="endDate"], [itemprop="address"], .event-info, .event-details, .event-meta, .event-sidebar') ||
            Boolean(element.querySelector('[itemprop="startDate"], [itemprop="location"], time[datetime], address'));
        if (eventDetails && !/(?:related|recommended|cookie|consent)/i.test(identity)) return false;
        if (element.tagName === 'ASIDE') return true;
        if (mode === 'bulk' && /(?:^|[\s_-])(?:related|recommended)/i.test(identity)) return false;
        return NOISE.test(identity);
    }

    function contentRoot() {
        const main = Array.from(document.querySelectorAll('main, [role="main"], #main-content, #main, #content'))
            .find(element => !isNoise(element) && compact(element.textContent, 150).length > 40);
        if (main) return main;
        const articles = Array.from(document.querySelectorAll('article')).filter(element => !isNoise(element));
        // Never take the first article from a page with several event cards.
        if (articles.length === 1 && articles[0].querySelector('h1') && compact(articles[0].textContent, 400).length > 200) return articles[0];
        return document.body || document.documentElement;
    }

    function readText(root, mode) {
        const chunks = [];
        let length = 0;
        let visited = 0;
        const stack = [{ node: root, end: false }];
        const append = value => { if (value) { chunks.push(value); length += value.length; } };
        while (stack.length && length < LIMITS.scanText && visited++ < LIMITS.nodes) {
            const { node, end } = stack.pop();
            if (end) { append('\n'); continue; }
            if (node.nodeType === 3) { append(node.nodeValue.replace(/\s+/g, ' ').slice(0, LIMITS.scanText - length)); continue; }
            if (node.nodeType !== 1 || isNoise(node, mode)) continue;
            if (BLOCK_TAGS.has(node.tagName)) { append('\n'); stack.push({ node, end: true }); }
            if (node.tagName === 'TIME' && node.getAttribute('datetime')) append(` ${node.getAttribute('datetime')} `);
            if (node.tagName === 'META' && /^(startDate|endDate|location|address|streetAddress|addressLocality)$/i.test(node.getAttribute('itemprop') || '')) append(` ${node.getAttribute('itemprop')}: ${node.getAttribute('content') || ''} `);
            for (let index = node.childNodes.length - 1; index >= 0; index--) stack.push({ node: node.childNodes[index], end: false });
        }
        const lines = chunks.join('').split('\n').map(line => compact(line, 12000)).filter(Boolean);
        const maximum = mode === 'bulk' ? LIMITS.bulkText : LIMITS.text;
        const allText = lines.join('\n');
        if (allText.length <= maximum) return allText;
        // Reserve space for date/address information after a long description.
        const headLimit = Math.floor(maximum * 0.75);
        let offset = 0;
        const selected = new Set();
        for (let i = 0; i < lines.length && offset < headLimit; i++) { selected.add(i); offset += lines[i].length + 1; }
        const relevant = /(?:\b\d{1,2}[.:/]\s*\d{1,2}|\b20\d{2}-\d{2}-\d{2}|\b(?:miesto|adresa|vstup|kedy|kde|venue|location|address|date)\b|začiat|koniec|konan|ulica|námest|štart)/i;
        for (let i = 0; i < lines.length; i++) {
            if (selected.has(i) || !relevant.test(lines[i])) continue;
            const nearby = [i - 1, i, i + 1].filter(index => index >= 0 && index < lines.length && !selected.has(index));
            const extra = nearby.reduce((sum, index) => sum + lines[index].length + 1, 0);
            if (offset + extra > maximum) continue;
            nearby.forEach(index => selected.add(index));
            offset += extra;
        }
        return [...selected].sort((a, b) => a - b).map(index => lines[index]).join('\n').slice(0, maximum);
    }

    function readStructuredData() {
        const roots = [];
        let bytes = 0;
        for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, 40)) {
            const raw = (script.textContent || '').trim().replace(/^\uFEFF/, '').replace(/^<!--/, '').replace(/-->$/, '').trim();
            if (!raw || raw.length > LIMITS.json || bytes + raw.length > LIMITS.json) continue;
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') { roots.push(parsed); bytes += raw.length; }
            } catch { /* One malformed block must not discard other valid blocks. */ }
        }
        return roots;
    }

    function readMicrodata() {
        let propertiesRead = 0;
        function readScope(scope, depth = 0) {
            if (depth > 5 || propertiesRead > 1000) return {};
            const result = { '@type': (scope.getAttribute('itemtype') || '').split(/\s+/).map(type => type.split('/').pop()).filter(Boolean) };
            if (scope.getAttribute('itemid')) result['@id'] = scope.getAttribute('itemid');
            const elements = Array.from(scope.querySelectorAll('[itemprop]')).slice(0, 500);
            for (const property of elements) {
                if (propertiesRead++ > 1000 || property.parentElement?.closest('[itemscope]') !== scope) continue;
                const names = (property.getAttribute('itemprop') || '').split(/\s+/).filter(name => /^[a-zA-Z][\w-]{0,60}$/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name));
                const value = property.hasAttribute('itemscope') ? readScope(property, depth + 1) :
                    property.getAttribute('content') || property.getAttribute('datetime') || property.getAttribute('href') || property.getAttribute('src') || compact(property.textContent, 5000);
                for (const name of names) {
                    if (Object.prototype.hasOwnProperty.call(result, name)) result[name] = [].concat(result[name], value);
                    else result[name] = value;
                }
            }
            return result;
        }
        return Array.from(document.querySelectorAll('[itemscope][itemtype]')).filter(element =>
            (element.getAttribute('itemtype') || '').split(/\s+/).some(type => /(?:\/|^)\w*Event$/.test(type))
        ).slice(0, 30).map(element => readScope(element));
    }

    function imageSource(element) {
        // Lazyload attributes are preferred to transparent placeholders in src.
        const srcset = element.getAttribute('data-srcset') || element.getAttribute('srcset') || '';
        const variants = srcset.split(',').map(part => {
            const [url, size = '1'] = part.trim().split(/\s+/);
            return { url, size: parseFloat(size) || 1 };
        }).filter(item => absoluteUrl(item.url)).sort((a, b) => b.size - a.size);
        const lazy = absoluteUrl(element.getAttribute('data-original') || element.getAttribute('data-lazy-src') || element.getAttribute('data-src'));
        return (element.hasAttribute('data-srcset') && absoluteUrl(variants[0]?.url)) || lazy ||
            absoluteUrl(variants[0]?.url) || absoluteUrl(element.currentSrc) || absoluteUrl(element.getAttribute('src'));
    }

    function rankImages(root, structuredData, microdataEvents, heading) {
        const candidates = new Map();
        const add = (raw, alt, score, element = null) => {
            const url = absoluteUrl(raw);
            if (!url) return;
            const label = compact(alt, 300);
            if (/(?:^|[\/_.\s-])(?:logo|icon|avatar|favicon|placeholder|spacer|tracking|pixel)(?:[\/_.\s-]|$)/i.test(`${url} ${label}`)) score -= 140;
            if (element) {
                const isLoadedSource = url === absoluteUrl(element.currentSrc || element.getAttribute('src'));
                const width = (isLoadedSource && element.naturalWidth) || Number(element.getAttribute('width'));
                const height = (isLoadedSource && element.naturalHeight) || Number(element.getAttribute('height'));
                if ((width && width < 120) || (height && height < 100)) score -= 100;
                if (width >= 400 && height >= 300) score += 10;
                if (width > 0 && height / width > 1.1 && height / width < 2.5) score += 8;
            }
            if (score <= 0) return;
            if (!candidates.has(url) || candidates.get(url).score < score) candidates.set(url, { url, alt: label, score });
        };
        const headingWords = compact(heading).toLocaleLowerCase().split(/\s+/).filter(word => word.length > 3);
        let count = 0;
        const stack = [...structuredData, ...microdataEvents].map(value => ({ value, depth: 0 }));
        while (stack.length && count++ < 2500) {
            const { value, depth } = stack.pop();
            if (!value || typeof value !== 'object' || depth > 12) continue;
            const types = [].concat(value['@type'] || []);
            if (types.some(type => typeof type === 'string' && /(?:^|\/)\w*Event$/.test(type))) {
                const name = compact(value.name).toLocaleLowerCase();
                const matchesHeading = headingWords.length > 0 && headingWords.filter(word => name.includes(word)).length / headingWords.length >= 0.6;
                const matchesUrl = absoluteUrl(value.url) === absoluteUrl(location.href);
                for (const source of [].concat(value.image || [])) add(typeof source === 'string' ? source : source?.contentUrl || source?.url, value.name, matchesHeading || matchesUrl ? 115 : 45);
            }
            for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
        }
        document.querySelectorAll('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"], meta[property="twitter:image"]').forEach(element => add(element.getAttribute('content'), '', 95));
        for (const element of Array.from(document.querySelectorAll('img')).slice(0, 400)) {
            if (element.closest('nav, footer, [role="navigation"], [role="contentinfo"]')) continue;
            let ancestor = element;
            let noise = false;
            for (let level = 0; ancestor && level < 8; level++, ancestor = ancestor.parentElement) if (isNoise(ancestor)) { noise = true; break; }
            if (noise) continue;
            const alt = element.getAttribute('alt') || '';
            let score = root.contains(element) ? 60 : 20;
            if (element.closest('.event-cover, .event-poster, .event-image, .entry-content, [itemprop="image"]') || element.matches('.wp-block-cover__image-background')) score += 25;
            if (headingWords.some(word => alt.toLocaleLowerCase().includes(word))) score += 15;
            add(imageSource(element), alt, score, element);
        }
        for (const link of Array.from(document.querySelectorAll('a[data-gallery-image]')).slice(0, 20)) add(link.getAttribute('href'), '', 100);
        for (const element of Array.from(document.querySelectorAll('[data-interchange]')).slice(0, 20)) {
            const matches = (element.getAttribute('data-interchange') || '').match(/https?:\/\/[^,\]\s]+/g);
            if (matches?.length) add(matches[matches.length - 1], '', 90);
        }
        return [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 8);
    }

    function extractEventData(mode) {
        const root = contentRoot();
        if (!root) throw new Error('Stránka ešte nemá dostupný obsah.');
        const heading = compact(root.querySelector('h1')?.textContent || document.querySelector('h1')?.textContent);
        const title = meta('meta[property="og:title"]') || compact(document.title);
        const description = meta('meta[property="og:description"]') || meta('meta[name="description"]');
        const structuredData = readStructuredData();
        const microdataEvents = readMicrodata();
        const images = rankImages(root, structuredData, microdataEvents, heading || title);
        const bodyText = readText(root, mode);
        const prefix = [...new Set([heading, title, description].filter(Boolean))].filter(value => !bodyText.includes(value)).join('\n');
        return {
            url: location.href,
            canonicalUrl: absoluteUrl(document.querySelector('link[rel="canonical"]')?.getAttribute('href')) || location.href,
            title, heading, description,
            text: [prefix, bodyText].filter(Boolean).join('\n').slice(0, mode === 'bulk' ? LIMITS.bulkText : LIMITS.text),
            imageUrl: images[0]?.url || null,
            images, structuredData, microdataEvents
        };
    }

    function findImageUrl(fallbackUrl) {
        let current = lastRightClickedElement;
        // Honour the actual clicked image before trying page-wide poster fallbacks.
        while (current && current !== document.body) {
            const source = current.tagName === 'IMG' ? imageSource(current) : null;
            if (source) return source;
            const gallery = current.matches('a[data-gallery-image]') && absoluteUrl(current.getAttribute('href'));
            if (gallery) return gallery;
            const inlineBackground = current.style?.backgroundImage;
            const background = absoluteUrl(inlineBackground && inlineBackground !== 'none' ? inlineBackground : window.getComputedStyle(current).backgroundImage);
            if (background) return background;
            current = current.parentElement;
        }
        const gallery = document.querySelector('a[data-gallery-image="content"], a[data-gallery-image]');
        if (gallery && absoluteUrl(gallery.getAttribute('href'))) return absoluteUrl(gallery.getAttribute('href'));
        const interchange = document.querySelector('[data-interchange]');
        const matches = interchange?.getAttribute('data-interchange')?.match(/https?:\/\/[^,\]\s]+/g);
        if (matches?.length) return absoluteUrl(matches[matches.length - 1]);
        const cover = document.querySelector('.event-cover img, .wp-block-cover__image-background');
        return (cover && imageSource(cover)) || absoluteUrl(fallbackUrl);
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!request || !['get_event_data', 'find_image_url'].includes(request.action)) return;
        try {
            if (request.action === 'get_event_data') sendResponse(extractEventData(request.mode === 'bulk' ? 'bulk' : 'single'));
            else {
                const url = findImageUrl(request.fallbackUrl);
                sendResponse({ success: Boolean(url), url, ...(url ? {} : { error: 'Obrázok sa na stránke nenašiel.' }) });
            }
        } catch (error) {
            sendResponse({ success: false, error: `Obsah stránky sa nepodarilo načítať: ${error.message}` });
        }
        return false;
    });
})();
