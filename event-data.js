/* Shared, side-effect-free validation and schema.org extraction. */
(function (root) {
  'use strict';

  const FIELDS = ['title', 'dateFrom', 'dateTo', 'venue', 'street', 'number', 'city', 'url'];
  const EVENT_TYPES = new Set([
    'Event', 'BroadcastEvent', 'BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'CourseInstance',
    'DanceEvent', 'DeliveryEvent', 'EducationEvent', 'EventSeries', 'ExhibitionEvent', 'Festival', 'FoodEvent',
    'Hackathon', 'LiteraryEvent', 'MusicEvent', 'OnDemandEvent', 'PublicationEvent', 'SaleEvent',
    'ScreeningEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent', 'VisualArtsEvent'
  ]);

  function cleanText(value) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  }

  function comparable(value) {
    return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function normalizeDate(value) {
    const text = cleanText(value);
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$)/);
    if (!match) {
      const local = text.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
      if (local) match = [local[0], local[3], local[2], local[1]];
    }
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function safeUrl(value, base) {
    const text = cleanText(value);
    if (!text) return '';
    try {
      const url = new URL(text, base || undefined);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function comparableUrl(value) {
    const safe = safeUrl(value);
    if (!safe) return '';
    const url = new URL(safe);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|msclkid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  }

  function normalizeNumber(value) {
    const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : cleanText(value);
    return /^\d+[\p{L}]?(?:\s*[\/-]\s*[\p{L}\d]+)?$/u.test(text) ? text.replace(/\s+/g, '') : '';
  }

  function withoutPostalCode(value) {
    return cleanText(value).replace(/\b\d{3}\s?\d{2}\b/g, '').replace(/^[,\s]+|[,\s]+$/g, '').replace(/\s+/g, ' ').trim();
  }

  function normalizeEvent(raw) {
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const event = {
      title: cleanText(data.title),
      dateFrom: normalizeDate(data.dateFrom),
      dateTo: normalizeDate(data.dateTo),
      venue: cleanText(data.venue),
      street: withoutPostalCode(data.street),
      number: normalizeNumber(data.number),
      city: withoutPostalCode(data.city),
      url: safeUrl(data.url)
    };
    if (event.dateFrom && event.dateTo && event.dateTo < event.dateFrom) event.dateTo = '';

    const address = event.street.match(/^(.*?)\s+(\d+[\p{L}]?(?:\s*[\/-]\s*[\p{L}\d]+)?)$/u);
    if (address) {
      const number = normalizeNumber(address[2]);
      // Keep a conflicting explicit number for review instead of silently replacing it.
      if (!event.number || event.number === number) {
        event.street = address[1].trim();
        event.number = number;
      }
    }
    if (!/\p{L}/u.test(event.street) || (event.city && comparable(event.street) === comparable(event.city))) event.street = '';
    return event;
  }

  function typeName(value) {
    return typeof value === 'string' ? value.split(/[\/#:]/).pop() : '';
  }

  function types(node) {
    const value = node && (node['@type'] || node.type);
    return (Array.isArray(value) ? value : [value]).map(typeName);
  }

  function extractStructuredEvents(snapshot) {
    const page = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const base = safeUrl(page.canonicalUrl) || safeUrl(page.url);
    const roots = [...(Array.isArray(page.structuredData) ? page.structuredData : []), ...(Array.isArray(page.microdataEvents) ? page.microdataEvents : [])];
    const nodes = [];
    const index = new Map();
    const visited = new Set();

    function idKey(value) {
      const text = cleanText(value);
      if (!text) return '';
      try { return new URL(text, base || undefined).href; } catch (_) { return text; }
    }

    function walk(value) {
      if (!value || typeof value !== 'object' || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      nodes.push(value);
      const key = idKey(value['@id']);
      if (key) index.set(key, { ...index.get(key), ...value });
      Object.values(value).forEach(walk);
    }

    roots.forEach(value => {
      if (typeof value === 'string') {
        try { walk(JSON.parse(value)); } catch (_) { /* One malformed block must not hide the others. */ }
      } else walk(value);
    });

    function resolve(value) {
      if (typeof value === 'string') return index.get(idKey(value)) || value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const definition = index.get(idKey(value['@id']));
      return definition ? { ...definition, ...value } : value;
    }

    function scalar(value, keys = ['@value', 'name']) {
      if (Array.isArray(value)) {
        for (const item of value) {
          const result = scalar(item, keys);
          if (result) return result;
        }
        return '';
      }
      const resolved = resolve(value);
      if (typeof resolved === 'string') return cleanText(resolved);
      if (!resolved || typeof resolved !== 'object') return '';
      for (const key of keys) {
        const result = cleanText(resolved[key]);
        if (result) return result;
      }
      return '';
    }

    const mainIds = new Set();
    const mainObjects = new Set();
    nodes.forEach(node => {
      if (!types(node).some(type => ['WebPage', 'ItemPage'].includes(type))) return;
      const nodeUrl = scalar(node.url, ['url', '@id']) || cleanText(node['@id']);
      if (nodeUrl && comparableUrl(safeUrl(nodeUrl, base)) !== comparableUrl(base)) return;
      const entities = Array.isArray(node.mainEntity) ? node.mainEntity : [node.mainEntity];
      entities.forEach(entity => {
        if (entity && typeof entity === 'object') {
          mainObjects.add(entity);
          if (entity['@id']) mainIds.add(idKey(entity['@id']));
        } else if (typeof entity === 'string') mainIds.add(idKey(entity));
      });
    });

    const output = [];
    const seen = new Set();
    nodes.forEach(original => {
      const node = resolve(original);
      if (!types(node).some(type => EVENT_TYPES.has(type))) return;
      const locations = (Array.isArray(node.location) ? node.location : [node.location]).map(resolve).filter(Boolean);
      // Prefer the physical place when an event also has a streaming URL.
      const location = locations.find(place => typeof place === 'object' && !types(place).includes('VirtualLocation') && (place.address || place.streetAddress || place.addressLocality))
        || locations.find(place => !types(place).includes('VirtualLocation')) || {};
      const addressValue = typeof location === 'object' ? (location.address || location) : {};
      const address = resolve(Array.isArray(addressValue) ? addressValue[0] : addressValue) || {};
      const explicitUrl = safeUrl(scalar(node.url, ['url', '@id']), base);
      const sourceUrl = explicitUrl || safeUrl(node['@id'], base);
      const event = normalizeEvent({
        title: scalar(node.name || node.headline),
        dateFrom: scalar(node.startDate),
        dateTo: scalar(node.endDate),
        venue: scalar(typeof location === 'string' ? location : location.name),
        street: scalar(address.streetAddress),
        number: scalar(address.houseNumber || address.streetNumber),
        city: scalar(address.addressLocality),
        url: explicitUrl
      });
      if (!event.title) return;
      const result = {
        ...event,
        description: scalar(node.description),
        image: safeUrl(scalar(node.image, ['contentUrl', 'url', '@id']), base),
        eventStatus: scalar(node.eventStatus, ['@id', '@value']),
        sourceUrl,
        isMainEntity: mainObjects.has(original) || mainIds.has(idKey(node['@id']))
          || Boolean(base && comparableUrl(safeUrl(scalar(node.mainEntityOfPage, ['url', '@id']), base)) === comparableUrl(base))
      };
      const key = JSON.stringify(FIELDS.map(field => result[field]));
      if (seen.has(key)) {
        const previous = output.find(item => JSON.stringify(FIELDS.map(field => item[field])) === key);
        previous.isMainEntity = previous.isMainEntity || result.isMainEntity;
        return;
      }
      seen.add(key);
      output.push(result);
    });
    return output;
  }

  function selectPrimaryEvent(events, snapshot) {
    if (!Array.isArray(events) || !events.length) return null;
    const page = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const pageUrls = new Set([page.url, page.canonicalUrl].map(comparableUrl).filter(Boolean));
    const heading = comparable(page.heading);
    const title = comparable(page.title);
    const scored = events.filter(event => event && cleanText(event.title)).map(event => {
      const name = comparable(event.title);
      let score = event.isMainEntity === true ? 160 : 0;
      if (heading && heading === name) score += 140;
      else if (name.length >= 8 && heading.startsWith(name + ' ') && name.length / heading.length >= 0.6) score += 95;
      if (title && title === name) score += 110;
      else if (name.length >= 8 && title.startsWith(name + ' ') && name.length / title.length >= 0.45) score += 85;
      if (pageUrls.has(comparableUrl(event.url))) score += 80;
      else if (pageUrls.has(comparableUrl(event.sourceUrl))) score += 40;
      return { event, score };
    }).sort((a, b) => b.score - a.score);
    if (!scored.length || scored[0].score < 80) return null;
    if (scored[1] && scored[0].score - scored[1].score < 20) return null;
    return scored[0].event;
  }

  function isCompleteEvent(event) {
    const normalized = normalizeEvent(event);
    return ['title', 'dateFrom', 'dateTo', 'venue', 'city'].every(field => Boolean(normalized[field]));
  }

  function mergeEvents(primary, fallback) {
    const first = normalizeEvent(primary);
    const second = normalizeEvent(fallback);
    return normalizeEvent(Object.fromEntries(FIELDS.map(field => [field, first[field] || second[field]])));
  }

  function filterUpcoming(events, todayISO) {
    const today = normalizeDate(todayISO);
    if (!Array.isArray(events)) return [];
    const unique = new Map();
    events.forEach(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      const event = normalizeEvent(raw);
      if (today && event.dateTo && event.dateTo < today) return;
      const key = JSON.stringify([comparable(event.title), event.dateFrom, event.dateTo, comparable(event.venue), comparable(event.city)]);
      const previous = unique.get(key);
      unique.set(key, previous ? { ...raw, ...previous, ...mergeEvents(previous, event) } : { ...raw, ...event });
    });
    return [...unique.values()];
  }

  function formatSlovakDate(value) {
    const normalized = normalizeDate(value);
    if (!normalized) return '';
    return normalized.split('-').reverse().join('.');
  }

  const api = Object.freeze({ normalizeEvent, extractStructuredEvents, selectPrimaryEvent, isCompleteEvent, mergeEvents, filterUpcoming, formatSlovakDate });
  root.EventData = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
