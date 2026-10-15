# Call list 爬蟲（2026-10 第一轉用過）

出咗兩份名單（CRM「匯入」直接食得）：
- **builderhk.com（香港建造指南）** → 5,126 間建造／工程／裝修相關公司，分 A–H 八個桶
- **yp.com.hk（黃頁）IoT 方向** → 4S／CCTV、物管／錶商、物流／車隊、停車場／廣告牌、冷鏈

規矩（Kevin 定嘅）：名單淨係用嚟知道有邊啲公司；聯絡用公司總機／公開商業電話；
**政府或專業團體名冊（屋宇署、機電署、消防處、公司註冊處、會財局）唔做 call list**；
打之前喺公司 MIS 查過。新目錄站第一件事睇 `robots.txt`，唔准爬就唔爬。

## 次序

builderhk：`crawl.py`（抓 c1 分類版，HTML 快取喺 `$CRAWL_OUT/html/`）→ `c3map.py` →
`parse.py`／`parse2.py` → `buckets.py`（分桶）→ `build2.py`（中英文版對併）→ `pack.py`／`xlsx.mjs`

黃頁：`yppick.py`（揀分類同關鍵字）→ `ypcrawl2.py`（AJAX `pageno` 分頁，**唔係** `/pN/`）→
`ypparse.py` → `ypbuild.py`

## 要記住

- ❗**快取冇入 repo**（160MB 原始 HTML）。2026-10-14 個 container 一收，快取就冇咗 ——
  黃頁 IoT 嗰轉只掃到 **69／約 212 版**就停咗，要續就要由零再抓（`ypcrawl2.py` 會跳過做咗嘅，
  但冇快取就冇得跳）。
- 對數：builderhk 版面寫住「幾多 result(s)」，parse 完要逐版對返（932 版第一轉全部對得返）。
- 電話：香港號碼 2–9 字頭都收（淨收 2/3/5/6/9 會丟咗 8 字頭、4 字頭號碼）；黃頁第二個號多數係**傳真**，
  要睇 HTML icon 分，唔好估。
- 中英文對併：同一條匙（電話＋傳真）夾中多過一間就**唔併**（集團共用總機好多）。
- `CRAWL_OUT` 環境變數揀輸出資料夾，預設係呢個資料夾。
