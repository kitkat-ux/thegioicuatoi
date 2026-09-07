/**
 * codexLore — the literary layer of System 9 (Vạn Hoa Đồ Giám / Bách Thảo
 * Đồ Giám, "Flora Codex").
 *
 * Per 06_EXPANDED_SYSTEMS_ROADMAP.md #9, the codex is a calligraphy scroll
 * (trục thư pháp) that stores, for every flower the player has successfully
 * grown: a painted portrait (the game sprite), a short biography (tiểu sử)
 * and a classical poem (thơ). Collection milestones grant titles and tool
 * skins (Liềm Ngọc Bích, Thùng Nước Khảm Vàng).
 *
 * Text policy: Vietnamese only — no stray CJK glyphs (asserted in the test
 * suite), matching the DialogSystem rule. Poems are lục bát / thất ngôn so
 * they read like a translated cổ phong anthology.
 */

/** Per-species lore, keyed by the seedCatalog id. */
export const CODEX_LORE = {
    flower_cyan_orchid: {
        seedId: 'flower_cyan_orchid',
        scrollTitle: 'U Đàm Tĩnh Ảnh',
        epithet: 'Hoa của hồ lặng',
        habitat: 'Bờ đầm Thanh Bích, chân thác Linh Tuyền',
        season: 'Xuân',
        biography:
            'Tinh Trạch U Đàm chỉ nở nơi nước lặng. Tương truyền đóa hoa giữ lại ' +
            'bóng trăng dưới đáy đầm, nên ai chăm hoa nhiều đêm sẽ thấy lòng mình ' +
            'trong lại. Hoa kị nắng gắt, ưa ẩm, hợp với đất vừa được mưa xuân tưới đẫm.',
        poem: {
            title: 'Đàm Hoa',
            lines: [
                'Đàm hoa lặng nở trong sương,',
                'Sắc xanh như nước đọng hương nhiệm màu.',
                'Hồ thu in bóng trăng thâu,',
                'Ai chăm một đóa, quên sầu nghìn thu.',
            ],
        },
        verse: {
            title: 'Đề đàm',
            lines: ['Gạn trong nước đục mà thơm,', 'U đàm một đóa, nuôi mầm nghìn năm.'],
        },
    },
    flower_purple_wisteria: {
        seedId: 'flower_purple_wisteria',
        scrollTitle: 'Tiên Chi Giáng Phàm',
        epithet: 'Nhánh tím rơi từ sông Hồng Hà',
        habitat: 'Sườn đình lầu son, nơi tử đằng buông rủ',
        season: 'Xuân — Hạ',
        biography:
            'Hồng Hà Tiên Chi là dây tử đằng tiên rụng xuống trần. Càng tỉa càng ra ' +
            'hoa, càng sai quả; hoa rủ thành từng chuỗi như dải lụa. Người trồng ' +
            'thường buộc dây ngọc bích cho chuỗi hoa thẳng thớm, gọi là trâm cài.',
        poem: {
            title: 'Tử Đằng',
            lines: [
                'Tím hồng một nhánh tiên chi,',
                'Rủ như mây tím, rơi gì xuống sen.',
                'Hồng Hà đêm thắp đèn lên,',
                'Hoa rơi trên tóc, ta quên đường về.',
            ],
        },
        verse: {
            title: 'Đề đằng',
            lines: ['Nở rồi lại rụng vì ai,', 'Tím cả một dải lụa dài Hồng Hà.'],
        },
    },
    flower_golden_amber: {
        seedId: 'flower_golden_amber',
        scrollTitle: 'Kim Huyên Trãi Ưu',
        epithet: 'Hoa quên buồn',
        habitat: 'Thềm nắng sau đình, đất pha son vàng',
        season: 'Hạ',
        biography:
            'Đới Ngọc Kim Huyên mang nhựa trong như hổ phách, ai chạm tay vào thấy ' +
            'ấm. Cổ thư chép: trồng kim huyên trước cửa thì mẹ quên nỗi nhớ con, ' +
            'nên hoa còn có tên là nghi Nam chi — hoa nên trồng nơi sân đông nhất.',
        poem: {
            title: 'Huyên Đường',
            lines: [
                'Kim huyên một đóa nở vàng,',
                'Quên ưu, quên cả mộng tàn đêm qua.',
                'Ngọc đai thắt ngọn nắng xa,',
                'Sân đình hoa trải, lòng ta thái hòa.',
            ],
        },
        verse: {
            title: 'Đề huyên',
            lines: ['Kim huyên nở giữa nắng dài,', 'Quên ưu, quên não, ngày ngày an nhiên.'],
        },
    },
    flower_emerald_bamboo: {
        seedId: 'flower_emerald_bamboo',
        scrollTitle: 'Trúc Bích Thanh Âm',
        epithet: 'Tiếng ngọc trong lá',
        habitat: 'Rìa trúc phía tây, đất ẩm mép đá',
        season: 'Tứ thời',
        biography:
            'Trúc Bích Thanh Hoa lớn nhanh nhất hoa viên, là loài giữ đất cho mọi ' +
            'giống khác. Trồng xen một hàng trúc bích thì hoa lân cận ít sâu, rễ ' +
            'chặt, và mỗi cơn gió qua lá nghe như tiếng chuông gió đá.',
        poem: {
            title: 'Trúc Bích',
            lines: [
                'Trúc biếc in hoa sắc ngọc lành,',
                'Bốn mùa xuân ở tận cành xanh.',
                'Gió khua tiếng điệp rơi thềm vắng,',
                'Mầm đất nuôi hoa, hoa dưỡng lòng.',
            ],
        },
        verse: {
            title: 'Đề trúc',
            lines: ['Trúc ngay, hoa thật, thế thôi,', 'Xanh từ trong lá, xanh ngoài tâm can.'],
        },
    },
    flower_rare_nguyet_cuc: {
        seedId: 'flower_rare_nguyet_cuc',
        scrollTitle: 'Thiên Hà Dạ Sắc',
        epithet: 'Đóa sao của sông Ngân',
        habitat: 'Chỉ nở dưới trăng, nơi cao ráo gần cầu kiều',
        season: 'Thu — Đêm trăng tròn',
        biography:
            'Nguyệt Cúc Thiên Hà là loài hiếm: hạt cần ủ lạnh một đêm, cây cần ' +
            'đất sạch và tuyệt đối không bón vội. Khi nở, hoa tự phát sáng dịu ' +
            'mắt, và người xưa tin ai trồng đủ năm đóa sẽ được đọc trọn cuốn ' +
            'Bách Thảo Đồ Giám.',
        poem: {
            title: 'Nguyệt Cúc',
            lines: [
                'Nguyệt cúc nở giữa sông Ngân,',
                'Sắc ngân như thủy, ánh trăng như hồn.',
                'Ai trồng một đóa cô đơn,',
                'Trời trao cả dải sao tròn về tay.',
            ],
        },
        verse: {
            title: 'Đề cúc',
            lines: ['Sông Ngân gói trọn một đóa hoa,', 'Nguyện người giữ lấy trăng hòa đôi ta.'],
        },
    },
};

/** The poem the codex writes once the whole scroll is complete. */
export const FULL_COLLECTION_POEM = {
    title: 'Vạn Hoa Ca',
    lines: [
        'Một hạt gieo xuống đất tiên,',
        'Hai đóa nở, ba bốn nghìn hoa thơm.',
        'Trục thư khép lại muôn phần,',
        'Tay người chăm chút, hóa thần hoa viên.',
    ],
};

/**
 * Per-species mastery tiers, driven by harvest count of that species.
 * All effects are actually applied by GardenScene (see applyCodexBuffs).
 */
export const MASTERY_TIERS = [
    {
        tier: 1,
        key: 'moc_dich',
        name: 'Mộc Dịch',
        atHarvests: 3,
        effect: { harmonyBonus: 1 },
        gain: '+1 ✿ Hòa Hợp cho mỗi lần thu hoạch loài này',
        note: 'Mầm non quen tay người, nhựa căng hơn.',
    },
    {
        tier: 2,
        key: 'linh_can',
        name: 'Linh Căn',
        atHarvests: 8,
        effect: { stoneBonus: 1 },
        gain: '+1 💎 Đá Linh Khí cho mỗi lần thu hoạch loài này',
        note: 'Rễ bám đá, hút được mạch linh khí.',
    },
    {
        tier: 3,
        key: 'thien_huong',
        name: 'Thiên Hương',
        atHarvests: 15,
        effect: { harmonyBonus: 2, nightGlow: true },
        gain: '+2 ✿ Hòa Hợp, và hoa sáng dạ quang dịu mắt ban đêm',
        note: 'Hương hoa quyện sương, đêm tự tỏa quang.',
    },
];

/**
 * Collection milestones (per roadmap #9: "Cột mốc sưu tập: Tặng danh hiệu,
 * skin Liềm Ngọc Bích, skin Thùng Nước Khảm Vàng").
 * `at` is the number of discovered species.
 */
export const CODEX_MILESTONES = [
    {
        id: 'first_page',
        at: 1,
        title: 'Khai Hoa Bút Ký',
        rewardText: 'Trục thư mở trang đầu · +3 ✿',
        harmony: 3,
        effect: {},
    },
    {
        id: 'two_flowers',
        at: 2,
        title: 'Hoa Viên Tản Khách',
        rewardText: 'Danh hiệu · +5% Hòa Hợp mỗi vụ thu hoạch',
        effect: { harmonyMult: 0.05 },
    },
    {
        id: 'three_flowers',
        at: 3,
        title: 'Bách Thảo Tri Âm',
        rewardText: 'Danh hiệu · +10% Hòa Hợp, +1 💎 mỗi lần thu hoạch',
        effect: { harmonyMult: 0.1, stoneBonus: 1 },
    },
    {
        id: 'four_flowers',
        at: 4,
        title: 'Ngự Hoa Tiên Sử',
        rewardText: 'Skin Liềm Ngọc Bích · lớn nhanh 15%',
        effect: { harmonyMult: 0.12, growthMult: 0.85, skin: 'sickle_jade' },
    },
    {
        id: 'five_flowers',
        at: 5,
        title: 'Vạn Hoa Chủ Biên',
        rewardText: 'Skin Thùng Nước Khảm Vàng · +20% Hòa Hợp · lớn nhanh 30%',
        effect: { harmonyMult: 0.2, growthMult: 0.7, skin: 'bucket_gold', poem: true },
    },
];

/** HUD/tooltip copy for the codex scroll button. */
export const CODEX_UI = {
    buttonLabel: 'Đồ Giám',
    buttonTooltip: 'Vạn Hoa Đồ Giám — trục thư bách thảo',
    header: 'VẠN HOA ĐỒ GIÁM',
    subHeader: 'Bách Thảo Đồ Giám · trục thư sưu tập hoa tiên',
    lockedName: 'Giống hoa chưa khám phá',
    lockedText: 'Gieo hạt, tưới nước và thu hoạch để chép loài này vào trục thư ✦',
    closeLabel: '✦ Cuốn Trục Lại',
};
