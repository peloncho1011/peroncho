# ぺろんちょOS

個人専用のAI秘書アプリです。画面・基本動作に加え、OpenAI Responses APIによるタスク判断と実行前の確認画面を実装しています。

## 安全上の注意

OpenAI APIキーはコードやGitHubへ保存せず、Vercelの環境変数 `OPENAI_API_KEY` に登録します。

AIは新規タスク、サブタスク、期限変更、優先度変更、完了を提案します。曖昧な場合は確認質問を返し、ユーザーが確認画面で実行するまでデータを変更しません。

## 開発用コマンド

```bash
npm install
npm run dev
```
