/**
 * Seed catalog — ingested from 04_LEVEL_DATA_LEVEL_01.md
 * searchText is pre-normalized (lowercase, diacritics stripped) so the
 * search bar matches Vietnamese, English, Chinese and color keywords.
 */
export const SEED_CATALOG = [
    {
        id: 'flower_cyan_orchid',
        sprite_key: 'flower_cyan',
        name: 'Tinh Trạch U Đàm',
        english: 'Celestial Cyan Orchid',
        colorName: 'Cyan · Xanh',
        color_hex: '#00E5FF',
        petals: 0x7ff7ff,
        growthMs: 15000,
        search_keywords: ['tinh', 'xanh', 'cyan', 'blue', 'orchid', 'lam', 'trạch', 'da', 'u dam', '蓝', '蓝'],
    },
    {
        id: 'flower_purple_wisteria',
        sprite_key: 'flower_purple',
        name: 'Hồng Hà Tiên Chi',
        english: 'Wisteria Celestial Branch',
        colorName: 'Tím · Purple',
        color_hex: '#B26BFF',
        petals: 0xc98bff,
        growthMs: 20000,
        search_keywords: ['hong', 'ha', 'purple', 'tim', 'violet', 'wisteria', 'hoa', 'tím', '紫'],
    },
    {
        id: 'flower_golden_amber',
        sprite_key: 'flower_golden',
        name: 'Đới Ngọc Kim Huyên',
        english: 'Golden Amber Flower',
        colorName: 'Vàng · Gold',
        color_hex: '#FFD700',
        petals: 0xffe08a,
        growthMs: 25000,
        search_keywords: ['vang', 'kim', 'gold', 'dai', 'amber', 'yellow', 'huyn', 'vàng', '金', '黃'],
    },
    {
        id: 'flower_emerald_bamboo',
        sprite_key: 'flower_emerald',
        name: 'Trúc Bích Thanh Hoa',
        english: 'Emerald Jade Flower',
        colorName: 'Lục · Emerald',
        color_hex: '#2E8B57',
        petals: 0x7dffb6,
        growthMs: 10000,
        search_keywords: ['truc', 'luc', 'green', 'emerald', 'jade', 'bich', 'thanh', 'lục', '绿', '綠'],
    },
];

export const SEED_BY_ID = Object.fromEntries(SEED_CATALOG.map((s) => [s.id, s]));

export function normalizeText(str) {
    return String(str ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip diacritics
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd');
}

for (const seed of SEED_CATALOG) {
    seed.searchText = normalizeText(
        [
            seed.id,
            seed.name,
            seed.english,
            seed.colorName,
            seed.color_hex,
            seed.sprite_key,
            ...seed.search_keywords,
        ].join(' ')
    );
}
