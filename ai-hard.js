// ============================================================================
// ai-hard.js —— 难度3「困难」档案：要优化困难AI，只改这一个文件
// 字段说明见 ai-easy.js 头部注释
// ============================================================================
AI_LEVEL_PROFILES[3] = {
    name:'困难',
    pickNoise: 1.5,
    randomPlan: false,
    maxSkills: 5,
    advanced: true, master: false,
    clueWanted: 3, verifierCandMax: 6, forecastDepth: 2,
    useWeighted: true, softRate: 1, candJitter: false, guessSpread: 0,
    fishRate: 0.5, fishRange: 4, useKnown: true,
    useTopUp: true, topUpCap: 3, topUpAllinHp: 3, topUpSpeed: false, topUpFreeze: false,
    deposit: true, balanceDanger: true,
    sabotageRange: 8, moveFlipRate: 0.35, blindChipRate: 0.4, blackholeAltRate: 0.5,
    binaryEager: false, allinMinHp: 3, willingExtra: 2, antiIntelRate: 0.85,
    knownSpeed: false, scoutBase: 0
};
