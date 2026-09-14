// ============================================================================
// ai-easy.js —— 难度1「简单」档案：要优化简单AI，只改这一个文件
// ----------------------------------------------------------------------------
// 档案通用字段说明（四个难度文件共用这套字段，ai-strategy.js 骨架读取）：
//   pickNoise        选技随机噪声（大师0=永远锁定最优，低难度会拿废技）
//   randomPlan       true=乱丢技能模式（不走通用规划骨架）
//   randomPlanSkip   乱丢模式下空手概率
//   neverUse         乱丢模式永不使用的技能
//   maxSkills        每回合连放上限（再与持有数+1取小）
//   advanced         高级板块总开关（反制/反情报/斩杀精算/钓鱼/迷彩...）
//   master           大师板块总开关（仅供骨架内少数 mst 判断）
//   clueWanted       信息战：线索持有目标数（拿满才停）
//   verifierCandMax  验证器触发候选上限
//   forecastDepth    对手下一猜预测树深度
//   useWeighted      猜数用加权候选（硬过滤+软加权）；false=普通候选
//   softRate         低难度想起用线索的概率
//   candJitter       候选猜数带抖动（不精准）
//   guessSpread      盲猜散步系数（0=精确中点切割）
//   fishRate/fishRange 钓鱼概率/钓鱼最小范围
//   useKnown         确知炸弹时直接收割
//   useTopUp         信息技放完后动态追加
//   topUpCap/topUpAllinHp/topUpSpeed/topUpFreeze  追加上限/孤注血线/续猜/冰封
//   deposit          存款回合（没事干就叠不消失增伤）
//   balanceDanger    危险线内血量大幅落后用天平
//   sabotageRange    板块6（人类逼近破坏）触发范围
//   moveFlipRate     板块6掀桌概率
//   blindChipRate    else分支致盲骚扰概率
//   blackholeAltRate 二分不在时黑洞替代概率
//   binaryEager      中大范围也积极二分
//   allinMinHp       孤注一掷最低血线
//   willingExtra     斩杀意愿的额外激进阈值（>=1等于没有）
//   antiIntelRate    反情报掀桌概率
//   knownSpeed       确知斩杀链带续猜保险
//   scoutBase        例行侦察基准频率（0=不例行刺探）
//   assess(h)        威胁评估修正钩子：返回 {riskUp, forceSabotage, scoutBoost, ...}
//   hookMid(h)       规划中盘钩子（保命/反制之后，范围压缩之前）
//   hookLate(h)      规划收尾钩子（估值填充之后，互斥收尾之前）
// ============================================================================
AI_LEVEL_PROFILES[1] = {
    name:'简单',
    pickNoise: 1.5,
    randomPlan: true, randomPlanSkip: 0.6, neverUse: ['gambler','allin','pause'],
    maxSkills: 1,
    advanced: false, master: false,
    clueWanted: 2, verifierCandMax: 3, forecastDepth: 2,
    useWeighted: false, softRate: 0.6, candJitter: true, guessSpread: 0.3,
    fishRate: 0, fishRange: 4, useKnown: false,
    useTopUp: false, topUpCap: 3, topUpAllinHp: 3, topUpSpeed: false, topUpFreeze: false,
    deposit: false, balanceDanger: false,
    sabotageRange: 8, moveFlipRate: 0.35, blindChipRate: 0, blackholeAltRate: 0,
    binaryEager: false, allinMinHp: 3, willingExtra: 2, antiIntelRate: 0,
    knownSpeed: false, scoutBase: 0
};
