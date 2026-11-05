# Brave-style YouTube AdBlock

Extension MV3 mô phỏng cách Brave 1.96.60 chặn quảng cáo YouTube, dựng từ dữ liệu filter/scriptlet thực tế trên máy.

## Nguồn nghiên cứu

| Thành phần | Đường dẫn |
|---|---|
| uBO filters Brave dùng | `~/Library/Application Support/BraveSoftware/Brave-Browser/iodkpdagapdfkphljnddpjlldadblomo/1.0.23459/list.txt` (dòng 12–43) |
| Scriptlet resources | `.../mfddibmblmbccpadfndgakiopmmhebop/1.0.155/resources.json` |
| Engine đã compile | `.../Default/adblock_cache/engine0.dat`, `engine1.dat` |
| Bản sao trong repo | `research/raw/`, `research/brave-scriptlets/` |

## Brave làm gì → extension làm gì

| Brave filter/scriptlet | File trong extension |
|---|---|
| `trusted-replace-xhr-response` / `trusted-rpfr` cho `adPlacements`, `adSlots` | `src/main.js` (rewrite fetch + XHR) |
| `set ytInitialPlayerResponse.playerAds/adPlacements/adSlots undefined` | `src/main.js` (hook global setter) |
| `json-prune playerResponse.adPlacements …` | `src/main.js` (`prune` + `JSON.parse`/`Response.json`) |
| `json-prune-fetch-response reelWatchSequenceResponse…isAd` | `src/main.js` (prune mảng ad) |
| `trusted-click-element`, auto skip | `src/main.js` (`tick`) |
| `brave-yt-sabr-fix.js` | `src/main.js` (`sabrFetch`, `patchBackoff`) |
| `brave-youtube-navigation-fix.js` | `src/main.js` (`performance.now` monotonic) |
| Anti-adblock `rpnt` (UA markers, stall, `onAbnormalityDetected`) | `src/main.js` (`rotateMarker`, `requestReload`, `handlePlayer`, `dismissInterruption`) |
| `*_ad_$media,domain=youtube.com,3p` | `rules/dnr.json` (rule 2) |
| `||googlevideo.com/initplayback?source=youtube&*c=TVHTML5&*oad=` | `rules/dnr.json` (rule 1) |
| Cosmetic selectors | `src/yt.css` + `clearFeed` |

## Cấu trúc

```
manifest.json          MV3, content script MAIN world + fallback
background.js          inject MAIN world khi webNavigation.onCommitted
rules/dnr.json         declarativeNetRequest (2 rule giống Brave)
src/main.js            logic chính (chạy trong page world)
src/early.js           fallback chèn main.js bằng <script>
src/yt.css             cosmetic filtering
```

## Cài vào Orion (macOS)

1. Mở Orion → menu **Orion → Extensions…** (hoặc ⌘⇧E).
2. Kéo thả thư mục `brave_extension` (thư mục chứa `manifest.json`) vào cửa sổ Extensions. Nếu Orion chỉ nhận file, nén thư mục thành `.zip` rồi kéo thả file đó.
3. Bật extension, mở `https://www.youtube.com` và thử một video có quảng cáo.

### Nếu Orion báo lỗi manifest
Xoá dòng `"world": "MAIN",` trong `manifest.json`. Khi đó `src/main.js` được chèn qua `src/early.js` và `background.js` (world MAIN qua `chrome.scripting`), vẫn chạy được.

## Kiểm chứng

```bash
python3 -m json.tool manifest.json > /dev/null
python3 -m json.tool rules/dnr.json > /dev/null
node --check background.js
node --check src/early.js
node --check src/main.js
```

Thử trên YouTube: quảng cáo đầu/giữa video, banner overlay, feed ad, và màn hình đen 4–16 giây (SABR backoff) — tất cả phải biến mất.

## Nếu vẫn thấy “Experiencing interruptions?”

Đây là hộp thoại chống adblock của YouTube. Extension xử lý theo đúng cách Brave làm:

- Bắt `Map.prototype.has('onSnackbarMessage')` và beacon `Uint8Array` 104/105 byte để biết YouTube vừa phát hiện.
- Luân chuyển UA marker (`channel`, `lactmilli`, `yahi`, `inline`) trong `INNERTUBE_CONTEXT.client.userAgent`, rồi `loadVideoById()` để tạo phiên mới.
- Xoá DOM `ytd-enforcement-message-view-model` / dialog chứa “Experiencing interruptions” và “Ad blockers violate”, sau đó resume video.

Nếu vẫn còn:
1. Tắt các adblocker khác đang bật cùng lúc (uBO, AdGuard, extension khác) vì chúng có thể prune/block trước và làm lệch payload.
2. Tắt VPN/proxy (IP datacenter làm YouTube siết kiểm tra).
3. Tải lại trang một lần (⌘R) để phiên mới đọc marker.
4. Nếu lặp lại quá nhanh, tăng `reloadBudget` trong `src/main.js` (mặc định 12 lần/trang).

## Giới hạn

- Orion dùng WebKit: `declarativeNetRequest` và `world: "MAIN"` có thể không được hỗ trợ đầy đủ; phần chèn script và hook JS vẫn là cơ chế chính.
- Không chặn `youtubei/v1/player/ad_break` ở tầng network (Brave cũng không), tránh làm hỏng SABR.
- YouTube thay đổi payload thường xuyên; danh sách key cần cập nhật theo thời gian.
