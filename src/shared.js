/*
 * 浮笺 · 共享数据层
 * 使用传统脚本（非 ES Module），以便同时被 content script / popup / options 使用。
 * Chrome 102 兼容：仅使用回调式 storage API 与 ES2017 语法。
 */
(function (root) {
  'use strict';

  var NS = root.FloatNote = root.FloatNote || {};

  NS.SCHEMA_VERSION = 1;
  NS.STORAGE_KEYS = {
    settings: 'floatnote.settings.v1',
    notes: 'floatnote.notes.v1'
  };
  NS.LIMITS = {
    widthMin: 300,
    widthMax: 520,
    heightMin: 160,
    heightMax: 1200,
    title: 120,
    item: 2000,
    items: 500,
    depth: 5,
    url: 8192
  };
  NS.CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
  NS.THEMES = ['auto', 'light', 'dark'];

  NS.DEFAULT_SETTINGS = {
    schemaVersion: 1,
    corner: 'top-right',
    customX: null,
    customY: null,
    width: 360,
    height: null,
    theme: 'auto'
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toInteger(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    var number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function cleanControlChars(value) {
    return String(value == null ? '' : value)
      .replace(/\u0000/g, '')
      .replace(/\r\n?/g, '\n');
  }

  NS.normalizeSettings = function (input) {
    var value = input && typeof input === 'object' ? input : {};
    var width = toInteger(value.width, NS.DEFAULT_SETTINGS.width);
    var height = finiteOrNull(value.height);
    return {
      schemaVersion: NS.SCHEMA_VERSION,
      corner: NS.CORNERS.indexOf(value.corner) >= 0 ? value.corner : NS.DEFAULT_SETTINGS.corner,
      customX: finiteOrNull(value.customX),
      customY: finiteOrNull(value.customY),
      width: clamp(width, NS.LIMITS.widthMin, NS.LIMITS.widthMax),
      height: height === null ? null : clamp(height, NS.LIMITS.heightMin, NS.LIMITS.heightMax),
      theme: NS.THEMES.indexOf(value.theme) >= 0 ? value.theme : NS.DEFAULT_SETTINGS.theme
    };
  };

  NS.normalizeUrl = function (input) {
    if (!input) {
      return '';
    }
    var raw = String(input).trim().slice(0, NS.LIMITS.url);
    try {
      var url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') {
        return '';
      }
      // 页面内锚点（#...）不构成新的“网址”；查询参数会保留。
      url.hash = '';
      return url.href;
    } catch (error) {
      return '';
    }
  };

  NS.isSupportedUrl = function (input) {
    var normalized = NS.normalizeUrl(input);
    if (!normalized) {
      return false;
    }
    var host = '';
    try {
      host = new URL(normalized).hostname.toLowerCase();
    } catch (error) {
      return false;
    }
    if (host === 'chrome.google.com' || host === 'chromewebstore.google.com') {
      return false;
    }
    return true;
  };

  NS.getUrlLabel = function (input) {
    try {
      var url = new URL(input);
      if (url.protocol === 'file:') {
        return '本地文件';
      }
      var host = url.hostname.replace(/^www\./i, '');
      var path = url.pathname === '/' ? '' : url.pathname;
      return host + path;
    } catch (error) {
      return String(input || '');
    }
  };

  NS.getDomain = function (input) {
    try {
      var url = new URL(input);
      return url.protocol === 'file:' ? '本地文件' : url.hostname.replace(/^www\./i, '');
    } catch (error) {
      return '';
    }
  };

  NS.getPathLabel = function (input) {
    try {
      var url = new URL(input);
      if (url.protocol === 'file:') {
        return '本地文件';
      }
      var path = url.pathname || '/';
      if (path.length > 1) {
        path = path.replace(/\/+$/, '') || '/';
      }
      return path;
    } catch (error) {
      return '';
    }
  };

  function scopeParts(input) {
    var normalized = NS.normalizeUrl(input);
    if (!normalized) {
      return null;
    }
    var url = new URL(normalized);
    var path = url.pathname || '/';
    if (path.length > 1) {
      path = path.replace(/\/+$/, '') || '/';
    }
    var origin = url.protocol + '//' + url.host;
    var search = url.search || '';
    return {
      url: normalized,
      origin: origin,
      path: path,
      search: search,
      hasQuery: !!search,
      key: origin + path + search
    };
  }

  /**
   * 解析某个页面应使用的备注。
   * 优先精确匹配当前网址；否则按路径逐级向上寻找最近的“前缀备注”。
   * 例如：/s/xxx -> /s -> /。带查询参数的备注只精确匹配该完整网址。
   */
  NS.resolveNote = function (notes, pageUrl) {
    var page = scopeParts(pageUrl);
    if (!page) {
      return null;
    }
    var source = notes && typeof notes === 'object' ? notes : {};
    var best = null;
    var bestScore = -1;
    Object.keys(source).forEach(function (key) {
      var note = source[key];
      if (!note || typeof note !== 'object') {
        return;
      }
      var parts = scopeParts(note.url || key);
      if (!parts || parts.origin !== page.origin) {
        return;
      }
      var exact = parts.key === page.key;
      var score;
      if (parts.hasQuery) {
        // 带查询参数的备注只对同一完整网址生效，避免误覆盖其他搜索结果。
        if (!exact) {
          return;
        }
        score = 1000000 + parts.path.length;
      } else {
        var applies = parts.path === '/' ||
          page.path === parts.path ||
          page.path.indexOf(parts.path + '/') === 0;
        if (!applies) {
          return;
        }
        score = (exact ? 1000000 : 0) + parts.path.length;
      }
      var updatedAt = Number(note.updatedAt) || 0;
      if (!best || score > bestScore ||
          (score === bestScore && updatedAt > best.updatedAt)) {
        best = { note: note, parts: parts, updatedAt: updatedAt };
        bestScore = score;
      }
    });
    if (!best) {
      return null;
    }
    return {
      note: best.note,
      url: best.parts.url,
      inherited: best.parts.key !== page.key
    };
  };

  NS.normalizeItem = function (input) {
    var value = input && typeof input === 'object' ? input : {};
    var text = cleanControlChars(
      typeof value.t === 'string' ? value.t : (typeof value.text === 'string' ? value.text : '')
    ).slice(0, NS.LIMITS.item);
    return {
      t: text,
      d: clamp(toInteger(value.d, 0), 0, NS.LIMITS.depth)
    };
  };

  NS.createNote = function (url) {
    var normalized = NS.normalizeUrl(url);
    if (!normalized) {
      return null;
    }
    var now = Date.now();
    return {
      url: normalized,
      title: '',
      items: [],
      listStyle: 'bullet',
      createdAt: now,
      updatedAt: now
    };
  };

  NS.normalizeNote = function (input, fallbackUrl) {
    if (!input || typeof input !== 'object') {
      return null;
    }
    var url = NS.normalizeUrl(input.url || fallbackUrl);
    if (!url) {
      return null;
    }

    var title = cleanControlChars(input.title)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NS.LIMITS.title);

    var rawItems = Array.isArray(input.items) ? input.items : [];
    var items = [];
    var previousDepth = 0;
    for (var index = 0; index < rawItems.length && items.length < NS.LIMITS.items; index += 1) {
      var item = NS.normalizeItem(rawItems[index]);
      // 让导入的数据也满足“层级只能逐级增加”的约束。
      if (index === 0) {
        item.d = 0;
      } else if (item.d > previousDepth + 1) {
        item.d = previousDepth + 1;
      }
      previousDepth = item.d;
      items.push(item);
    }

    var createdAt = Number(input.createdAt);
    var updatedAt = Number(input.updatedAt);
    if (!Number.isFinite(createdAt) || createdAt <= 0) {
      createdAt = Date.now();
    }
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      updatedAt = createdAt;
    }

    return {
      url: url,
      title: title,
      items: items,
      listStyle: input.listStyle === 'number' ? 'number' : 'bullet',
      createdAt: createdAt,
      updatedAt: updatedAt
    };
  };

  NS.normalizeNotes = function (input) {
    var source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    var output = {};
    Object.keys(source).forEach(function (key) {
      var note = NS.normalizeNote(source[key], key);
      if (note && NS.noteHasContent(note)) {
        output[note.url] = note;
      }
    });
    return output;
  };

  NS.noteHasContent = function (note) {
    if (!note) {
      return false;
    }
    if (String(note.title || '').trim()) {
      return true;
    }
    var items = Array.isArray(note.items) ? note.items : [];
    for (var i = 0; i < items.length; i += 1) {
      if (String(items[i] && items[i].t || '').trim()) {
        return true;
      }
    }
    return false;
  };

  NS.noteText = function (note, maxLength) {
    if (!note) {
      return '';
    }
    var parts = [];
    if (note.title) {
      parts.push(note.title);
    }
    var items = Array.isArray(note.items) ? note.items : [];
    for (var i = 0; i < items.length; i += 1) {
      var text = String(items[i] && items[i].t || '').trim();
      if (text) {
        parts.push(text);
      }
    }
    var joined = parts.join(' / ');
    var limit = maxLength || 220;
    return joined.length > limit ? joined.slice(0, limit) + '…' : joined;
  };

  NS.noteCharCount = function (note) {
    if (!note) {
      return 0;
    }
    var count = String(note.title || '').length;
    var items = Array.isArray(note.items) ? note.items : [];
    for (var i = 0; i < items.length; i += 1) {
      count += String(items[i] && items[i].t || '').length;
    }
    return count;
  };

  NS.countItems = function (note) {
    if (!note || !Array.isArray(note.items)) {
      return 0;
    }
    return note.items.filter(function (item) {
      return String(item && item.t || '').trim().length > 0;
    }).length;
  };

  NS.effectiveTheme = function (theme) {
    if (theme === 'light' || theme === 'dark') {
      return theme;
    }
    try {
      if (root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch (error) {
      // 跟随系统失败时回退到浅色。
    }
    return 'light';
  };

  NS.formatDateTime = function (timestamp) {
    var date = new Date(Number(timestamp) || Date.now());
    if (!Number.isFinite(date.getTime())) {
      return '';
    }
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0') + ' ' +
      String(date.getHours()).padStart(2, '0') + ':' +
      String(date.getMinutes()).padStart(2, '0');
  };

  NS.formatRelative = function (timestamp) {
    var time = Number(timestamp);
    if (!Number.isFinite(time)) {
      return '';
    }
    var delta = Date.now() - time;
    if (delta < 45000) {
      return '刚刚';
    }
    if (delta < 60 * 60 * 1000) {
      return Math.max(1, Math.floor(delta / 60000)) + ' 分钟前';
    }
    if (delta < 24 * 60 * 60 * 1000) {
      return Math.floor(delta / 3600000) + ' 小时前';
    }
    if (delta < 7 * 24 * 60 * 60 * 1000) {
      return Math.floor(delta / 86400000) + ' 天前';
    }
    return NS.formatDateTime(time).slice(0, 10);
  };

  function chromeStorageAvailable() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function storageGet(keys, callback) {
    var done = typeof callback === 'function' ? callback : function () {};
    if (!chromeStorageAvailable()) {
      done(new Error('当前环境不支持 chrome.storage。'), {});
      return;
    }
    try {
      chrome.storage.local.get(keys, function (result) {
        var error = chrome.runtime && chrome.runtime.lastError
          ? new Error(chrome.runtime.lastError.message)
          : null;
        done(error, result || {});
      });
    } catch (error) {
      done(error, {});
    }
  }

  function storageSet(payload, callback) {
    var done = typeof callback === 'function' ? callback : function () {};
    if (!chromeStorageAvailable()) {
      done(new Error('当前环境不支持 chrome.storage。'));
      return;
    }
    try {
      chrome.storage.local.set(payload, function () {
        var error = chrome.runtime && chrome.runtime.lastError
          ? new Error(chrome.runtime.lastError.message)
          : null;
        done(error);
      });
    } catch (error) {
      done(error);
    }
  }

  NS.storageGet = storageGet;

  NS.loadSettings = function (callback) {
    storageGet([NS.STORAGE_KEYS.settings], function (error, result) {
      callback(error, NS.normalizeSettings(result && result[NS.STORAGE_KEYS.settings]));
    });
  };

  NS.loadNotes = function (callback) {
    storageGet([NS.STORAGE_KEYS.notes], function (error, result) {
      callback(error, NS.normalizeNotes(result && result[NS.STORAGE_KEYS.notes]));
    });
  };

  NS.loadAll = function (callback) {
    storageGet([NS.STORAGE_KEYS.settings, NS.STORAGE_KEYS.notes], function (error, result) {
      callback(error, {
        settings: NS.normalizeSettings(result && result[NS.STORAGE_KEYS.settings]),
        notes: NS.normalizeNotes(result && result[NS.STORAGE_KEYS.notes])
      });
    });
  };

  NS.saveSettings = function (settings, callback) {
    var normalized = NS.normalizeSettings(settings);
    var payload = {};
    payload[NS.STORAGE_KEYS.settings] = normalized;
    storageSet(payload, function (error) {
      if (typeof callback === 'function') {
        callback(error, normalized);
      }
    });
  };

  NS.updateSettings = function (patch, callback) {
    NS.loadSettings(function (loadError, current) {
      if (loadError) {
        if (typeof callback === 'function') {
          callback(loadError, current);
        }
        return;
      }
      var next = NS.normalizeSettings(Object.assign({}, current, patch || {}));
      NS.saveSettings(next, callback);
    });
  };

  NS.saveNote = function (input, callback) {
    var done = typeof callback === 'function' ? callback : function () {};
    var note = NS.normalizeNote(input);
    if (!note) {
      done(new Error('无效的备注网址。'));
      return;
    }
    storageGet([NS.STORAGE_KEYS.notes], function (error, result) {
      if (error) {
        done(error);
        return;
      }
      var notes = NS.normalizeNotes(result && result[NS.STORAGE_KEYS.notes]);
      note.updatedAt = Date.now();
      if (NS.noteHasContent(note)) {
        notes[note.url] = note;
      } else {
        delete notes[note.url];
      }
      var payload = {};
      payload[NS.STORAGE_KEYS.notes] = notes;
      storageSet(payload, function (setError) {
        done(setError, setError ? null : note);
      });
    });
  };

  NS.deleteNote = function (url, callback) {
    var done = typeof callback === 'function' ? callback : function () {};
    var normalized = NS.normalizeUrl(url);
    if (!normalized) {
      done(new Error('无效的备注网址。'));
      return;
    }
    storageGet([NS.STORAGE_KEYS.notes], function (error, result) {
      if (error) {
        done(error);
        return;
      }
      var notes = NS.normalizeNotes(result && result[NS.STORAGE_KEYS.notes]);
      delete notes[normalized];
      var payload = {};
      payload[NS.STORAGE_KEYS.notes] = notes;
      storageSet(payload, done);
    });
  };

  NS.replaceNotes = function (input, callback) {
    var notes = NS.normalizeNotes(input);
    var payload = {};
    payload[NS.STORAGE_KEYS.notes] = notes;
    storageSet(payload, function (error) {
      if (typeof callback === 'function') {
        callback(error, notes);
      }
    });
  };

  NS.makeExport = function (settings, notes) {
    return {
      app: 'floatnote',
      schemaVersion: NS.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: NS.normalizeSettings(settings),
      notes: NS.normalizeNotes(notes)
    };
  };

  NS.mergeNotes = function (existing, incoming) {
    var merged = NS.normalizeNotes(existing);
    var source = NS.normalizeNotes(incoming);
    Object.keys(source).forEach(function (key) {
      merged[key] = source[key];
    });
    return merged;
  };

  NS.getNoteTitle = function (note) {
    var title = note && String(note.title || '').trim();
    return title || '本页备注';
  };

  function toAlpha(number) {
    var result = '';
    var value = Math.max(1, Math.floor(number));
    while (value > 0) {
      var remainder = (value - 1) % 26;
      result = String.fromCharCode(97 + remainder) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  }

  function toRoman(number) {
    var value = Math.max(1, Math.min(3999, Math.floor(number)));
    var pairs = [
      [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
      [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
      [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
    ];
    var result = '';
    pairs.forEach(function (pair) {
      while (value >= pair[0]) {
        result += pair[1];
        value -= pair[0];
      }
    });
    return result;
  }

  // 编号列表按层级切换样式：1. / a. / i.，便于一眼分辨多级结构。
  NS.formatOrderedMarker = function (number, depth) {
    var level = (Number(depth) || 0) % 3;
    if (level === 1) {
      return toAlpha(number) + '.';
    }
    if (level === 2) {
      return toRoman(number) + '.';
    }
    return Math.max(1, Math.floor(number)) + '.';
  };

})(typeof window !== 'undefined' ? window : globalThis);
