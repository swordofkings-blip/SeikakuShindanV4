/**
 * @title SeikakuShindanV4 本番設定定数
 * @description API エンドポイント、モデル階梯、判定しきい値、各種キャップを集約する。
 */

var APP_CONFIG = {
  // --- API エンドポイント ---
  DECISION_ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/decisions',
  GENERATE_CONTENT_BASE: 'https://generativelanguage.googleapis.com/v1beta/models/',

  // --- 使用モデル ---
  DECISION_MODEL: 'gemini-decision-1',
  // レポート生成は上位モデルの枠枯れに備えて自動格下げする
  REPORT_MODELS: [
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3-flash-preview'
  ],

  // --- 判定しきい値（GeminiAPI_test および本番実測に基づく調整値） ---
  CONFIDENCE_THRESHOLD: 0.80,      // 片側確定とする確信度
  CLEAR_CONFIDENCE_THRESHOLD: 0.95,// 明確度ラベル「はっきり」の境界
  BALANCE_MIN: 0.35,               // 拮抗圏の下限確率（使い分け型も含めて拾うため 35〜65% に調整）
  BALANCE_MAX: 0.65,               // 拮抗圏の上限確率
  BALANCE_CHECK_MAX_CONF: 0.75,    // 境界付近でバランス確認質問を追加出題する上限確信度
  BOTH_POLES_THRESHOLD: 0.50,      // 両極エピソード・使い分けありとみなす noul しきい値
  BAL_SWITCH_THRESHOLD: 0.55,      // 使い分け型(X)と未分化型(Y)を分ける bal_switch noul しきい値
  BIG5_SUFF_THRESHOLD: 0.30,       // ビッグファイブ材料十分とみなす noul しきい値
  INJECTION_THRESHOLD: 0.80,       // プロンプトインジェクション検知しきい値

  // --- 出題キャップ（キャップ優先で打ち切り） ---
  MAX_QUESTIONS_PER_AXIS: 3,       // MBTI 各軸の上限問数（固定1 + 適応2。BALは例外+1可）
  MAX_TOTAL_QUESTIONS: 12,         // 診断全体の最大質問数

  // --- セキュリティ・濫用ガード ---
  MAX_ANSWER_LENGTH: 1000,         // 1問あたりの最大文字数
  MAX_REQUESTS_PER_SESSION: 30,    // 1セッションあたりの最大API呼び出し回数
  SESSION_CACHE_TTL_SEC: 3600,     // CacheService 保持秒数（1時間）

  // --- 外部アセット・共有URL ---
  GITHUB_PAGES_BASE: 'https://swordofkings-blip.github.io/SeikakuShindanV4',
  IMAGE_PATH_PREFIX: 'https://swordofkings-blip.github.io/SeikakuShindanV4/assets/images/questions/',

  // --- スプレッドシート設定 ---
  LOG_SHEET_NAME: 'Logs'
};
