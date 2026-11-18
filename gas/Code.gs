/**
 * @title GAS Web アプリ エントリーポイント & RPC エンドポイント
 * @description HTML 表示（iframe 埋め込み許可）とフロントエンドからの非同期 RPC 呼び出しを処理する。
 */

/**
 * Web アプリの GET リクエストを処理する。
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var tpl = HtmlService.createTemplateFromFile('App');
  tpl.initialId = (e && e.parameter && e.parameter.id) ? String(e.parameter.id) : '';
  tpl.githubPagesBase = APP_CONFIG.GITHUB_PAGES_BASE;

  return tpl.evaluate()
    .setTitle('SeikakuShindan V4 | 深層性格診断')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 初期ロード：保存IDがあれば結果を取得し（生成待ちならオンデマンド再試行）、なければ新規診断の固定質問を返す。
 * @param {string} savedId
 * @returns {Object}
 */
function apiInitSession(savedId) {
  if (savedId) {
    var record = getDiagnosisResultById(savedId);
    if (!record) {
      return { mode: 'not_found', message: '指定された診断結果が見つかりませんでした。' };
    }

    // ハイブリッド解消：生成待ちレコード閲覧時に枠が回復していればオンデマンド生成を試行する
    if (record.isPending) {
      var retry = generateFullReportWithFallback(record.qaHistory, record.evaluation);
      if (!retry.isPending) {
        updateReportInLog(record.id, retry.report, retry.modelUsed);
        record.report = retry.report;
        record.isPending = false;
        record.modelUsed = retry.modelUsed;
      }
    }

    return {
      mode: 'result',
      result: buildClientResultPayload_(record.id, record.isPending, record.evaluation, record.report)
    };
  }

  return {
    mode: 'quiz',
    fixedQuestions: getFixedQuestions(),
    maxTotalQuestions: APP_CONFIG.MAX_TOTAL_QUESTIONS,
    maxAnswerLength: APP_CONFIG.MAX_ANSWER_LENGTH,
    gasWebAppUrl: ScriptApp.getService().getUrl()
  };
}

/**
 * Q4 回答時に裏で実行する累積判定 & Q6 先決め。
 * @param {Object} payload { sessionId, qaList }
 * @returns {Object}
 */
function apiPredecideQ6(payload) {
  validateSessionAndAnswers_(payload);
  var res = evaluateCumulativeAnswers(payload.qaList);
  if (res.injectionDetected) {
    return { injectionDetected: true };
  }
  return {
    injectionDetected: false,
    predecidedQ6: res.nextQuestion,
    isFinished: res.isFinished,
    metrics: res.metrics
  };
}

/**
 * Q6 以降（または先決めフォールバック時）の累積判定・次問選択・終了時レポート生成。
 * @param {Object} payload { sessionId, qaList }
 * @returns {Object}
 */
function apiSubmitAdaptiveStep(payload) {
  validateSessionAndAnswers_(payload);
  var res = evaluateCumulativeAnswers(payload.qaList);
  if (res.injectionDetected) {
    return { injectionDetected: true };
  }

  if (res.isFinished) {
    var reportRes = generateFullReportWithFallback(payload.qaList, res.evaluation);
    var savedId = saveDiagnosisResult({
      qaHistory: payload.qaList,
      evaluation: res.evaluation,
      report: reportRes.report,
      isPending: reportRes.isPending,
      modelUsed: reportRes.modelUsed
    });
    return {
      injectionDetected: false,
      isFinished: true,
      result: buildClientResultPayload_(savedId, reportRes.isPending, res.evaluation, reportRes.report),
      metrics: res.metrics
    };
  }

  return {
    injectionDetected: false,
    isFinished: false,
    nextQuestion: res.nextQuestion,
    metrics: res.metrics
  };
}

/**
 * セッションレート制限と回答文字数上限をサーバー側で強制する。
 * @param {Object} payload
 */
function validateSessionAndAnswers_(payload) {
  if (!payload || !payload.sessionId || !Array.isArray(payload.qaList)) {
    throw new Error('不正なリクエスト形式です。');
  }
  if (!checkAndIncrementSessionRateLimit(payload.sessionId)) {
    throw new Error('セッションあたりのリクエスト上限に達しました。ページを再読み込みしてやり直してください。');
  }
  for (var i = 0; i < payload.qaList.length; i++) {
    var ans = String(payload.qaList[i].answer || '').trim();
    if (!ans) {
      throw new Error('空の回答が含まれています。');
    }
    if (ans.length > APP_CONFIG.MAX_ANSWER_LENGTH) {
      throw new Error('回答は ' + APP_CONFIG.MAX_ANSWER_LENGTH + ' 文字以内で入力してください。');
    }
  }
}

/**
 * クライアント表示用の結果ペイロードを組み立てる。
 * @param {string} id
 * @param {boolean} isPending
 * @param {Object} evaluation
 * @param {Object} report
 * @returns {Object}
 */
function buildClientResultPayload_(id, isPending, evaluation, report) {
  return {
    id: id,
    isPending: isPending,
    evaluation: evaluation,
    report: report,
    shareUrl: APP_CONFIG.GITHUB_PAGES_BASE + '/?id=' + encodeURIComponent(id)
  };
}
