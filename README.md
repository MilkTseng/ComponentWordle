# ComponentWordle

ComponentWordle 是一款以繁體中文部件作為猜測元素的 Wordle 類型遊戲。玩家需要在 6 次機會內，按照正確順序組合出由 5 個部件構成的謎底。

## 功能

- 以綠、黃、灰三種顏色提示部件位置與存在狀態
- 顯示目前輸入部件的組字參考
- 支援淺色與深色主題
- 可複製 Emoji 格式的遊戲結果
- 題目、鍵盤與組字資料皆由 JSON 載入

## 專案結構

```text
ComponentWordle/
├── index.html       # 網頁結構
├── styles.css       # 自訂樣式
├── app.js           # 遊戲邏輯
├── game-data.json   # 題目、鍵盤與組字資料
└── README.md
```

## 執行方式

專案透過 `fetch()` 載入 `game-data.json`，請使用網頁伺服器而不是直接雙擊 `index.html` 開啟。

```bash
cd ComponentWordle
python3 -m http.server 4173
```

然後在瀏覽器開啟：

<http://localhost:4173>

## 資料設定

遊戲資料存放於 `game-data.json`，主要包含：

- `targetPuzzle`：本局謎底與部件順序
- `standaloneComponents`：可單獨成字的部件
- `keyboardRows`：鍵盤顯示的部件與變形
- `charCombos`：部件組合、對應漢字與 `zhuyin` 注音陣列（同字有多種讀音時會保留全部讀音）

修改資料後重新整理瀏覽器即可套用。

## 技術

- HTML
- CSS
- JavaScript
- Tailwind CSS
- JSON
