# 07_VISUAL_ASSET_CATALOG.md
# Danh Mục Đặc Tả Tài Nguyên Mỹ Thuật (Visual Asset Specs)

Tài liệu này chuẩn hóa toàn bộ câu lệnh tạo ảnh (Prompt), phong cách mỹ thuật và thông số tích hợp giao diện cho dự án Hoa Viên Tiên Cảnh. Nghiêm cấm thay đổi phong cách vẽ nếu không có chỉ định.

---

## 1. PHONG CÁCH CHỦ ĐẠO (GLOBAL ART DIRECTION)
- **Thể Loại:** Cổ Phong Tiên Hiệp (Guofeng Xianxia / Oriental Fantasy).
- **Gam Màu Chủ Đạo:** Tím tử đằng (#8A5FA8), Lam ngọc bích (#25A996), Vàng kim hoàng gia (#DFB15B), Nước hồ thanh bích (#367B88).
- **Ánh Sáng:** Ethereal soft rim lighting, phát quang linh khí dịu nhẹ, không dùng đổ bóng gắt 3D thực tế.

---

## 2. BẢNG MẪU PROMPT TẠO ẢNH CHUẨN STUDIO

### A. Nhân Vật & Linh Thú (Sprites)
1. **Tiên Nữ Hoa Giang (`npc_fairy.png`):**
   - *Prompt:* "Full body sprite, Guofeng Xianxia female fairy goddess, ethereal floating flying pose, drifting translucent silk ribbons, lavender and white celestial robes, facing left, soft rim lighting, intricate jade hairpin ornaments, dynamic cloth physics, masterpiece game character sprite --isolated on pure solid black background #000000 --no shadows on ground, no checkerboard, no grid patterns"
   - *Quy cách:* 512x512 PNG, cắt nền RGBA sạch, anchor (0.5, 0.8), tọa độ: (x: 890, y: 1345).

2. **Linh Thú Mộng Điệp (`sprite_mong_diep.png`):**
   - *Prompt:* "Cyan and jade glowing spiritual butterfly, translucent wings with glowing celestial dust particles, fantasy creature sprite --isolated on pure solid black background #000000"
   - *Quy cách:* 128x128 PNG, RGBA, idle tween vỗ cánh và lượn quanh vườn.

### B. Bối Cảnh & Kiến Trúc (Background & Architecture)
1. **Thanh Khê Hoa Uyển (`bg_garden_base.png`):**
   - *Prompt:* "Mobile portrait 9:16 vertical view, Xianxia celestial garden estate, two-story wooden pavilion with curved eaves and glowing lanterns, wisteria flowers blooming, crystal clear jade lake with floating water lilies, traditional wooden covered bridge, tranquil waterfalls in distant misty mountains, aesthetic anime painting style, high resolution, peaceful atmosphere"
   - *Quy cách:* 1080x1920 WebP/PNG, nén < 400KB.

2. **Bệ Đá Phù Vân (`grid_pedestal.png`):**
   - *Prompt:* "Isometric 2.5D floating celestial stone island platform, carved white marble and jade edges, ancient cloud reliefs, rich spiritual fertile brown soil divided into 6x6 subtle plots, floating above water with soft elevation --isolated on black background #000000"

### C. Giao Diện & Nút Thao Tác (UI Icons - 128x128 PNG)
1. **Nút Hạt Giống (`icon_seed_chest.png`):**
   - *Prompt:* "Ancient Guofeng wooden seed chest, gold filigree trim, glowing jade drawers, fantasy mobile game icon --isolated on black background #000000"
2. **Nút Liềm Long Nguyệt (`icon_sickle.png`):**
   - *Prompt:* "Jade sickle with carved gold dragon handle, glowing sharp crescent blade, mythical harvest tool icon --isolated on black background #000000"
3. **Nút Thùng Linh Dịch (`icon_water_bucket.png`):**
   - *Prompt:* "Celestial bronze bucket filled with bubbling glowing cyan spiritual water, ornate handle, mobile game icon --isolated on black background #000000"

---

## 3. QUY TRÌNH HẬU KỲ BẮT BUỘC (PIPELINE)
1. Tạo ảnh với cờ nền đen thuần: `--isolated on pure solid black background #000000`.
2. Chạy lệnh script Alpha Matting (Python rembg / Node sharp) bóc tách toàn bộ pixel nền đen thành Alpha = 0.
3. Kiểm tra 4 góc ảnh: Đảm bảo không tồn tại viền ô caro xám trắng giả lập trong suốt.
4. Ghi trực tiếp vào thư mục `public/assets/images/`.
