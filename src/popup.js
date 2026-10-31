/*
 * 浮笺 · 扩展弹窗
 */
(function () {
  'use strict';

  var FN = window.FloatNote;
  var state = {
    tab: null,
    url: '',
    rawUrl: '',
    supported: false,
    settings: FN.normalizeSettings(null),
    notes: {},
    note: null,
    widthTimer: null,
    toastTimer: null,
    opening: false
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    [
      'open-options', 'site-avatar', 'current-page-title', 'page-url', 'note-state',
      'note-preview', 'open-panel', 'unsupported', 'position-grid', 'reset-position',
      'position-hint', 'width-value', 'theme-control', 'width-range', 'manage-notes',
      'note-count', 'toast'
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

  function applyPageTheme() {
    var theme = FN.effectiveTheme(state.settings.theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  function showToast(message) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.hidden = false;
    state.toastTimer = setTimeout(function () {
      els.toast.hidden = true;
    }, 2800);
  }

  function loadCurrentTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var error = chrome.runtime.lastError;
      if (error) {
        callback(new Error(error.message));
        return;
      }
      state.tab = tabs && tabs[0] ? tabs[0] : null;
      state.rawUrl = state.tab ? (state.tab.url || state.tab.pendingUrl || '') : '';
      state.url = FN.normalizeUrl(state.rawUrl);
      state.supported = state.url ? FN.isSupportedUrl(state.rawUrl) : false;
      callback(null);
    });
  }

  function noteForCurrentPage() {
    return state.url ? (state.notes[state.url] || null) : null;
  }

  function renderCurrentPage() {
    var note = state.note;
    var pageTitle = state.tab && state.tab.title ? state.tab.title : '当前页面';
    els['current-page-title'].textContent = pageTitle;
    els['current-page-title'].title = pageTitle;

    if (!state.rawUrl) {
      els['page-url'].textContent = '无法读取页面地址';
      els['site-avatar'].textContent = '?';
      els['note-state'].textContent = '不可用';
      els['note-state'].className = 'state-badge unavailable';
      els['note-preview'].textContent = '请刷新页面或打开一个普通网页后再试。';
      els['open-panel'].disabled = true;
      els['open-panel'].querySelector('span').textContent = '当前页面不可用';
      els.unsupported.hidden = false;
      return;
    }

    var label = FN.getUrlLabel(state.url || state.rawUrl);
    var domain = FN.getDomain(state.url || state.rawUrl);
    els['page-url'].textContent = label;
    els['page-url'].title = state.rawUrl;
    els['site-avatar'].textContent = (domain || '·').replace(/^./, function (char) {
      return char.toUpperCase();
    }).slice(0, 1);

    if (!state.supported) {
      els['note-state'].textContent = '不可用';
      els['note-state'].className = 'state-badge unavailable';
      els['note-preview'].textContent = '此页面受浏览器保护，无法注入悬浮备注。';
      els['open-panel'].disabled = true;
      els['open-panel'].querySelector('span').textContent = '当前页面不可用';
      els.unsupported.hidden = false;
      return;
    }

    els.unsupported.hidden = true;
    els['open-panel'].disabled = false;
    els['open-panel'].querySelector('span').textContent = note ? '显示并编辑备注' : '显示并添加备注';

    if (note) {
      els['note-state'].textContent = '有备注';
      els['note-state'].className = 'state-badge has-note';
      els['note-preview'].textContent = FN.noteText(note, 150) || '备注内容为空';
    } else {
      els['note-state'].textContent = '未记录';
      els['note-state'].className = 'state-badge';
      els['note-preview'].textContent = '本页还没有备注。点击下方按钮，在当前页面记录要点。';
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
      els['position-hint'].textContent = '当前为拖动后的自定义位置；选择一个角落可重新停靠。';
    } else {
      els['position-hint'].textContent = '也可以直接拖动页面中面板的标题栏。';
    }
    applyPageTheme();
  }

  function renderAll() {
    state.note = noteForCurrentPage();
    renderCurrentPage();
    renderSettings();
    els['note-count'].textContent = String(Object.keys(state.notes).length);
  }

  function persistSettings(patch, successMessage) {
    state.settings = FN.normalizeSettings(Object.assign({}, state.settings, patch || {}));
    FN.saveSettings(state.settings, function (error, settings) {
      if (error) {
        showToast('保存失败：' + error.message);
        return;
      }
      state.settings = settings;
      renderSettings();
      if (successMessage) {
        showToast(successMessage);
      }
    });
  }

  function savePosition(corner) {
    persistSettings({ corner: corner, customX: null, customY: null });
  }

  function saveTheme(theme) {
    persistSettings({ theme: theme });
  }

  function saveWidth(value) {
    clearTimeout(state.widthTimer);
    state.widthTimer = null;
    state.settings.width = value;
    persistSettings({ width: value });
  }

  function scheduleWidthSave(value) {
    state.settings.width = value;
    clearTimeout(state.widthTimer);
    state.widthTimer = setTimeout(function () {
      saveWidth(value);
    }, 180);
  }

  function setOpening(active, label) {
    state.opening = active;
    els['open-panel'].disabled = active || !state.supported;
    var span = els['open-panel'].querySelector('span');
    if (active) {
      span.textContent = label || '正在打开…';
    } else {
      span.textContent = state.note ? '显示并编辑备注' : '显示并添加备注';
    }
  }

  function handleOpenFailure(message) {
    setOpening(false);
    showToast(message || '无法在当前页面打开备注，请刷新页面后重试。');
  }

  function sendMessageToContent(type, callback) {
    chrome.tabs.sendMessage(state.tab.id, { type: type }, function (response) {
      var error = chrome.runtime.lastError;
      if (error) {
        callback(new Error(error.message), null);
        return;
      }
      callback(null, response);
    });
  }

  function injectContentScripts(callback) {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      callback(new Error('当前浏览器不支持脚本注入。'));
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId: state.tab.id },
      files: ['src/shared.js', 'src/content.js']
    }, function () {
      var error = chrome.runtime.lastError;
      callback(error ? new Error(error.message) : null);
    });
  }

  function openPanel() {
    if (!state.supported || !state.tab || state.opening) {
      return;
    }
    setOpening(true);
    sendMessageToContent('FLOATNOTE_EDIT', function (error, response) {
      if (!error && response && response.ok) {
        window.close();
        return;
      }
      // 扩展更新后，已打开页面里的内容脚本可能失效；主动补注入一次。
      injectContentScripts(function (injectError) {
        if (injectError) {
          handleOpenFailure('当前页面不允许扩展注入（浏览器内置页面或受保护页面）。');
          return;
        }
        setTimeout(function () {
          sendMessageToContent('FLOATNOTE_EDIT', function (secondError, secondResponse) {
            if (secondError || !secondResponse || !secondResponse.ok) {
              handleOpenFailure('备注面板未能启动，请刷新页面后重试。');
              return;
            }
            window.close();
          });
        }, 160);
      });
    });
  }

  function autoReveal() {
    if (!state.supported || !state.tab) {
      return;
    }
    sendMessageToContent('FLOATNOTE_REVEAL', function (error, response) {
      if (!error && response && response.ok) {
        return;
      }
      injectContentScripts(function (injectError) {
        if (injectError) {
          return;
        }
        setTimeout(function () {
          sendMessageToContent('FLOATNOTE_REVEAL', function () {});
        }, 160);
      });
    });
  }

  function bindEvents() {
    els.positionButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        savePosition(button.getAttribute('data-corner'));
      });
    });
    els['reset-position'].addEventListener('click', function () {
      savePosition('top-right');
    });
    els.themeButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        saveTheme(button.getAttribute('data-theme'));
      });
    });
    els['width-range'].addEventListener('input', function () {
      var value = Number(els['width-range'].value);
      els['width-value'].textContent = value + ' px';
      scheduleWidthSave(value);
    });
    els['width-range'].addEventListener('change', function () {
      saveWidth(Number(els['width-range'].value));
    });
    window.addEventListener('pagehide', function () {
      if (state.widthTimer) {
        saveWidth(Number(els['width-range'].value));
      }
    });
    els['open-panel'].addEventListener('click', openPanel);
    els['manage-notes'].addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
    });
    els['open-options'].addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
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
        state.note = noteForCurrentPage();
        renderCurrentPage();
        els['note-count'].textContent = String(Object.keys(state.notes).length);
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
    bindEvents();
    listenForChanges();
    applyPageTheme();
    loadCurrentTab(function (tabError) {
      if (tabError) {
        showToast('无法读取当前标签页：' + tabError.message);
      }
      FN.loadAll(function (loadError, data) {
        if (loadError) {
          showToast('读取备注失败：' + loadError.message);
        } else {
          state.settings = data.settings;
          state.notes = data.notes;
        }
        renderAll();
        autoReveal();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
