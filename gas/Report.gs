/**
 * @title レポート生成 & 枠枯れフォールバック（簡易レポート・ハイブリッド解消）
 * @description 生成モデルのフォールバック階梯で構造化JSONレポートを生成する。枠枯れ時は軸別合成の簡易レポートを返し、後日トリガーまたはオンデマンドで解消する。
 */

// 16タイプ固有のラベル（デイビッド・カーシーの気質分類に基づく呼称。Xを含まないタイプのみ付与）
var ARCHETYPE_LABELS_16 = {
  INTJ: '建築家',
  INTP: '立案者',
  ENTJ: '陸軍元帥',
  ENTP: '発明家',
  INFJ: '助言者',
  INFP: '治療者',
  ENFJ: '教師',
  ENFP: '優勝者',
  ISTJ: '調査官',
  ISFJ: '保護者',
  ESTJ: '監督者',
  ESFJ: '供給者',
  ISTP: '工芸家',
  ISFP: '作曲家',
  ESTP: '発起人',
  ESFP: '演者'
};

var AXIS_FRAGMENTS = {
  'E/I': {
    E: '人との会話や外の世界の刺激からエネルギーを得る外向的な推進力を持っています。',
    I: '一人の静かな時間と内省によって深く思考を練り上げ、エネルギーを回復します。',
    X: '人と関わる場面と一人の時間の両方に適応でき、状況に応じてエネルギーの向きを切り替えられる使い分け型です。',
    Y: '外向的な一面と内向的な一面がどちらも自然に混在しており、まだどちらかに固定されきっていない未分化・探索の余白があります。'
  },
  'S/N': {
    S: '目の前の具体的な事実や実践的な手順を大切にし、地に足のついた判断ができます。',
    N: '抽象的なアイデアや全体の意味・可能性を連想し、まだ形になっていない未来を描けます。',
    X: '現実のディテールを押さえる力と、抽象的な発想を広げる力を場面や役割に応じて使い分けられます。',
    Y: '現実的な視点と抽象的な発想の両方が混在しており、状況や気分によって揺らぎながらバランスを探っている状態です。'
  },
  'T/F': {
    T: '論理的な整合性や公平なルールを軸に、感情に流されすぎず冷静に課題を整理できます。',
    F: '相手の気持ちや場の調和を敏感に汲み取り、人への共感と寄り添いを軸に判断できます。',
    X: '客観的なロジックでの整理と、人の心情に寄り添う判断の両面を相手や場面によって出し分けられます。',
    Y: '論理的な視点と共感的な視点の両方が自然に混ざり合っており、まだどちらを主軸にするか固定されていない柔軟な状態です。'
  },
  'J/P': {
    J: '見通しを立てて計画的に前倒しで進め、物事をきっちり着地させる力に長けています。',
    P: '予定を固めすぎず余白を残し、その場の変化や直前の勢いに合わせて柔軟に動けます。',
    X: '計画的に進める秩序感と、状況に合わせて柔軟に動くしなやかさを重要度や場面で使い分けられます。',
    Y: '計画的に動く側面と気分や流れに任せる側面の両方が混在しており、環境や時期によって変化しやすい余白があります。'
  }
};

/**
 * 判定結果と全Q&A履歴からAIレポートを生成する。全モデル失敗時は簡易レポートを返す。
 * @param {Array<Object>} qaList
 * @param {Object} evaluation
 * @returns {Object} { isPending, modelUsed, report }
 */
function generateFullReportWithFallback(qaList, evaluation) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return { isPending: true, modelUsed: null, report: buildSimpleReport(evaluation) };
  }

  var prompt = buildReportPrompt_(qaList, evaluation);
  var models = APP_CONFIG.REPORT_MODELS;
  var startMs = Date.now();
  var MAX_TOTAL_GEN_MS = 28000; // GAS RPCタイムアウト前に高速モデルへ逃がすための経過上限

  for (var i = 0; i < models.length; i++) {
    var model = models[i];
    // すでに時間が押している場合は中間モデルを飛ばし、末尾の高速モデルだけ試す
    if (i > 0 && i < models.length - 1 && (Date.now() - startMs) > MAX_TOTAL_GEN_MS) {
      continue;
    }
    try {
      var reportJson = callGenerateContentJson_(apiKey, model, prompt);
      if (reportJson && reportJson.summary) {
        if (!reportJson.typeLabel) {
          reportJson.typeLabel = resolveTypeLabel_(evaluation);
        }
        return { isPending: false, modelUsed: model, report: reportJson };
      }
    } catch (err) {
      Logger.log('Report model failed (' + model + '): ' + err.message);
    }
  }

  // 全モデルの枠が枯渇／エラー時は簡易レポートを即時返し、生成待ちフラグを立てる
  return {
    isPending: true,
    modelUsed: null,
    report: buildSimpleReport(evaluation)
  };
}

/**
 * Gemini generateContent API を呼び出して JSON パース済みオブジェクトを返す。
 * @param {string} apiKey
 * @param {string} model
 * @param {string} prompt
 * @returns {Object}
 */
function callGenerateContentJson_(apiKey, model, prompt) {
  var url = APP_CONFIG.GENERATE_CONTENT_BASE + encodeURIComponent(model) + ':generateContent';
  var payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.7
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var res = UrlFetchApp.fetch(url, options);
  var status = res.getResponseCode();
  if (status !== 200) {
    throw new Error('HTTP ' + status + ': ' + res.getContentText().slice(0, 300));
  }

  var data = JSON.parse(res.getContentText());
  var text = data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;

  if (!text) {
    throw new Error('Empty response text from ' + model);
  }
  return JSON.parse(text);
}

/**
 * レポート生成用プロンプトを構築する。
 * @param {Array<Object>} qaList
 * @param {Object} evaluation
 * @returns {string}
 */
function buildReportPrompt_(qaList, evaluation) {
  var typeLabel = resolveTypeLabel_(evaluation);
  var mbtiLines = [];
  var axes = ['E/I', 'S/N', 'T/F', 'J/P'];
  for (var i = 0; i < axes.length; i++) {
    var m = evaluation.mbti[axes[i]];
    var line = '- ' + m.axis + ': ' + m.letter + '（明確度:' + m.clarity + ' / ' +
      m.p1 + '=' + Math.round(m.p1Prob * 100) + '% vs ' + m.p2 + '=' + Math.round(m.p2Prob * 100) + '%';
    if (m.balanceSubtype) {
      line += ' / バランス傾向:' + m.balanceSubtype;
    }
    line += '）';
    mbtiLines.push(line);
  }

  var big5Lines = [];
  var bCodes = ['E', 'O', 'C', 'A', 'N'];
  for (var j = 0; j < bCodes.length; j++) {
    var b = evaluation.big5[bCodes[j]];
    big5Lines.push('- ' + b.label + ': ' + b.score100 + '点 / 100');
  }

  var qaLines = [];
  for (var k = 0; k < qaList.length; k++) {
    var q = qaList[k];
    qaLines.push('[' + q.id + ' | 場面:' + q.sceneTag + '] Q: ' + q.question + '\nA: ' + q.answer);
  }

  return [
    'あなたは精密で温かみのある性格分析ライターです。以下の判定結果と回答履歴をもとに、受検者本人の心に刺さる日本語の詳細性格レポートを JSON 形式で生成してください。',
    '',
    '【重要な執筆ルール】',
    '1. 本診断は独自診断であり、他社サービスの固有名称や定型文は一切使わないこと。',
    '2. 「X（使い分け）」および「Y（未分化）」がある軸は判定失敗ではなく肯定的に扱うこと。「X（使い分け）」の場合は「場面・相手・役割に応じて両方の性質を切り替えられる適応力」として、「Y（未分化）」の場合は「まだ特定の側に固定されきっていない探索の余白がある状態（再診断や環境で変化しやすい柔らかさ）」として、いずれも断定を避けつつ書き分けること。',
    '3. 「仮面（仕事・対人上の振る舞い）」と「素の自分」のギャップが回答から見える場合は、その二層構造（「まわりの印象 vs 本当の内側」）を具体的に読み解くこと。',
    '4. 回答中の具体的なエピソードや言葉遣いを引用・参照し、誰にでも当てはまる一般論ではなく「この人だけのレポート」にすること。',
    '5. 読みやすさのため、各セクション内で適度に **太字強調**、__下線__、*斜体（心の声やニュアンス）* の記法をバランスよく使うこと（乱用せず1段落に1〜2箇所程度）。',
    '6. 読み応えと視認性を高めるため、各セクションは1つの長い塊にせず、意味のまとまりごとに必ず改行（\\n\\n）を入れて2〜3段落に分けること。',
    '',
    '【判定結果】',
    'タイプ: ' + evaluation.mbtiType + '（ラベル: ' + typeLabel + '）',
    'MBTI 4軸:',
    mbtiLines.join('\n'),
    'ビッグファイブ 5因子:',
    big5Lines.join('\n'),
    '',
    '【回答履歴】',
    qaLines.join('\n\n'),
    '',
    '【出力 JSON スキーマ（厳守）】',
    '{',
    '  "typeLabel": "' + typeLabel + '",',
    '  "catchcopy": "この人の本質を射抜く短いキャッチコピー（25文字以内）",',
    '  "summary": "全体像の総括（350〜450字・2〜3段落に改行分け）",',
    '  "impressionVsInner": "まわりからの印象（仮面）と本当の内側（素の自分）の二層構造の読み解き（350〜450字・2〜3段落に改行分け）",',
    '  "strengths": "強みと輝く場面（300〜400字・2段落以上に改行分け）",',
    '  "weaknesses": "弱みと疲れやすい場面・注意点（300〜400字・2段落以上に改行分け）",',
    '  "workStyle": "仕事・課題への取り組みスタイル（280〜360字・2段落に改行分け）",',
    '  "relationships": "対人関係・コミュニケーションの傾向（280〜360字・2段落に改行分け）",',
    '  "growthTips": "今後に向けた実践的なヒント（280〜360字・2段落に改行分け）",',
    '  "aruaru": ["この人ならではの日常あるある1", "あるある2", "あるある3", "あるある4"],',
    '  "big5Analysis": "ビッグファイブ5因子の数値バランスから見える特徴とメンタルの波（320〜420字・2〜3段落に改行分け）",',
    '  "balanceAnalysis": "X（使い分け）またはY（未分化）軸がある場合のみ記述、なければ空文字。回答や確認質問での場面切替・揺らぎを引用しつつ、『X（使い分け型）』か『Y（未分化型）』かを断定せず肯定的に読み解く（250〜350字・2段落に改行分け）",',
    '  "shareComment": "SNSシェア画像に添える一言コメント（40文字以内）"',
    '}'
  ].join('\n');
}

/**
 * 枠枯れ時に即時表示する簡易レポート（軸別定型文の合成）を生成する。
 * @param {Object} evaluation
 * @returns {Object}
 */
function buildSimpleReport(evaluation) {
  var typeLabel = resolveTypeLabel_(evaluation);
  var axes = ['E/I', 'S/N', 'T/F', 'J/P'];
  var fragments = [];
  var balanceNotes = [];

  for (var i = 0; i < axes.length; i++) {
    var m = evaluation.mbti[axes[i]];
    fragments.push(AXIS_FRAGMENTS[axes[i]][m.letter]);
    if (m.letter === 'X' || m.letter === 'Y') {
      balanceNotes.push(axes[i] + '軸は' + (m.letter === 'X' ? '使い分け型（X）' : '未分化型（Y）') + 'です。');
    }
  }

  var b = evaluation.big5;
  var big5Summary =
    '外向性 ' + b.E.score100 + '点 / 開放性 ' + b.O.score100 + '点 / 誠実性 ' + b.C.score100 +
    '点 / 協調性 ' + b.A.score100 + '点 / 神経症傾向 ' + b.N.score100 + '点というバランスです。';

  return {
    isSimple: true,
    typeLabel: typeLabel,
    catchcopy: evaluation.mbtiType === 'XXXX' ? 'すべての境界を自在に行き来する多面体' : typeLabel + 'の視点を持つ人',
    summary: fragments.join(' '),
    impressionVsInner: '詳細な二層分析は AI 詳細レポートの生成完了後に表示されます。',
    strengths: '各軸の明確度とビッグファイブの傾向から、状況に応じた強みを発揮しやすいタイプです。',
    weaknesses: 'エネルギーの消費パターン（外向・内向）やストレス反応（神経症傾向 ' + b.N.score100 + '点）を意識した休息が鍵になります。',
    workStyle: AXIS_FRAGMENTS['S/N'][evaluation.mbti['S/N'].letter] + ' ' + AXIS_FRAGMENTS['J/P'][evaluation.mbti['J/P'].letter],
    relationships: AXIS_FRAGMENTS['E/I'][evaluation.mbti['E/I'].letter] + ' ' + AXIS_FRAGMENTS['T/F'][evaluation.mbti['T/F'].letter],
    growthTips: 'まずは自分の「素で楽な状態」と「外向けに頑張っている状態」を切り分けて意識すると疲れにくくなります。',
    aruaru: [
      '「場面によってキャラが違うね」と言われることがある',
      '一人の時間と人との関わりのバランスが崩れると調子を落としやすい',
      '自分の軸を言語化されると腑に落ちることが多い'
    ],
    big5Analysis: big5Summary,
    balanceAnalysis: balanceNotes.join(' '),
    shareComment: evaluation.mbtiType + '（' + typeLabel + '）'
  };
}

/**
 * 256パターン（16タイプ＋X/Y含む240パターン）の表示ラベルを解決する。
 * @param {Object} evaluation
 * @returns {string}
 */
function resolveTypeLabel_(evaluation) {
  var code = evaluation.mbtiType;
  if (code === 'XXXX') {
    return '全軸使い分けの多面型（レア）';
  }
  if (code === 'YYYY') {
    return '全軸未分化の探索型（レア）';
  }
  if (code.indexOf('X') === -1 && code.indexOf('Y') === -1 && ARCHETYPE_LABELS_16[code]) {
    return ARCHETYPE_LABELS_16[code];
  }

  // X/Yを含む場合は軸別の自作フレーズを合成する
  var parts = [];
  var ei = evaluation.mbti['E/I'].letter;
  var sn = evaluation.mbti['S/N'].letter;
  var tf = evaluation.mbti['T/F'].letter;
  var jp = evaluation.mbti['J/P'].letter;

  parts.push(ei === 'X' ? '両面エネルギー切替' : (ei === 'Y' ? '内省×外向探索中' : (ei === 'E' ? '外向' : '内省')));
  parts.push(sn === 'X' ? '現実×発想切替' : (sn === 'Y' ? '現実×発想探索中' : (sn === 'S' ? '現実派' : '直観派')));
  parts.push(tf === 'X' ? '論理×共感切替' : (tf === 'Y' ? '論理×共感探索中' : (tf === 'T' ? '論理型' : '共感型')));
  parts.push(jp === 'X' ? '計画×柔軟切替' : (jp === 'Y' ? '計画×柔軟探索中' : (jp === 'J' ? '計画派' : '柔軟派')));

  return parts.join('・') + 'タイプ';
}

/**
 * 時間主導トリガー用：生成待ち（PENDING_REPORT）のレコードを順次処理する。
 */
function processPendingReports() {
  var pendingRows = getPendingReportRows_(5); // 1回のトリガー実行で最大5件まで処理し6分制限を回避
  for (var i = 0; i < pendingRows.length; i++) {
    var row = pendingRows[i];
    var res = generateFullReportWithFallback(row.qaHistory, row.evaluation);
    if (!res.isPending) {
      updateReportInLog(row.id, res.report, res.modelUsed);
    } else {
      // 枠が再び詰まった時点でバッチを終了する
      break;
    }
  }
}
