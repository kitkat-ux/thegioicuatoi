/**
 * DialogSystem — NPC dialogue trees with quest-aware branching.
 *
 * Pure data/logic module (no Phaser dependency) so it is unit-testable.
 *
 * The Tiên Nữ Hoa Giang NPC at the bridge/pavilion delivers quest-aware
 * dialogue that changes based on the player's progress and active quests.
 */

/**
 * Dialogue nodes for Tiên Nữ Hoa Giang.
 *
 * Each node has:
 * - id: unique identifier
 * - text: the dialogue line (Vietnamese)
 * - choices: array of { text, next } where next is either a node id or
 *   a function (questState) => nodeId for conditional branching
 * - condition: optional function (questState) => boolean; if false, node is skipped
 */
export const NPC_DIALOGUE = {
    greeting_default: {
        id: 'greeting_default',
        text: 'Chào ngươi, người chăm sóc hoa viên. Ta là Tiên Nữ Hoa Giang,守护守护 cây cầu này. Hoa viên hôm nay thật yên bình... ✿',
        choices: [
            { text: 'Tiên Nữ có nhiệm vụ gì cho ta?', next: 'quest_offer' },
            { text: 'Ta muốn nghe về hoa viên.', next: 'lore_garden' },
            { text: 'Tạm biệt.', next: 'farewell' },
        ],
    },

    greeting_first_visit: {
        id: 'greeting_first_visit',
        text: 'Ồ... lần đầu tiên ngươi đến đây. Hoa viên này đã chờ đợi người chăm sóc rất lâu. Hãy bắt đầu bằng cách gieo hạt vào những ô đất trống.',
        choices: [
            { text: 'Ta sẽ gieo trồng ngay!', next: 'quest_offer' },
            { text: 'Nơi này thật đẹp...', next: 'lore_garden' },
        ],
    },

    quest_offer: {
        id: 'quest_offer',
        text: 'Hoa viên cần được chăm sóc. Hãy gieo hạt, tưới nước, và thu hoạch hoa để nhận Điểm Hòa Hợp và Đá Linh Khí. Khi hoàn thành nhiệm vụ, ngươi sẽ được thưởng.',
        choices: [
            { text: 'Nhiệm vụ hiện tại là gì?', next: 'quest_details' },
            { text: 'Đá Linh Khí dùng để làm gì?', next: 'explain_stones' },
            { text: 'Ta hiểu rồi.', next: 'farewell' },
        ],
    },

    quest_details: {
        id: 'quest_details',
        text: 'Nhiệm vụ của ngươi:\n\n🌱 Bông Hoa Đầu Tiên — Nở bông hoa đầu tiên (+3 Đá)\n🌿 Bàn Tay Xanh — Nở 10 bông hoa (+8 Đá)\n🌸 Hoa Viên Đại Thành — Nở 36 bông cùng lúc (+20 Đá)\n💎 Người Thu Nhập Đá — Tích 50 Đá Linh Khí (+10 Đá)\n🌙 Nguyệt Cúc Thiên Hà — Trồng hoa quý hiếm (+15 Đá)',
        choices: [
            { text: 'Ta sẽ hoàn thành tất cả!', next: 'farewell' },
            { text: 'Nguyệt Cúc Thiên Hà là gì?', next: 'explain_rare_seed' },
        ],
    },

    explain_stones: {
        id: 'explain_stones',
        text: 'Đá Linh Khí (Spirit Stones) là đơn tiền tệ quý giá của tiên giới. Ngươi có thể dùng chúng để mua hạt giống quý hiếm từ Ngăn Hạt Giống. Mỗi lần thu hoạch hoa sẽ tặng ngươi vài viên đá.',
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
        };
    }

    /**
     * Update the quest state (called from GardenScene when state changes).
     * @param {object} state
     */
    updateQuestState(state) {
        Object.assign(this.questState, state);
    }

    /**
     * Determine the appropriate greeting node based on quest state.
     * @returns {string} node id
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
        return this.tree[this.currentNodeId] || null;
    }

    /**
     * Choose a dialogue option (by index).
     * @param {number} choiceIndex
     * @returns {object|null} the new current node, or null if no more choices
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
