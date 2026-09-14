// ============================================================================
// ai-normal.js —— 难度2「普通」档案：要优化普通AI，只改这一个文件
// 字段说明见 ai-easy.js 头部注释。教程模式也固定使用本档案（体验可复现）
// ============================================================================
AI_LEVEL_PROFILES[2] = {
    name:'普通',
    pickNoise: 1.5,
    randomPlan: false,
    maxSkills: 3,
    advanced: false, master: false,
    clueWanted: 2, verifierCandMax: 3, forecastDepth: 2,
    useWeighted: false, softRate: 0.9, candJitter: true, guessSpread: 0.15,
    fishRate: 0, fishRange: 4, useKnown: true,
    useTopUp: true, topUpCap: 3, topUpAllinHp: 3, topUpSpeed: false, topUpFreeze: false,
    deposit: true, balanceDanger: true,
    sabotageRange: 8, moveFlipRate: 0.35, blindChipRate: 0, blackholeAltRate: 0,
    binaryEager: false, allinMinHp: 3, willingExtra: 2, antiIntelRate: 0,
    knownSpeed: false, scoutBase: 0
};
