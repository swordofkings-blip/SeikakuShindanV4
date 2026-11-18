# 実証実験環境 (`test/`)

GAS 上で Gemini Decisions API (`gemini-decision-1`) の挙動・確率・レイテンシを実験実証するための環境です。
API キーをローカルファイルやチャット履歴に残さず、GAS の「スクリプト プロパティ」のみを使用して安全に検証できます。

## セットアップ & 実行手順

1. **GAS プロジェクトを新規作成**（[Google Apps Script](https://script.google.com/)）
2. **API キーを登録**
   - 左メニューの「プロジェクトの設定（歯車アイコン）」＞「スクリプト プロパティ」を開く
   - プロパティ：`GEMINI_API_KEY`
   - 値：Google AI Studio の API キーを入力して保存
3. **実験スクリプトを配置**
   - [TestDecisions.gs](./TestDecisions.gs) の内容を GAS エディタのコードファイルに貼り付けて保存
4. **実行してログ確認**
   - 上部ツールバーの実行関数から `runExperimentAll`（または `runCase1_ClearType` 〜 `runCase4_PersonaSplit`）を選択して「実行」
   - 実行ログに出力される以下の指標を確認：
     - レイテンシ（ms）とトークン数（`output_tokens` が `0` であること）
     - MBTI 4軸の `choice`・`confidence`・`probabilities`
     - 両極エピソード有無 `noul`（Case 2 と Case 3 で差が出るか）
     - ビッグファイブ 5因子の `score`（0〜4）と材料十分 `noul`（特に神経症傾向の検知）
     - ペルソナ乖離ケース（Case 4）で「仮面の社交・計画」に引っ張られず「素の I/P」を拾えるか

## 出力結果を共有する場合

API キーはログに出力されない設計になっています。実行ログのテキストだけをそのままコピーして共有いただければ、その結果をもとにしきい値や `instructions` / `criteria` のチューニングを行えます。
