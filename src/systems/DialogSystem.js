/**
 * DialogSystem — NPC dialogue trees with quest-aware branching.
 *
 * Pure data/logic module (no Phaser dependency) so it is unit-testable.
 *
 * The realm guardian NPC delivers quest-aware dialogue that changes based
 * on the player's realm and quest progress. Each realm has 2 daily thematic
 * quests offered via "Nhận Nhiệm Vụ Bí Cảnh".
 */

import { QUESTS } from './EconomySystem.js';
import { getQuestsForRealm } from '../data/RealmQuests.js';

/**
 * Unicode font stack used by every dialog text (khung thoại). system-ui
 * carries full Vietnamese diacritic coverage (Đầu tiên, tất cả, quý hiếm…)
 * so precomposed and combining accents render seamlessly in canvas text.
 */
export const DIALOG_FONT = 'system-ui, -apple-system, sans-serif';

/**
 * Stat key + goal per quest id, used to render the quest list (body of the
 * dialog) with live progress counters.
 */
export const QUEST_TARGETS = {
    first_bloom: { stat: 'totalBlooms', target: 1 },
    green_thumb: { stat: 'totalBlooms', target: 10 },
    full_garden: { stat: 'maxSimultaneousBlooms', target: 36 },
    stone_collector: { stat: 'totalStonesEarned', target: 50 },
    rare_bloom: { stat: 'rareBlooms', target: 1 },
    harvest_master: { stat: 'totalHarvests', target: 50 },
    // Realm-specific quest stat targets
    phuvan_harvest_cymbidium: { stat: 'totalHarvests', target: 10 },
    phuvan_water_queue: { stat: 'totalWaterings', target: 5 },
    frost_plant_ice_lotus: { stat: 'totalPlants', target: 5 },
    frost_feed_frost_beast: { stat: 'beastFeedings', target: 2 },
    nether_harvest_night_crocus: { stat: 'nightHarvests', target: 8 },
    nether_alchemy_elixir: { stat: 'elixirsCrafted', target: 1 },
    flame_plant_flame_fruit: { stat: 'totalPlants', target: 5 },
    flame_upgrade_soil: { stat: 'soilUpgrades', target: 1 },
    celestial_harvest_divine_grade: { stat: 'rareBlooms', target: 1 },
    celestial_harmony_500: { stat: 'totalHarmonyEarned', target: 500 },
};

/**
 * Dialogue nodes for the realm guardian NPC.
 *
 * Each node has:
 * - id: unique identifier
 * - text: the dialogue line (Vietnamese)
 * - choices: array of { text, next } where next is node id or function
 * - questList: optional flag to render live quest list
 * - condition: optional function (questState) => boolean
 */
export const NPC_DIALOGUE = {
    greeting_default: {
        id: 'greeting_default',
        text: 'Chào ngươi, người chăm sóc hoa viên. Ta là {npcName}, người trấn giữ {realmTitle}. Hoa viên hôm nay thật yên bình... ✿',
        choices: [
            { text: 'Nhận Nhiệm Vụ Bí Cảnh 🌸', next: 'quest_offer' },
            { text: 'Ghé Thăm Hoa Các (Cửa Hàng) ✦', next: 'shop_greeting' },
            { text: 'Chỉ ta xem Vạn Hoa Đồ Giám.', next: 'explain_codex' },
            { text: 'Tạm biệt.', next: 'farewell' },
        ],
    },

    greeting_first_visit: {
        id: 'greeting_first_visit',
        text: 'Ồ... lần đầu tiên ngươi đến {realmName}. Nơi này đã chờ đợi người chăm sóc rất lâu. Hãy bắt đầu bằng cách gieo hạt vào những ô đất trống.',
        choices: [
            { text: 'Ta sẽ gieo trồng ngay!', next: 'quest_offer' },
            { text: 'Nơi này thật đẹp...', next: 'lore_garden' },
        ],
    },

    explain_codex: {
        id: 'explain_codex',
        text: 'Vạn Hoa Đồ Giám là cuộn trục thư ghi lại mọi loài hoa ngươi đã trồng thành công. Sưu tập càng đủ, trục thư càng ban nhiều linh khí — danh hiệu, skin Liềm Ngọc Bích và Thùng Nước Khảm Vàng đều nằm trong đó ✦',
        choices: [
            { text: 'Mở Trục Thư ngay ✦', next: 'farewell', action: 'open_codex' },
            { text: 'Để sau, ta trồng hoa đã.', next: 'farewell' },
        ],
    },

    /* ---- Cửa Hàng Hoa Viên (Garden Shop) ---- */

    shop_greeting: {
        id: 'shop_greeting',
        text: 'Tiên hữu ghé thăm Hoa Các, cần tìm bảo giống gì? Ta gom đủ mọi linh chủ quý hiếm — hoặc đổi hoa ngươi thu hoạch lấy Đá Linh Khí.',
        choices: [
            { text: 'Mua hạt giống · Kỳ Hoa Dị Thảo', next: 'farewell', action: 'open_shop_seeds' },
            { text: 'Bán hoa đổi báu · Tiên Thiên Đổi Báu', next: 'farewell', action: 'open_shop_sell' },
            { text: 'Ta chỉ ghé ngang thôi.', next: 'farewell' },
        ],
    },

    /* ---- Realm-specific quest branching ---- */

    quest_offer: {
        id: 'quest_offer',
        text: 'Hôm nay {npcName} có 2 nhiệm vụ bí cảnh ngươi có thể nhận:\n\n{realmQuestText}\n\nHãy chọn để xem chi tiết, hoặc trở về sau.',
        questList: true,
        choices: [
            { text: 'Xem chi tiết nhiệm vụ 1', next: 'quest_details' },
            { text: 'Xem chi tiết nhiệm vụ 2', next: 'quest_details_alt' },
            { text: 'Ta chưa sẵn sàng.', next: 'farewell' },
        ],
    },

    quest_details: {
        id: 'quest_details',
        text: 'Nhiệm vụ của ngươi — hoàn thành để nhận Hòa Hợp, Đá Linh Khí và quà tặng đặc biệt:',
        questList: true,
        choices: [
            { text: 'Nhấn để nhận nhiệm vụ này ✦', next: 'claim_quest_full' },
            { text: 'Quay lại chọn khác', next: 'quest_offer' },
            { text: 'Giải thích thêm', next: 'explain_rewards' },
        ],
    },

    quest_details_alt: {
        id: 'quest_details_alt',
        text: 'Nhiệm vụ thứ hai của hôm nay:',
        questList: true,
        choices: [
            { text: 'Nhấn để nhận nhiệm vụ này ✦', next: 'claim_quest_alt' },
            { text: 'Quay lại chọn khác', next: 'quest_offer' },
            { text: 'Giải thích thêm', next: 'explain_rewards' },
        ],
    },

    claim_quest_full: {
        id: 'claim_quest_full',
        text: 'Tuyệt vời! Ta đã ghi nhận nhiệm vụ vào sổ tay bí cảnh của ngươi. Hãy hoàn thành và quay lại để nhận thưởng ✦',
        choices: [
            { text: 'Ta sẽ làm ngay!', next: 'farewell' },
            { text: 'Nhận thêm nhiệm vụ khác', next: 'quest_details_alt' },
        ],
    },

    claim_quest_alt: {
        id: 'claim_quest_alt',
        text: 'Được rồi! Nhiệm vụ này đã được ghi nhận. Hoàn thành và quay lại thưởng ✦',
        choices: [
            { text: 'Ta sẽ hoàn thành!', next: 'farewell' },
            { text: 'Nhận nhiệm vụ đầu tiên', next: 'claim_quest_full' },
        ],
    },

    explain_rewards: {
        id: 'explain_rewards',
        text: 'Hòa Hợp (✿) dùng để mua hạt giống tại Hoa Các. Đá Linh Khí (💎) dùng để mua hoa quý hiếm. Quà tặng hạt giống đặc biệt chỉ có tại vùng bí cảnh của ngươi!',
        choices: [
            { text: 'Tôi hiểu rồi.', next: 'farewell' },
        ],
    },

    explain_stones: {
        id: 'explain_stones',
        text: 'Đá Linh Khí (Spirit Stones) là đơn tiền tệ quý giá của tiên giới. Ngươi có thể dùng chúng để mua hạt giống quý hiếm. Mỗi lần thu hoạch hoa sẽ tặng ngươi vài viên đá.',
        choices: [
            { text: 'Hạt giống nào quý hiếm?', next: 'explain_rare_seed' },
            { text: 'Cảm ơn Tiên Nữ.', next: 'farewell' },
        ],
    },

    explain_rare_seed: {
        id: 'explain_rare_seed',
        text: 'Nguyệt Cúc Thiên Hà — loài hoa của dòng sông Ngân Hà, chỉ nở dưới ánh trăng. Hạt giống này rất quý, cần 25 Đá Linh Khí. Khi nở, nó tỏa sáng rực rỡ hơn tất cả các loài hoa khác. ✦',
        choices: [
            { text: 'Ta sẽ tiết kiệm đủ Đá!', next: 'farewell' },
            { text: 'Còn loài hoa nào khác?', next: 'explain_seeds' },
        ],
    },

    explain_seeds: {
        id: 'explain_seeds',
        text: 'Hoa viên có 5 loài hoa:\n\n🩵 Tinh Trạch U Đàm — xanh, miễn phí\n💜 Hồng Hà Tiên Chi — tím, 5 Đá\n💛 Đới Ngọc Kim Huyên — vàng, 10 Đá\n💚 Trúc Bích Thanh Hoa — lục, miễn phí\n🌙 Nguyệt Cúc Thiên Hà — hiếm, 25 Đá',
        choices: [
            { text: 'Ta sẽ trồng tất cả!', next: 'farewell' },
        ],
    },

    lore_garden: {
        id: 'lore_garden',
        text: 'Hoa viên này nằm giữa thiên đình và nhân gian. Mỗi bông hoa nở ra đều mang theo một phần hòa khí, kết nối trời đất lại với nhau. Người chăm sóc hoa viên chính là cầu nối giữa hai thế giới.',
        choices: [
            { text: 'Thật ý nghĩa...', next: 'farewell' },
            { text: 'Ta muốn giúp đỡ.', next: 'quest_offer' },
        ],
    },

    /* ---- Quest-aware dialogue variants ---- */

    quest_completed_first_bloom: {
        id: 'quest_completed_first_bloom',
        text: 'Tuyệt vời! Ngươi đã nở bông hoa đầu tiên. Hòa khí bắt đầu lan tỏa. Hãy tiếp tục chăm sóc hoa viên, sẽ có nhiều nhiệm vụ hơn chờ ngươi. ✿',
        choices: [
            { text: 'Nhiệm vụ tiếp theo là gì?', next: 'quest_details' },
            { text: 'Cảm ơn Tiên Nữ!', next: 'farewell' },
        ],
    },

    quest_almost_full_garden: {
        id: 'quest_almost_full_garden',
        text: 'Hoa viên gần rực rỡ rồi! Chỉ còn vài ô đất nữa. Hãy gieo trồng và tưới nước để hoàn thành Hoa Viên Đại Thành. Ta tin ngươi sẽ làm được! ✦',
        choices: [
            { text: 'Ta sẽ cố gắng!', next: 'farewell' },
        ],
    },

    has_rare_seed: {
        id: 'has_rare_seed',
        text: 'Ngươi đã có hạt Nguyệt Cúc Thiên Hà! Loài hoa này cần sự kiên nhẫn. Khi nó nở, cả hoa viên sẽ sáng bừng. ✦',
        choices: [
            { text: 'Ta sẽ trồng nó ngay!', next: 'farewell' },
        ],
    },

    farewell: {
        id: 'farewell',
        text: 'Chúc ngươi một ngày tốt lành, người chăm sóc hoa viên. Hãy nhớ — mỗi bông hoa đều mang theo ước mơ. ✿',
        choices: [],
    },
};

/**
 * DialogSystem — manages NPC dialogue flow.
 *
 * @example
 *   const dialog = new DialogSystem(NPC_DIALOGUE);
 *   const node = dialog.getCurrentNode();
 *   dialog.choose(0); // pick first choice
 */
export class DialogSystem {
    constructor(dialogueTree = NPC_DIALOGUE) {
        this.tree = dialogueTree;
        this.currentNodeId = 'greeting_default';
        this.history = [];
        this.questState = {
            hasFirstBloom: false,
            totalBlooms: 0,
            currentBlooms: 0,
            hasRareSeed: false,
            spiritStones: 0,
            completedQuests: new Set(),
            maxSimultaneousBlooms: 0,
            totalStonesEarned: 0,
            rareBlooms: 0,
            totalHarvests: 0,
            totalWaterings: 0,
            totalPlants: 0,
            beastFeedings: 0,
            nightHarvests: 0,
            elixirsCrafted: 0,
            soilUpgrades: 0,
            totalHarmonyEarned: 0,
        };
        // Realm-specific state
        this.activeRealmId = null;
        this.npcName = 'Tiên Nữ Hoa Giang';
        this.realmTitle = 'cây cầu kiều này';
        this.realmName = 'Linh Đảo Phù Vân';
    }

    /**
     * Set realm context for NPC dialogue personalization.
     */
    setRealmContext(realmId, npcName, realmTitle, realmName) {
        this.activeRealmId = realmId;
        this.npcName = npcName;
        this.realmTitle = realmTitle;
        this.realmName = realmName;
    }

    /**
     * Update the quest state (called from GardenScene when state changes).
     */
    updateQuestState(state) {
        Object.assign(this.questState, state);
    }

    /**
     * Build the realm-specific quest-list for the dialog body.
     */
    getRealmQuestRows() {
        const realmQuests = getQuestsForRealm(this.activeRealmId);
        const rows = [];
        for (const quest of realmQuests) {
            const goal = QUEST_TARGETS[quest.id] || { stat: 'totalBlooms', target: 1 };
            const value = Number(this.questState[goal.stat] ?? 0);
            const completed = this.questState.completedQuests;
            const done = (completed && typeof completed.has === 'function' && completed.has(quest.id))
                || value >= goal.target;
            rows.push({
                id: quest.id,
                name: quest.name,
                reward: quest.reward.harmony + quest.reward.spiritStones,
                done,
                progress: Math.min(value, goal.target),
                target: goal.target,
                realmReward: quest.reward,
            });
        }
        return rows;
    }

    /**
     * Build the quest-list rows for the dialog body: one row per quest with
     * live progress and completion status.
     */
    getQuestRows() {
        // Combine global quests + realm-specific quests
        const rows = [];
        // Global quests
        for (const quest of QUESTS) {
            const goal = QUEST_TARGETS[quest.id] || { stat: 'totalBlooms', target: 1 };
            const value = Number(this.questState[goal.stat] ?? 0);
            const completed = this.questState.completedQuests;
            const done = (completed && typeof completed.has === 'function' && completed.has(quest.id))
                || value >= goal.target;
            rows.push({
                id: quest.id,
                name: quest.name,
                reward: quest.reward,
                done,
                progress: Math.min(value, goal.target),
                target: goal.target,
                realmReward: null,
            });
        }
        // Realm-specific quests
        for (const row of this.getRealmQuestRows()) {
            rows.push(row);
        }
        return rows;
    }

    /**
     * Build realm quest text for the quest_offer node.
     */
    getRealmQuestText() {
        const realmQuests = getQuestsForRealm(this.activeRealmId);
        if (realmQuests.length === 0) return 'Hiện tại không có nhiệm vụ bí cảnh cho vùng này.';
        return realmQuests.map((q, i) => `🌸 Nhiệm vụ ${i + 1}: ${q.name} — ${q.description}`).join('\n');
    }

    /**
     * Render the greeting node with realm-specific context.
     */
    renderGreetingNode(node) {
        if (!node || !node.text) return node;
        return {
            ...node,
            text: node.text
                .replace('{npcName}', this.npcName)
                .replace('{realmTitle}', this.realmTitle)
                .replace('{realmName}', this.realmName)
                .replace('{realmQuestText}', this.getRealmQuestText()),
        };
    }

    /**
     * Determine the appropriate greeting node based on quest state.
     */
    getGreetingNode() {
        const qs = this.questState;
        if (qs.totalBlooms === 0 && qs.currentBlooms === 0) {
            return 'greeting_first_visit';
        }
        if (qs.currentBlooms >= 30 && !qs.completedQuests.has('full_garden')) {
            return 'quest_almost_full_garden';
        }
        if (qs.hasRareSeed) {
            return 'has_rare_seed';
        }
        if (qs.hasFirstBloom && qs.completedQuests.has('first_bloom')) {
            return 'quest_completed_first_bloom';
        }
        return 'greeting_default';
    }

    /** Start dialogue from the greeting */
    startDialogue() {
        this.history = [];
        this.currentNodeId = this.getGreetingNode();
        return this.getCurrentNode();
    }

    /** Get the current dialogue node */
    getCurrentNode() {
        const node = this.tree[this.currentNodeId] || null;
        if (!node || node.id === 'greeting_default' || node.id === 'greeting_first_visit') {
            return this.renderGreetingNode(node);
        }
        return node;
    }

    /**
     * Choose a dialogue option (by index).
     */
    choose(choiceIndex) {
        const node = this.getCurrentNode();
        if (!node || !node.choices || choiceIndex >= node.choices.length) return null;

        this.history.push(this.currentNodeId);
        const choice = node.choices[choiceIndex];
        const nextId = typeof choice.next === 'function'
            ? choice.next(this.questState)
            : choice.next;

        this.currentNodeId = nextId;
        return this.getCurrentNode();
    }

    /** Go back to the previous node */
    goBack() {
        if (this.history.length === 0) return null;
        this.currentNodeId = this.history.pop();
        return this.getCurrentNode();
    }

    /** Check if the dialogue is at the end (no more choices) */
    isFinished() {
        const node = this.getCurrentNode();
        return !node || !node.choices || node.choices.length === 0;
    }
}
