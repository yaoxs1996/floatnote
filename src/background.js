/*
 * 浮笺 · 后台服务
 * 只负责首次安装时写入默认设置，不收集或上传任何数据。
 */
(function () {
  'use strict';

  var SETTINGS_KEY = 'floatnote.settings.v1';
  var DEFAULT_SETTINGS = {
    schemaVersion: 1,
    corner: 'top-right',
    customX: null,
    customY: null,
    width: 360,
    height: null,
    theme: 'auto'
  };

  chrome.runtime.onInstalled.addListener(function () {
    chrome.storage.local.get([SETTINGS_KEY], function (result) {
      if (chrome.runtime.lastError) {
        return;
      }
      if (!result || !result[SETTINGS_KEY]) {
        var payload = {};
        payload[SETTINGS_KEY] = DEFAULT_SETTINGS;
        chrome.storage.local.set(payload);
      }
    });
  });
})();
