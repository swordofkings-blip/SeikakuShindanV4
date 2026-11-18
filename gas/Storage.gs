/**
 * @title スプレッドシート永続化 & CacheService レート制限
 * @description 診断結果の保存・読込・生成待ち更新を LockService で排他制御しつつ行い、セッション単位の連打ガードを CacheService で管理する。
 */

var LOG_HEADERS = [
  'id',
  'createdAt',
  'updatedAt',
  'status',
  'mbtiType',
  'clarityJson',
  'big5Json',
  'qaHistoryJson',
  'evaluationJson',
  'reportJson',
  'modelUsed',
  'totalQuestions'
];

/**
 * セッションごとの API リクエスト上限を検証し、カウンタを増やす。
 * @param {string} sessionId
 * @returns {boolean} 許可される場合は true
 */
function checkAndIncrementSessionRateLimit(sessionId) {
  if (!sessionId) {
    return false;
  }
  var cache = CacheService.getScriptCache();
  var key = 'rate_' + sessionId;
  var current = Number(cache.get(key) || '0');
  if (current >= APP_CONFIG.MAX_REQUESTS_PER_SESSION) {
    return false;
  }
  cache.put(key, String(current + 1), APP_CONFIG.SESSION_CACHE_TTL_SEC);
  return true;
}

/**
 * 共有・保存用の短いユニークIDを生成する。
 * @returns {string}
 */
function generateResultId() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

/**
 * 診断結果を Logs シートへ保存する。
 * @param {Object} record
 * @returns {string} 保存されたID
 */
function saveDiagnosisResult(record) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateLogSheet_();
    var now = new Date().toISOString();
    var id = record.id || generateResultId();

    var clarityMap = {};
    var axes = ['E/I', 'S/N', 'T/F', 'J/P'];
    for (var i = 0; i < axes.length; i++) {
      var m = record.evaluation.mbti[axes[i]];
      clarityMap[axes[i]] = { letter: m.letter, clarity: m.clarity, subtype: m.balanceSubtype };
    }

    var rowValues = [
      id,
      now,
      now,
      record.isPending ? 'PENDING_REPORT' : 'COMPLETED',
      record.evaluation.mbtiType,
      JSON.stringify(clarityMap),
      JSON.stringify(record.evaluation.big5),
      JSON.stringify(record.qaHistory),
      JSON.stringify(record.evaluation),
      JSON.stringify(record.report),
      record.modelUsed || '',
      record.qaHistory.length
    ];

    sheet.appendRow(rowValues);
    return id;
  } finally {
    lock.releaseLock();
  }
}

/**
 * ID から保存済み診断結果を取得する。
 * @param {string} id
 * @returns {Object|null}
 */
function getDiagnosisResultById(id) {
  if (!id) {
    return null;
  }
  var sheet = getOrCreateLogSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var row = sheet.getRange(i + 2, 1, 1, LOG_HEADERS.length).getValues()[0];
      return {
        id: row[0],
        createdAt: row[1],
        updatedAt: row[2],
        status: row[3],
        isPending: row[3] === 'PENDING_REPORT',
        mbtiType: row[4],
        qaHistory: JSON.parse(row[7] || '[]'),
        evaluation: JSON.parse(row[8] || '{}'),
        report: JSON.parse(row[9] || '{}'),
        modelUsed: row[10]
      };
    }
  }
  return null;
}

/**
 * 生成待ち（PENDING_REPORT）レコードのレポートを更新する。
 * @param {string} id
 * @param {Object} report
 * @param {string} modelUsed
 * @returns {boolean}
 */
function updateReportInLog(id, report, modelUsed) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getOrCreateLogSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return false;
    }
    var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        var rowIndex = i + 2;
        sheet.getRange(rowIndex, 3).setValue(new Date().toISOString()); // updatedAt
        sheet.getRange(rowIndex, 4).setValue('COMPLETED');               // status
        sheet.getRange(rowIndex, 10).setValue(JSON.stringify(report));   // reportJson
        sheet.getRange(rowIndex, 11).setValue(modelUsed || '');          // modelUsed
        return true;
      }
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

/**
 * PENDING_REPORT 状態のレコードを最大 limit 件取得する。
 * @param {number} limit
 * @returns {Array<Object>}
 */
function getPendingReportRows_(limit) {
  var sheet = getOrCreateLogSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }
  var data = sheet.getRange(2, 1, lastRow - 1, LOG_HEADERS.length).getValues();
  var results = [];
  for (var i = 0; i < data.length; i++) {
    if (data[i][3] === 'PENDING_REPORT') {
      results.push({
        id: data[i][0],
        qaHistory: JSON.parse(data[i][7] || '[]'),
        evaluation: JSON.parse(data[i][8] || '{}')
      });
      if (results.length >= limit) {
        break;
      }
    }
  }
  return results;
}

/**
 * Logs シートを取得、存在しない場合は作成してヘッダーを初期化する。
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('コンテナバインドされたスプレッドシートが見つかりません。');
  }
  var sheet = ss.getSheetByName(APP_CONFIG.LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(APP_CONFIG.LOG_SHEET_NAME);
    sheet.appendRow(LOG_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
