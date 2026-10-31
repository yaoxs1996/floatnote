/*
 * 浮笺 · 设置与备注库
 */
(function () {
  'use strict';

  var FN = window.FloatNote;
  var state = {
    settings: FN.normalizeSettings(null),
    notes: {},
    query: '',
    widthTimer: null,
    toastTimer: null,
    confirmAction: null,
    importing: false
  };

  var els = {};
  var AVATAR_PALETTES = [
    ['#6676f3', '#8d62df'],
    ['#3f9bce', '#4d76dc'],
    ['#d97757', '#c14d79'],
    ['#38a37b', '#2f80a7'],
    ['#9a67dd', '#d25f9d'],
    ['#c58a35', '#d06245']
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      'stat-notes', 'stat-items', 'stat-updated', 'search-notes', 'result-count',
      'notes-list', 'empty-state', 'empty-title', 'empty-text', 'position-grid',
      'reset-position', 'position-hint', 'theme-control', 'width-range', 'width-value',
      'export-data', 'import-data', 'import-file', 'clear-data', 'toast',
      'confirm-dialog', 'confirm-title', 'confirm-message', 'confirm-cancel',
      'confirm-accept'
    ].forEach(function (id) {
      els[id] = $(id);
    });
    els.positionButtons = Array.prototype.slice.call(
      els['position-grid'].querySelectorAll('[data-corner]')
    );
    els.themeButtons = Array.prototype.slice.call(
      els['theme-control'].querySelectorAll('[data-theme]')
    );
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.hidden = false;
    state.toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 3000);
  }

  function applyPageTheme() {
    document.documentElement.setAttribute('data-theme', FN.effectiveTheme(state.settings.theme));
  }

  function sortedNotes() {
    return Object.keys(state.notes)
      .map(function (key) {
        return state.notes[key];
      })
      .filter(function (note) {
        return note && FN.noteHasContent(note);
      })
      .sort(function (a, b) {
        return b.updatedAt - a.updatedAt;
      });
  }

  function filteredNotes() {
    var query = state.query.trim().toLowerCase();
    var notes = sortedNotes();
    if (!query) {
      return notes;
    }
    return notes.filter(function (note) {
      var haystack = [
        note.title || '',
        note.url || '',
        FN.getUrlLabel(note.url),
        FN.noteText(note, 1000)
      ].join(' ').toLowerCase();
      return haystack.indexOf(query) >= 0;
    });
  }

  function renderStats() {
    var notes = sortedNotes();
    var items = 0;
    var latest = 0;
    notes.forEach(function (note) {
      items += FN.countItems(note);
      latest = Math.max(latest, note.updatedAt || 0);
    });
    els['stat-notes'].textContent = String(notes.length);
    els['stat-items'].textContent = String(items);
    if (latest) {
      els['stat-updated'].textContent = FN.formatRelative(latest);
      els['stat-updated'].title = FN.formatDateTime(latest);
    } else {
      els['stat-updated'].textContent = '—';
      els['stat-updated'].title = '还没有备注';
    }
  }

  function avatarGradient(text) {
    var hash = 0;
    for (var i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    var palette = AVATAR_PALETTES[hash % AVATAR_PALETTES.length];
    return 'linear-gradient(145deg, ' + palette[0] + ', ' + palette[1] + ')';
  }

  function addPreview(note, container) {
    var items = (note.items || []).filter(function (item) {
      return String(item.t || '').trim().length > 0;
    });
    if (!items.length) {
      container.appendChild(el('span', 'note-empty-preview', '仅标题，列表为空'));
      return;
    }
    var counters = [];
    var limit = Math.min(3, items.length);
    for (var i = 0; i < limit; i += 1) {
      var item = items[i];
      var line = el('div', 'preview-line');
      line.style.setProperty('--preview-depth', String(item.d));
      var marker = el('span', 'preview-marker');
      if (note.listStyle === 'number') {
        for (var depth = item.d + 1; depth < counters.length; depth += 1) {
          counters[depth] = 0;
        }
        counters[item.d] = (counters[item.d] || 0) + 1;
        marker.textContent = FN.formatOrderedMarker(counters[item.d], item.d);
      } else {
        marker.textContent = item.d === 0 ? '•' : (item.d === 1 ? '◦' : '▪');
      }
      var text = el('span', 'preview-text', item.t);
      text.title = item.t;
      line.appendChild(marker);
      line.appendChild(text);
      container.appendChild(line);
    }
    if (items.length > limit) {
      container.appendChild(el('div', 'preview-more', '还有 ' + (items.length - limit) + ' 项…'));
    }
  }

  function renderNoteCard(note) {
    var card = el('article', 'note-card');

    var avatar = el('span', 'note-avatar');
    var domain = FN.getDomain(note.url);
    avatar.textContent = (domain || '·').slice(0, 1).toUpperCase();
    avatar.style.background = avatarGradient(domain || note.url);
    avatar.setAttribute('aria-hidden', 'true');

    var main = el('div', 'note-main');
    var heading = el('div', 'note-heading');
    var title = el('h3', 'note-title', String(note.title || '').trim() || '未命名备注');
    title.title = title.textContent;
    var time = el('time', 'note-time', FN.formatRelative(note.updatedAt));
    time.dateTime = new Date(note.updatedAt).toISOString();
    time.title = FN.formatDateTime(note.updatedAt);
    heading.appendChild(title);
    heading.appendChild(time);

    var url = el('a', 'note-url', FN.getUrlLabel(note.url));
    url.href = note.url;
    url.target = '_blank';
    url.rel = 'noopener noreferrer';
    url.title = note.url;

    var preview = el('div', 'note-preview');
    addPreview(note, preview);

    var footer = el('div', 'note-footer');
    var meta = el('div', 'note-meta');
    meta.appendChild(el('span', '', FN.countItems(note) + ' 个列表项'));
    meta.appendChild(el('span', 'meta-dot'));
    meta.appendChild(el('span', '', '更新于 ' + FN.formatRelative(note.updatedAt)));
    if (note.listStyle === 'number') {
      meta.appendChild(el('span', 'meta-dot'));
      meta.appendChild(el('span', '', '编号列表'));
    }

    var actions = el('div', 'note-actions');
    var open = el('a', 'open-link');
    open.href = note.url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';
    open.appendChild(document.createTextNode('打开页面'));

    var del = el('button', 'delete-button');
    del.type = 'button';
    del.setAttribute('aria-label', '删除备注：' + (note.title || FN.getUrlLabel(note.url)));
    del.dataset.url = note.url;
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l.7 13h9.6l.7-13M10 11v5M14 11v5"/></svg>';
    del.appendChild(document.createTextNode('删除'));

    actions.appendChild(open);
    actions.appendChild(del);
    footer.appendChild(meta);
    footer.appendChild(actions);

    main.appendChild(heading);
    main.appendChild(url);
    main.appendChild(preview);
    main.appendChild(footer);

    card.appendChild(avatar);
    card.appendChild(main);
    return card;
  }

  function renderNotes() {
    var notes = filteredNotes();
    els['notes-list'].textContent = '';
    notes.forEach(function (note) {
      els['notes-list'].appendChild(renderNoteCard(note));
    });

    els['result-count'].textContent = state.query.trim()
      ? '找到 ' + notes.length + ' 条'
      : '共 ' + notes.length + ' 条';

    if (!notes.length) {
      els['empty-state'].hidden = false;
      if (state.query.trim()) {
        els['empty-title'].textContent = '没有找到相关备注';
        els['empty-text'].textContent = '换一个关键词试试，可以搜索标题、网址或列表内容。';
      } else {
        els['empty-title'].textContent = '还没有备注';
        els['empty-text'].textContent = '打开任意网页，点击工具栏中的浮笺图标，即可在页面右上角记录第一条备注。';
      }
    } else {
      els['empty-state'].hidden = true;
    }
  }

  function renderSettings() {
    var settings = state.settings;
    els['width-range'].value = String(settings.width);
    els['width-value'].textContent = settings.width + ' px';

    els.themeButtons.forEach(function (button) {
      var active = button.getAttribute('data-theme') === settings.theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    var custom = settings.customX !== null && settings.customY !== null;
    els.positionButtons.forEach(function (button) {
      var active = !custom && button.getAttribute('data-corner') === settings.corner;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (custom) {
      els['position-hint'].textContent = '当前使用拖动后的自定义位置；选择任一角落可重新停靠。';
    } else {
      els['position-hint'].textContent = '拖动页面中面板的标题栏，可以自由摆放。';
    }
    applyPageTheme();
  }

  function renderAll() {
    renderStats();
    renderNotes();
    renderSettings();
  }

  function saveSettings(patch, successMessage) {
    state.settings = FN.normalizeSettings(Object.assign({}, state.settings, patch || {}));
    FN.saveSettings(state.settings, function (error, settings) {
      if (error) {
        showToast('设置保存失败：' + error.message);
        return;
      }
      state.settings = settings;
      renderSettings();
      if (successMessage) {
        showToast(successMessage);
      }
    });
  }

  function askConfirm(options) {
    state.confirmAction = options.onConfirm || null;
    els['confirm-title'].textContent = options.title || '确认操作';
    els['confirm-message'].textContent = options.message || '';
    els['confirm-accept'].textContent = options.confirmLabel || '确认';
    els['confirm-accept'].classList.toggle('is-danger', !!options.danger);
    if (typeof els['confirm-dialog'].showModal === 'function') {
      els['confirm-dialog'].showModal();
    } else if (window.confirm(options.title + '\n\n' + options.message)) {
      var action = state.confirmAction;
      state.confirmAction = null;
      if (action) {
        action();
      }
    }
  }

  function closeConfirm() {
    if (els['confirm-dialog'].open) {
      els['confirm-dialog'].close();
    }
  }

  function deleteNote(url) {
    var note = state.notes[url];
    askConfirm({
      title: '删除这条备注？',
      message: '“' + ((note && note.title) || FN.getUrlLabel(url)) + '”\n删除后无法恢复。若需要保留，可先导出备份。',
      confirmLabel: '删除',
      danger: true,
      onConfirm: function () {
        FN.deleteNote(url, function (error) {
          if (error) {
            showToast('删除失败：' + error.message);
            return;
          }
          delete state.notes[url];
          renderAll();
          showToast('已删除该条备注');
        });
      }
    });
  }

  function downloadExport() {
    var payload = FN.makeExport(state.settings, state.notes);
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var now = new Date();
    var stamp = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    var link = document.createElement('a');
    link.href = url;
    link.download = 'floatnote-backup-' + stamp + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1200);
    showToast('已导出 ' + Object.keys(state.notes).length + ' 条备注');
  }

  function importBackup(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      showToast('导入失败：文件不是有效的 JSON。');
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      showToast('导入失败：文件内容格式不正确。');
      return;
    }
    var rawNotes = parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : parsed;
    var incoming = FN.normalizeNotes(rawNotes);
    var count = Object.keys(incoming).length;
    if (!count) {
      showToast('导入失败：文件中没有可识别的备注。');
      return;
    }
    var hasSettings = parsed.settings && typeof parsed.settings === 'object';
    askConfirm({
      title: '导入 ' + count + ' 条备注？',
      message: '导入内容会与现有备注合并；相同网址的备注将以文件中的内容为准。' +
        (hasSettings ? '\n外观设置也会一并恢复。' : ''),
      confirmLabel: '导入',
      onConfirm: function () {
        var merged = FN.mergeNotes(state.notes, incoming);
        FN.replaceNotes(merged, function (error, notes) {
          if (error) {
            showToast('导入失败：' + error.message);
            return;
          }
          state.notes = notes;
          if (hasSettings) {
            FN.saveSettings(FN.normalizeSettings(parsed.settings), function (settingsError, settings) {
              if (!settingsError) {
                state.settings = settings;
              }
              finishImport(count);
            });
          } else {
            finishImport(count);
          }
        });
      }
    });
  }

  function finishImport(count) {
    renderAll();
    showToast('已导入 ' + count + ' 条备注');
  }

  function clearAllNotes() {
    var count = sortedNotes().length;
    askConfirm({
      title: '删除全部备注？',
      message: '将永久删除 ' + count + ' 条备注，外观设置会保留。建议先导出备份。',
      confirmLabel: '全部删除',
      danger: true,
      onConfirm: function () {
        FN.replaceNotes({}, function (error) {
          if (error) {
            showToast('删除失败：' + error.message);
            return;
          }
          state.notes = {};
          renderAll();
          showToast('已删除全部备注');
        });
      }
    });
  }

  function bindSettings() {
    els.positionButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        saveSettings({
          corner: button.getAttribute('data-corner'),
          customX: null,
          customY: null
        });
      });
    });
    els['reset-position'].addEventListener('click', function () {
      saveSettings({ corner: 'top-right', customX: null, customY: null }, '已恢复右上角');
    });
    els.themeButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        saveSettings({ theme: button.getAttribute('data-theme') });
      });
    });
    els['width-range'].addEventListener('input', function () {
      var value = Number(els['width-range'].value);
      state.settings.width = value;
      els['width-value'].textContent = value + ' px';
      clearTimeout(state.widthTimer);
      state.widthTimer = setTimeout(function () {
        state.widthTimer = null;
        saveSettings({ width: value });
      }, 180);
    });
    els['width-range'].addEventListener('change', function () {
      clearTimeout(state.widthTimer);
      state.widthTimer = null;
      saveSettings({ width: Number(els['width-range'].value) });
    });
    window.addEventListener('pagehide', function () {
      if (state.widthTimer) {
        clearTimeout(state.widthTimer);
        state.widthTimer = null;
        FN.saveSettings(state.settings);
      }
    });
  }

  function bindDataActions() {
    els['export-data'].addEventListener('click', downloadExport);
    els['import-data'].addEventListener('click', function () {
      els['import-file'].click();
    });
    els['import-file'].addEventListener('change', function () {
      var file = els['import-file'].files && els['import-file'].files[0];
      if (!file) {
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        importBackup(String(reader.result || ''));
        els['import-file'].value = '';
      };
      reader.onerror = function () {
        showToast('导入失败：无法读取文件。');
        els['import-file'].value = '';
      };
      reader.readAsText(file, 'utf-8');
    });
    els['clear-data'].addEventListener('click', clearAllNotes);
  }

  function bindDialog() {
    els['confirm-accept'].addEventListener('click', function () {
      var action = state.confirmAction;
      state.confirmAction = null;
      closeConfirm();
      if (action) {
        action();
      }
    });
    els['confirm-dialog'].addEventListener('close', function () {
      state.confirmAction = null;
    });
    els['confirm-dialog'].addEventListener('click', function (event) {
      if (event.target === els['confirm-dialog']) {
        closeConfirm();
      }
    });
  }

  function bindNotesList() {
    els['notes-list'].addEventListener('click', function (event) {
      var button = event.target.closest('.delete-button');
      if (!button) {
        return;
      }
      var url = button.dataset.url;
      if (url) {
        deleteNote(url);
      }
    });
    els['search-notes'].addEventListener('input', function () {
      state.query = els['search-notes'].value;
      renderNotes();
    });
  }

  function listenForChanges() {
    if (!chrome.storage || !chrome.storage.onChanged) {
      return;
    }
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local') {
        return;
      }
      if (changes[FN.STORAGE_KEYS.settings]) {
        state.settings = FN.normalizeSettings(changes[FN.STORAGE_KEYS.settings].newValue);
        renderSettings();
      }
      if (changes[FN.STORAGE_KEYS.notes]) {
        state.notes = FN.normalizeNotes(changes[FN.STORAGE_KEYS.notes].newValue);
        renderStats();
        renderNotes();
      }
    });
    if (window.matchMedia) {
      try {
        var media = window.matchMedia('(prefers-color-scheme: dark)');
        var onChange = function () {
          if (state.settings.theme === 'auto') {
            applyPageTheme();
          }
        };
        if (media.addEventListener) {
          media.addEventListener('change', onChange);
        } else if (media.addListener) {
          media.addListener(onChange);
        }
      } catch (error) {
        // 忽略媒体查询监听失败。
      }
    }
  }

  function initialize() {
    cacheElements();
    bindSettings();
    bindDataActions();
    bindDialog();
    bindNotesList();
    listenForChanges();
    applyPageTheme();
    FN.loadAll(function (error, data) {
      if (error) {
        showToast('读取数据失败：' + error.message);
      } else {
        state.settings = data.settings;
        state.notes = data.notes;
      }
      renderAll();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
