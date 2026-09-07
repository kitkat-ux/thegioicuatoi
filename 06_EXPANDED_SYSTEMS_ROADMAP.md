# 06. Kế Hoạch & Thiết Kế Các Tính Năng Mở Rộng (Long-term Gameplay Roadmap)

> **Trạng thái hiện tại (v1.0 — Hoa Viên Tiên Cảnh):** lõi game đã hoàn thiện —
> đảo thiên thạch lơ lửng **Linh Đảo Phù Vân** với lưới đất 6x6, NPC **Tiên Nữ
> Hoa Giang** trên cầu kiều dưới (đối thoại nhiệm vụ), ngăn hạt giống + tìm kiếm
> thời gian thực, tưới nước một chạm (quảng cáo thưởng), liềm thu hoạch,
> kinh tế Đá Linh Khí / Điểm Hòa Hợp và 6 nhiệm vụ cột mốc.
>
# Expanded Systems Roadmap — 10 future systems

| # | System (EN) | Hệ thống (VI) | Mục |
|---|-------------|----------------|----|
| 1 | Multi-biome realms | Đa Hoa Viên | [xem](#1-đa-hoa-viên-multi-biome-realms) |
| 2 | Zen fishing | Linh Đầm Câu Ngư | [xem](#2-linh-đầm-câu-ngư-zen-fishing-minigame) |
| 3 | Beast ranching | Ngự Thú Tiên Viên | [xem](#3-ngự-thú-tiên-viên-spiritual-beast-ranching) |
| 4 | Flower breeding | Lai Tạo Kỳ Hoa Dị Thảo | [xem](#4-lai-tạo-kỳ-hoa-dị-thảo-cross-breeding--mutation) |
| 5 | Alchemy crafting | Lò Luyện Đan & Tiên Trà | [xem](#5-lò-luyện-đan--tiên-trà-alchemy--crafting) |
| 6 | Visitor orders | Tiên Khách Cầu Kiều | [xem](#6-tiên-khách-cầu-kiều-visitor-order-system) |
| 7 | Feng Shui buffs | Phong Thủy Trận Đồ | [xem](#7-phong-thủy-trận-đồ-feng-shui-layout-buffs) |
| 8 | Dynamic weather | Khí Vận & Chu Kỳ Tiết Khí | [xem](#8-khí-vận--chu-kỳ-tiết-khí-dynamic-weather--daynight) |
| 9 | Flora codex | Bách Thảo Đồ Giám | [xem](#9-bách-thảo-đồ-giám-codex--collector-journal) |
| 10 | Idle automation | Tích Lũy Nhàn Rỗi | [xem](#10-tích-lũy-nhàn-rỗi-idle-zen-automation) |

---

## 1. Đa Hoa Viên (Multi-Biome Realms)

- Cơ chế: Mở khóa các vùng đất tu tiên mới khi đạt cấp độ Hòa Hợp cao.

- Các cõi tiên:

  + Băng Phong Cốc: Nền tuyết trắng, đất đóng băng, chuyên trồng Băng Tuyết Liên.

  + Bích Vân Đầm: Mặt nước nổi cánh sen, trồng các loài Thủy Sinh Tiên Thảo.

  + U Hỏa Động: Vách đá dung nham, thích hợp cho ươm mầm Hỏa Diễm Quả.

## 2. Linh Đầm Câu Ngư (Zen Fishing Minigame)

- Vị trí: Tương tác tại mặt hồ nước bên dưới cầu kiều (nơi Tiên Nữ Hoa Giang đang đứng canh).

- Cơ chế: Chạm giữ để quăng cần, thả tay khi phao nhấp nhô để kéo cá.

- Sản vật: Cá Koi Ngũ Sắc, Tiên Quy (rùa tiên), Trai Ngậm Ngọc. Cá có thể thả vào hồ tăng độ sinh động hoặc đổi lấy Linh Thạch.

## 3. Ngự Thú Tiên Viên (Spiritual Beast Ranching)

- Thú nuôi: Thỏ Ngọc, Tiên Hạc, Linh Miêu đi dạo tự do quanh hoa viên.

- Chức năng tự động:

  + Thỏ Ngọc: Nhặt cánh hoa và Linh Thạch rơi vãi.

  + Tiên Hạc: Bay lượn thụ phấn, tăng 10% tỷ lệ nở hoa đột biến.

  + Thức ăn: Chế biến từ hoa thừa và thảo mộc.

## 4. Lai Tạo Kỳ Hoa Dị Thảo (Cross-Breeding & Mutation)

- Cơ chế: Trồng 2 luống hoa khác hệ liền kề nhau có 15% cơ hội sinh ra hạt giống đột biến ở ô đất trống kế bên.

- Phẩm cấp hoa: Phổ Thông -> Quý Hiếm -> Sử Thi -> Thần Thoại (phát sáng lấp lánh ban đêm, thu hoạch được lượng lớn Linh Thạch).

## 5. Lò Luyện Đan & Tiên Trà (Alchemy & Crafting) ✅ ĐÃ TRIỂN KHAI

- Vị trí: Đình viện lầu son phía sau.

- Công thức chế tác:

  + Tiên Trà Tụ Linh: Dùng 5 đóa Lan Xanh + nước suối -> Tăng 50% tốc độ lớn cho toàn vườn trong 10 phút.

  + Tụ Khí Đan: Dùng 10 Dược Thảo -> Bán cho thương nhân đổi kho báu.

**Triển khai (Phase 2):** `src/systems/AlchemyManager.js` (state + rules, thuần
logic, không Phaser) + `src/ui/AlchemyModal.js` (huy hiệu đồng trên HUD tại
(958,462) + overlay đan lô với lửa động). Nguyên liệu đến từ **sự kiện trên bus**:
mỗi `FLOWER_HARVESTED` rơi 1 cánh thảo dược theo loài (U Đàm ← Tinh Trạch U Đàm,
Huyết Kế ← Hồng Hà Tiên Chi, …), hoa được mưa xuân tưới cho +1 Linh Dịch, và mỗi
4 ô `TILE_WATERED` ngưng tụ 1 Linh Dịch. Ba công thức theo bảng Phase-2:
**Tụ Khí Đan** (3× U Đàm + 1 Linh Dịch, 45s, 85% → +20% tốc độ hoa nở trong 10
phút), **Tẩy Tủy Đan** (2× Huyết Kế + 2× U Đàm, 60s, 70% → +15% tỷ lệ đột biến
lai tạo), **Vạn Thọ Linh Dịch** (2× Linh Dịch + 1 Trúc Bích, 30s, 95% → tự động
tưới toàn vườn). Lò một lúc một lần nấu, đồng hồ thời gian thực, tỉ lệ thành
công theo `random()` có thể inject cho test. Đan đã luyện nằm trên kệ đan; khi
dùng, manager phát `ELIXIR_CONSUMED` (tên công khai cố định theo spec) —
`GardenScene` chỉ nghe bus: buff tăng tốc gộp vào `bloomStaggerMs()` cùng buff
Đồ Giám, buff đột biến vào `BreedingManager` qua `mutationBonusProvider`, và
Vạn Thọ gọi `waterAll()` y hệt buff mưa. Trạng thái lưu/nạp bằng
`serialize()/deserialize()`.

## 6. Tiên Khách Cầu Kiều (Visitor Order System)

- Khách vãng lai (Đạo sĩ, Tiên y, Kiếm khách) xuất hiện ngẫu nhiên trên cầu gỗ.

- Mỗi vị khách mang theo 1 đơn đặt hàng thảo dược cụ thể, hoàn thành nhận được vé quay hạt giống hiếm hoặc ngoại trang.

## 7. Phong Thủy Trận Đồ (Feng Shui Layout Buffs)

- Bố cục Ngũ Hành: Kim - Mộc - Thủy - Hỏa - Thổ.

- Khi xếp các loại hoa theo hình bát quái hoặc vòng tương sinh, kích hoạt luồng linh khí bao bọc đất, giảm 20% thời gian tưới nước.

## 8. Khí Vận & Chu Kỳ Tiết Khí (Dynamic Weather & Day/Night) ✅ ĐÃ TRIỂN KHAI

- Chu kỳ ngày/đêm nhẹ nhàng: Ban đêm đèn đá tự thắp sáng, hoa dạ quang phát sáng dịu mắt.

- Tiết khí:

  + Mưa Xuân: Toàn bộ vườn tự động nhận trạng thái đã tưới ẩm.

  + Đêm Trăng Tròn: Tăng gấp đôi điểm Hòa Hợp nhận được khi thu hoạch.

**Triển khai (Phase 1):** `src/systems/WeatherSystem.js` (state) +
`src/vfx/WeatherView.js` (render). Một chu kỳ = 105s (Ngày 45s · Hoàng Hôn 22s ·
Đêm 38s); mỗi 4 chu kỳ sang tiết kế tiếp (Xuân → Hạ → Thu → Đông). Mưa chỉ
xuất hiện ở Tiết Xuân (70% số ngày, 20–38s) và phát `RAIN_IRRIGATE` để
`GardenScene.rainIrrigate()` tưới miễn phí mọi ô đã gieo. Đêm Trăng Tròn
(theo `moonCycle`) trả `harmonyMult = 2` qua `getModifiers()`. Ánh sáng đổi
bằng `lerp` (không nhảy cấp) trên một lớp wash toàn màn hình đặt tại
`LAYERS.AMBIENT`, cộng thêm vầng trăng + quầng sáng, mưa xiên, gợn sóng và âm
mưa nền. Thời tiết **không** gọi thẳng scene: mọi thứ đi qua `EventManager`.

## 9. Bách Thảo Đồ Giám (Codex & Collector Journal) ✅ ĐÃ TRIỂN KHAI

- Cuốn trục thư pháp lưu trữ tiểu sử, tranh vẽ của từng loài hoa đã trồng thành công.

- Cột mốc sưu tập: Tặng danh hiệu, skin Liềm Ngọc Bích, skin Thùng Nước Khảm Vàng.

**Triển khai (Phase 1):** `src/systems/CodexManager.js` (state + buff) +
`src/ui/CodexModal.js` (nút trục trên HUD tại (958,322) và overlay trục giấy dó
cuộn dọc được) + `src/data/codexLore.js` (toàn bộ văn bản Việt: tiểu sử, thơ
Thất Ngôn, bậc thạo, mốc thưởng). Hệ thống học từ gameplay qua bus
(`FLOWER_BLOOMED`, `FLOWER_HARVESTED`) — không đọc scene. Bậc thạo
Mộc Dịch/Linh Cản/Thiên Hương ở 3/8/15 lượt thu hoạch; mốc 1/3/4/5/10/15/20
loài tặng danh hiệu, skin Liềm Ngọc Bích · Thùng Nước Khảm Vàng, và
`harmonyMult`/`growthMult`. `EconomySystem.harvestFlower(seedId, modifiers)`
nhận buff ghép từ **cả** codex **lẫn** thời tiết, nên hai hệ thống không cần
biết nhau. Trạng thái lưu/nạp bằng `serialize()/deserialize()`.

## 10. Tích Lũy Nhàn Rỗi (Idle Zen Automation)

- Guồng nước phong thủy và chuông gió bên vách núi tự động gom giọt linh sương khi người chơi ngoại tuyến (tối đa 8 tiếng).

- Khi đăng nhập lại, chạm vào bình chứa để nhận toàn bộ tài nguyên tích lũy.
