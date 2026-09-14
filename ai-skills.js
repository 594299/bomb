// ============================================================================
// ai-skills.js —— AI 技能熟练层：专门负责"把技能用好"
// 职责：技能牌面价值表 / 选技评分（连招协同+counter-pick）/ 斩杀伤害精算 /
//       选数类技能的选点（验证器/黑洞/禁猜/陷阱）
// 要优化"AI 用技能的熟练度"，只改这一个文件
// 依赖：ai-brain.js（信念/候选）、ai-observe.js（对手预测），主文件全局（运行时调用）：G、getPlayer
// ============================================================================

// 技能牌面价值表：选技评分（aiChooseSkill）与交换估值（aiPlanSkills第9段）共用同一张表
const AI_SKILL_TIER = {
    volley:9, double:8, rampage:8, binary:8, verifier:8, digitsum:8,
    shield:7, reflect:7, heal:7, rebirth:7, allin:7, empower:7, pause:7, peek:7, precognition:7, balance:7,
    bomblet:6, forbid:6, trap:6, pierce:6, dormant:6, speed:6, freeze:6, scout:6, numberslash:6, detect:6, fog:6, sacrifice:6,
    blind:5, lock:5, disguise:5, web:5, anger:5, lifesteal:5,
    refresh:5, charge:5, move:5, tide:5, blackhole:5,
    copy:4, swap:4,
    dice:3, gambler:3, skip:4
};

// 重生对斩杀线的额外血量：复活血量随上限缩放（至少3血，高上限复活半管）——与主文件 rebirthHP 同步
function aiRebirthBonus(p){ return p.rebirth ? Math.max(2, Math.ceil(p.maxHP/2)-1) : 0; }
// 选技评分：牌面价值 + 连招协同 + 局势针对（counter-pick）
// pickNoise 由难度档案控制：大师零随机永远锁定最优阵容，低难度带噪声会拿废技
function aiChooseSkill(ai, human, options){
    const tier = AI_SKILL_TIER;
    const prof = aiProfile();
    const owned = ai.skills.map(s=>s.id);
    let best = options[0], bestSc = -Infinity;
    options.forEach(s=>{
        let sc = (tier[s.id]||5) + Math.random()*(prof ? prof.pickNoise : 1.5);
        // 连招协同：已有增伤件时优先凑齐爆发链
        if((owned.includes('double')||owned.includes('allin')) && ['rampage','volley','refresh','empower','speed','bomblet'].includes(s.id)) sc += 2;
        // 信息协同：已有信息技时优先验证器/二分
        if((owned.includes('detect')||owned.includes('peek')||owned.includes('digitsum')) && ['verifier','binary'].includes(s.id)) sc += 1.5;
        if((owned.includes('precognition')||owned.includes('peek')) && s.id==='detect') sc -= 1; // 探测只报位数，信息密度低于透视/预知，有它们时优先级靠后
        // 残血优先保命件
        if(ai.hp<=2 && ['heal','shield','reflect','rebirth'].includes(s.id)) sc += 2;
        if(s.id==='balance' && human.hp-ai.hp>=2) sc += 3; // 天平=落后翻盘神技，血差越大越必拿
        if(s.id==='sacrifice' && owned.includes('speed')) sc += 1.5; // 裂变=平局器：有续猜时多目标收益放大；也是逆风局的搅局底牌
        // 反射+跳过连招协同：有反射才值得拿跳过
        if(owned.includes('reflect') && s.id==='skip') sc += 3;
        if(owned.includes('skip') && s.id==='reflect') sc += 2;
        // 对面有防御件优先破防件
        if((human.shield>0||human.reflect>0||human.rebirth) && ['volley','pierce'].includes(s.id)) sc += 2;
        // 针对选技（counter-pick）：对手技能列表公开——他信息技多，挪弹三件套升值；他控制多，保险件升值
        const humanHas = id => human.skills.some(x=>x.id===id);
        if(['detect','peek','digitsum','precognition','verifier'].some(humanHas) && ['move','fog','tide'].includes(s.id)) sc += 2;
        if(['pause','freeze','blind','lock'].some(humanHas) && ['speed','dormant','rebirth'].includes(s.id)) sc += 1;
        if(human.skills.length>=5 && s.id==='copy') sc += 2; // 对手技能池越深，复制越值
        if(human.skills.length>=4 && s.id==='swap') sc += 1.5; // 对面技能池越深，交换连招白捡的火力越足
        if(sc > bestSc){ bestSc = sc; best = s; }
    });
    return best;
}
// 斩杀伤害精算：把增伤buff全部折算成"这一发猜中实际扣几血"（含盾/反拆段）
function aiEstimateHitDamage(ai, human){
    let mult = (ai.doubleDamage||0)+(ai.allinMultiplier||0);
    let damage = mult>0 ? mult : 1;
    if(ai.anger){
        const lost = ai.maxHP - ai.hp;
        damage += Math.floor(lost/2);
    }
    if(ai.bombletDamage) damage += ai.bombletDamage;
    if(ai.dormantBonus) damage += 2;
    damage += (ai.diceBonus||0);
    if(ai.rampageMulti) damage *= ai.rampageMulti;
    const segs = (ai.volley && ai.volley>1) ? ai.volley : 1;
    const defLayers = Math.max(0, human.shield||0) + Math.max(0, human.reflect||0);
    if(defLayers<=0) return damage;
    const perSeg = Math.max(1, Math.round(damage/segs));
    return Math.max(0, perSeg * Math.max(0, segs-Math.min(defLayers, segs)));
}
function aiEstimateOpponentHitDamage(human, ai){
    let damage = (1+(human.doubleDamage||0)+(human.allinMultiplier||0)+(human.bombletDamage||0))*(human.rampageMulti||1);
    if(human.anger){
        const lost = human.maxHP - human.hp;
        damage += Math.floor(lost/2);
    }
    damage += (human.diceBonus||0);
    const segs = (human.volley && human.volley>1) ? human.volley : 1;
    const defLayers = Math.max(0, ai.shield||0) + Math.max(0, ai.reflect||0);
    if(defLayers<=0) return damage;
    const perSeg = Math.max(1, Math.round(damage/segs));
    return Math.max(0, perSeg * Math.max(0, segs-Math.min(defLayers, segs)));
}
// 计划里信息/缩圈技放完后候选数的前瞻估计
function aiEstimatePlannedCandCount(candCount, range, plan){
    let out = Math.max(1, Math.min(range, candCount));
    const applyFactor = f => { out = Math.max(1, Math.min(range, Math.ceil(out * f))); };
    if(plan.includes('binary')) applyFactor(range<=4 ? 0.5 : 0.55);
    if(plan.includes('blackhole')) applyFactor(0.72);
    if(plan.includes('detect')) applyFactor(0.75); // 探测只报位数：过滤力弱于奇偶时代
    if(plan.includes('peek')) applyFactor(0.24);
    if(plan.includes('digitsum')) applyFactor(0.38);
    if(plan.includes('precognition')) applyFactor(0.34);
    if(plan.includes('verifier') && out>1) out--;
    return Math.max(1, Math.min(range, out));
}
function aiShouldSpendRiskyBurst(ctx){
    if(ctx.known || ctx.canLethal) return true;
    if(ctx.aiFrozen || ctx.humanDormant) return false;
    if(ctx.aiBehind) return true;
    if(ctx.humanCanHit && (ctx.oppDmgExp>=Math.max(1.5, ctx.aiHp*0.45) || ctx.oppHitProb>=0.24 || ctx.humanThreat>=3)) return true;
    if(ctx.effHit>=0.5) return true;
    const missPenalty = (ctx.hasAllin ? (1-ctx.effHit)*1.15 : 0) + (ctx.hasSpeed ? 0.35 : 0);
    const nowEV = ctx.effHit * Math.max(1, ctx.effDmg) - missPenalty;
    const futureEV = ctx.futureHit * Math.max(1, ctx.effDmg);
    return futureEV <= nowEV + 0.35;
}
function aiShouldPreStackBurst(ctx){
    if(ctx.aiFrozen || ctx.humanDormant) return false;
    if(ctx.known || ctx.willing) return false;
    if(ctx.aiBehind) return false;
    if(ctx.humanCanHit && ctx.oppDmgExp>=Math.max(1.2, ctx.aiHp*0.35)) return false;
    if(ctx.futureHit < 0.38 || ctx.futureCand > Math.max(4, ctx.guessTries+1)) return false;
    return true;
}
// 验证器选点：命中收益 + 排除最优猜点的信息量，双账合一
function aiChooseVerifierNumber(ai, human, low, high){
    let wc = aiWeightedCands();
    if(!wc || !wc.length){
        const cands = aiCandidates(true) || aiCandidates() || [];
        wc = cands.length ? cands.map(n=>({ n:n, w:1 })) : null;
    }
    if(!wc || !wc.length) return Math.floor((low+high)/2);
    if(wc.length===1) return wc[0].n;
    const total = aiWeightedTotal(wc);
    const baseEntropy = aiWeightedEntropy(wc);
    const lethalDamage = aiEstimateHitDamage(ai, human);
    const lethalNow = lethalDamage >= human.hp + aiRebirthBonus(human);
    const plannedGuess = aiPickBestWeightedGuess(wc, ai, human);
    const choices = aiShortlistWeightedNumbers(wc, 8);
    if(plannedGuess!==null && choices.indexOf(plannedGuess)<0) choices.unshift(plannedGuess);
    let best = choices[0], bestScore = -Infinity;
    for(let i=0; i<choices.length; i++){
        const n = choices[i];
        const pick = wc.find(o=>o.n===n);
        if(!pick) continue;
        const hitP = pick.w / total;
        const infoGain = Math.max(0, baseEntropy - aiExpectedPostVerifyEntropy(wc, n));
        const followBonus = n===plannedGuess ? 0.8 : 0;
        const score = hitP*(lethalNow ? 14 : 7) + infoGain*1.2 + followBonus;
        if(score > bestScore + 1e-9 || (Math.abs(score-bestScore)<=1e-9 && hitP > ((wc.find(o=>o.n===best)||{w:0}).w/total))){
            bestScore = score;
            best = n;
        }
    }
    return best;
}
// 黑洞选点：期望缩圈后的熵与宽度双优化，偏向加权质心
function aiChooseBlackholeNumber(low, high){
    const wc = aiWeightedCands();
    if(!wc || !wc.length) return Math.floor((low+high)/2);
    const choices = aiShortlistWeightedNumbers(wc, 8);
    const mid = Math.floor((low+high)/2);
    if(choices.indexOf(mid)<0) choices.push(mid);
    if(choices.indexOf(Math.min(high, low+2))<0) choices.push(Math.min(high, low+2));
    if(choices.indexOf(Math.max(low, high-2))<0) choices.push(Math.max(low, high-2));
    let weightedMean = 0;
    const total = aiWeightedTotal(wc);
    wc.forEach(o=>{ weightedMean += o.n * o.w; });
    weightedMean = total>0 ? weightedMean/total : mid;
    let best = choices[0], bestScore = -Infinity;
    for(let i=0; i<choices.length; i++){
        const n = Math.max(low, Math.min(high, choices[i]));
        const outcome = aiExpectedBlackholeOutcome(wc, low, high, n);
        const centerBias = 1 - Math.min(1, Math.abs(n-weightedMean)/Math.max(1, high-low));
        const score = -outcome.entropy*3 - outcome.width*0.12 + centerBias*0.35;
        if(score > bestScore){
            bestScore = score;
            best = n;
        }
    }
    return best;
}
// 信息技能精确估值：在当前范围上枚举，算用完后期望剩余候选数（越小越强）——
// 透视按个位分组、预知按十位、探测按位数、数字和按和；期望=Σ组²/宽度
function aiExpectedPoolAfter(skillId, low, high){
    const width = high-low+1;
    if(width<=0) return 0;
    if(skillId==='binary') return Math.ceil(width/2);
    if(skillId==='verifier') return Math.max(1, width-1);
    const key = skillId==='peek' ? (n=>n%10)
        : skillId==='precognition' ? (n=>Math.floor(n/10)%10)
        : skillId==='detect' ? (n=>String(n).length)
        : skillId==='digitsum' ? aiDigitSum : null;
    if(!key) return width;
    const groups = {};
    for(let n=low; n<=high; n++){ const k=key(n); groups[k]=(groups[k]||0)+1; }
    let expected = 0;
    for(const k in groups){ expected += groups[k]*groups[k]; }
    return expected/width;
}
// 零信息检测：线索在当前范围恒定 → 用了纯暴露自己冷却，高手绝不做
function aiInfoUseless(skillId, low, high){
    if(low>high) return true;
    if(skillId==='binary') return low>=high;
    const f = skillId==='detect' ? (n=>String(n).length)
        : skillId==='precognition' ? (n=>Math.floor(n/10)%10)
        : skillId==='digitsum' ? aiDigitSum
        : skillId==='peek' ? (n=>n%10) : null;
    if(!f) return false;
    const v = f(low);
    for(let n=low+1; n<=high; n++){ if(f(n)!==v) return false; }
    return true;
}
// 禁猜/陷阱选点：埋在对手最可能猜的位置（多层预测树打分）
function aiChooseControlNumber(skillId, low, high){
    if(skillId==='blackhole') return aiChooseBlackholeNumber(low, high);
    const prof = aiProfile();
    const forecast = aiPredictHumanGuess(low, high);
    const forecastMap = aiPredictHumanGuessMap(low, high, prof ? prof.forecastDepth : 2);
    if(!forecast) return Math.floor((low+high)/2);
    const picks = [forecast.primary].concat(forecast.alternatives||[]).filter((n, i, arr)=>n>=low && n<=high && arr.indexOf(n)===i);
    if(!picks.length) return Math.floor((low+high)/2);
    if(skillId==='forbid' || skillId==='trap'){
        const scoreMap = {};
        const addScore = (n, sc) => {
            if(n<low || n>high || sc<=0) return;
            scoreMap[n] = (scoreMap[n]||0) + sc;
        };
        forecastMap.slice(0, 6).forEach((x, idx)=>addScore(x.n, x.score * (idx===0 ? 1.2 : (idx===1 ? 0.82 : 0.58))));
        addScore(forecast.primary, 1.4 + forecast.confidence*2.4);
        (forecast.alternatives||[]).forEach((n, idx)=>addScore(n, 0.8 - idx*0.18 + forecast.confidence));
        if(forecast.style==='candidate-finish') addScore(forecast.primary, 1.5);
        let best = picks[0], bestScore = -Infinity;
        Object.keys(scoreMap).forEach(k=>{
            const n = parseInt(k);
            const score = scoreMap[k];
            if(score > bestScore){
                bestScore = score;
                best = n;
            }
        });
        return best;
    }
    return picks[0];
}
