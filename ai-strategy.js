// ============================================================================
// ai-strategy.js —— AI 决策层：选技评分 / 回合技能规划 / 动态追加 / 猜数选择
// 职责：回答"这回合该干什么"。纯选择逻辑，不碰 DOM、不执行动作
//   （aiChooseGuess 只返回选好的数，执行在 ai.js 的 aiGuess 里）
// 依赖：ai-brain.js（信念/配置），主文件全局（运行时调用）：G、getPlayer
// ============================================================================

// 重生对斩杀线的额外血量：复活血量随上限缩放（至少3血，高上限复活半管）——与主文件 rebirthHP 同步
function aiRebirthBonus(p){ return p.rebirth ? Math.max(2, Math.ceil(p.maxHP/2)-1) : 0; }
function aiChooseSkill(ai, human, options){
    const tier = AI_TUNE.skillTier;
    const owned = ai.skills.map(s=>s.id);
    let best = options[0], bestSc = -Infinity;
    options.forEach(s=>{
        let sc = (tier[s.id]||5) + (aiEffectiveLevel()>=4 ? 0 : Math.random()*1.5); // 大师零随机：永远锁定最优阵容，绝不拿废技
        // 连招协同：已有增伤件时优先凑齐爆发链
        if((owned.includes('double')||owned.includes('allin')) && ['rampage','volley','refresh','empower','speed','bomblet'].includes(s.id)) sc += 2;
        // 信息协同：已有信息技时优先验证器/二分
        if((owned.includes('detect')||owned.includes('peek')||owned.includes('digitsum')) && ['verifier','binary'].includes(s.id)) sc += 1.5;
        if((owned.includes('precognition')||owned.includes('peek')) && s.id==='detect') sc -= 1; // 探测只报位数，信息密度低于透视/预知，有它们时优先级靠后
        // 残血优先保命件
        if(ai.hp<=2 && ['heal','shield','reflect','rebirth'].includes(s.id)) sc += 2;
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
        if(sc > bestSc){ bestSc = sc; best = s; }
    });
    return best;
}
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
function aiPeekSubsetHitProb(wc){
    if(!wc || !wc.length) return 0;
    let total = 0, best = 0;
    wc.forEach(o=>{ total += o.w; if(o.w>best) best=o.w; });
    return total>0 ? best/total : 0;
}
function aiForecastHitProbForWeightedRange(wc){
    if(!wc || !wc.length) return 0;
    let lo = wc[0].n, hi = wc[0].n;
    for(let i=1; i<wc.length; i++){
        if(wc[i].n<lo) lo = wc[i].n;
        if(wc[i].n>hi) hi = wc[i].n;
    }
    const fc = aiPredictHumanGuess(lo, hi);
    return fc ? fc.hitProb : 1/Math.max(1, hi-lo+1);
}
function aiShortlistWeightedNumbers(wc, limit){
    const out = [];
    const add = n => {
        if(n===null || n===undefined || out.indexOf(n)>=0) return;
        out.push(n);
    };
    if(!wc || !wc.length) return out;
    const ranked = wc.slice().sort((a,b)=>(b.w-a.w)||(a.n-b.n));
    ranked.slice(0, Math.min(limit||6, ranked.length)).forEach(o=>add(o.n));
    [0.2, 0.35, 0.5, 0.65, 0.8].forEach(q=>{
        const idx = Math.max(0, Math.min(wc.length-1, Math.round((wc.length-1)*q)));
        add(wc[idx].n);
    });
    return out;
}
function aiPickBestWeightedGuess(wc, ai, human){
    if(!wc || !wc.length) return null;
    const total = aiWeightedTotal(wc);
    if(total<=0) return wc[Math.floor(wc.length/2)].n;
    const lethalDamage = aiEstimateHitDamage(ai, human);
    const lethalNow = lethalDamage >= human.hp + aiRebirthBonus(human);
    const oppDamage = aiEstimateOpponentHitDamage(human, ai);
    const baseEntropy = aiWeightedEntropy(wc);
    let best = wc[0].n, bestProb = wc[0].w/total, bestScore = -Infinity;
    for(let i=0; i<wc.length; i++){
        const guess = wc[i].n;
        const split = aiSplitWeightedGuess(wc, guess);
        const hitP = split.hit / total;
        const missMass = split.miss;
        const remainFrac = missMass>0 ? Math.max(split.below, split.above)/missMass : 0;
        const infoGain = 1 - remainFrac;
        const entropyGain = Math.max(0, baseEntropy - aiExpectedPostGuessEntropy(wc, guess));
        const hitReward = lethalNow ? 10 : (2 + Math.min(8, lethalDamage));
        const finishBonus = (ai.speed||0)>0 ? hitP*2 : 0;
        const antiDormantPenalty = human.dormant ? hitP*4 : 0;
        const futureSelfProb = missMass>0 ? (split.below/total)*aiPeekSubsetHitProb(split.belowSet) + (split.above/total)*aiPeekSubsetHitProb(split.aboveSet) : 0;
        const futureOppProb = missMass>0 ? (split.below/total)*aiForecastHitProbForWeightedRange(split.belowSet) + (split.above/total)*aiForecastHitProbForWeightedRange(split.aboveSet) : 0;
        const tempoSwing = (1-hitP) * (futureSelfProb*4 - futureOppProb*Math.max(3, oppDamage));
        const score = hitP*hitReward + infoGain*2.2 + entropyGain*1.4 + finishBonus + tempoSwing - antiDormantPenalty;
        if(score > bestScore + 1e-9 || (Math.abs(score-bestScore)<=1e-9 && hitP>bestProb)){
            bestScore = score;
            best = guess;
            bestProb = hitP;
        }
    }
    return best;
}
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
function aiChooseControlNumber(skillId, low, high){
    if(skillId==='blackhole') return aiChooseBlackholeNumber(low, high);
    const forecast = aiPredictHumanGuess(low, high);
    const forecastMap = aiPredictHumanGuessMap(low, high, 2);
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

// AI 回合技能规划：按局势返回一串要连放的技能id（有先后顺序，赋能必须在被强化技能前面）
function aiPlanSkills(ai, human){
    const lvl = aiEffectiveLevel();
    if(!G.isSkillMode || ai.skills.length===0) return [];
    const ready = id => ai.skills.some(s=>s.id===id) && (ai.cooldowns[id]||0)<=0 && ai.lockedSkill!==id && ai.secondLockedSkill!==id;
    // 对手公开技能冷却档案：每AI回合tick一次（≈对手每回合转1格），换回合重置（技能重发）
    if(G.aiOppCdRound!==G.roundCount){ G.aiOppCd={}; G.aiOppCdRound=G.roundCount; }
    if(G.aiOppCd){ for(const k in G.aiOppCd){ if(G.aiOppCd[k]>0) G.aiOppCd[k]--; } }
    if(lvl===1){
        // 简单AI：偶尔乱丢一个不咬人的技能
        if(Math.random()<0.6) return [];
        const ok = ai.skills.map(s=>s.id).filter(id=>ready(id)&&['gambler','allin','pause'].indexOf(id)<0);
        return ok.length ? [ok[Math.floor(Math.random()*ok.length)]] : [];
    }
    // 每回合连放上限：与持有技能数硬挂钩（+1留给刷新/充能/复制联动），
    // 玩家每回合反而没有此限制——这是AI的自我约束，不是特权
    const maxSkills = Math.min(lvl===2 ? 3 : (lvl===3 ? 5 : (lvl>=4 ? 99 : 6)), ai.skills.length + 1);
    const plan = [];
    const push = id => { if(plan.length<maxSkills && !plan.includes(id)) plan.push(id); };
    const range = _aiRHi() - _aiRLo() + 1;
    let cands = aiCandidates(true); // 技能规划=下重注：只认硬线索，软线索（模式挖掘）不得参与
    if(cands && cands.length===0){ aiHandleContradiction(); cands=null; } // 线索矛盾：首次容忍，连续才清洗（ai-brain.js）
    const known = aiKnownBomb();
    const candCount = known!==null ? 1 : ((cands && cands.length>0) ? cands.length : range);
    const hitChance = 1 / candCount;
    const humanArmed = !!(human.doubleDamage || human.allinMultiplier || (human.rampageMulti||0)>1 || human.volley>0 || human.bombletDamage);
    const humanDefensed = human.shield>0 || human.reflect>0 || human.rebirth;
    // 人类斩杀线精算：增伤buff使用时全部公开播报——精确算出"他这一发猜中我会不会死"
    const humanMaxDmg = (1+(human.doubleDamage||0)+(human.allinMultiplier||0)+(human.bombletDamage||0))*(human.rampageMulti||1)+(human.anger?Math.floor((human.maxHP-human.hp)/2):0);
    // 对手威胁评估（只看公开行为，不看任何私密信息）：
    // 反常精确猜的次数 + 平均收敛效率；对手冷却有两个合法来源：侦察视野（精确）+ 公开使用记录（免费推断）
    const oppCdKnown = (ai.scoutVision||0)>0;
    const oppCdReady = id => {
        if(!human.skills.some(s=>s.id===id)) return false;
        if(oppCdKnown) return (human.cooldowns[id]||0)<=0; // 侦察中：直接看精确冷却
        const obs = G.aiOppCd||{};
        return (id in obs) ? obs[id]<=0 : false; // 公开用过：按播报的冷却推断；从未公开用过：保守按未就绪
    };
    const avgShrink = (G.humanGuesses||0)>0 ? (G.humanShrink||0)/G.humanGuesses : 0;
    const hView = human.view || { low:G.low, high:G.high };
    const humanForecast = aiPredictHumanGuess(hView.low, hView.high);
    const humanGuessMap = aiPredictHumanGuessMap(hView.low, hView.high, 2);
    const topGuessScore = humanGuessMap.length ? humanGuessMap[0].score : 0;
    let humanThreat = (G.humanSuspicion||0)
        + (avgShrink>0.45?1:0) // 收敛接近二分效率：不是瞎猜，是有章法的推进
        + (oppCdReady('verifier')?1:0)
        + (oppCdReady('binary')?1:0);
    if(humanForecast && humanForecast.confidence>=0.55) humanThreat += 1;
    if(humanForecast && humanForecast.effectivePool<=4) humanThreat += 1;
    // 对手这回合伤不了我：冰封命中不炸 / 被暂停没有回合——别为空气交保命件
    const humanCanHit = !human.frozen && !human.skipNext;
    // 宏观节奏：血量落后或对手威胁逼近了——放弃钓鱼全速收敛，斩杀阈值也放宽
    G.aiBehind = ai.hp<=human.hp-2 || humanThreat>=3;
    // 对手命中概率估计（终局博弈的核心输入）：优先采用"候选池+习惯"预测，退化时再回落到收敛率粗估
    let oppCands = humanForecast ? humanForecast.effectivePool : range;
    if(!humanForecast && avgShrink>0.45) oppCands = Math.max(1, Math.ceil(range/2)); // 有章法的推进：按二分收敛估
    else if(!humanForecast && avgShrink>0.3) oppCands = Math.max(1, Math.ceil(range*0.7));
    // 对手出手次数计入加速续猜（公开buff）：带2层加速的对手终局命中率是裸估的3倍
    const oppHitProb = humanForecast ? Math.max(Math.min(1, (1+(human.speed||0))/oppCands), humanForecast.hitProb) : Math.min(1, (1+(human.speed||0))/oppCands);
    const oppDmgExp = humanCanHit ? oppHitProb * Math.max(1, humanMaxDmg) : 0; // 对手下回合的期望伤害

    // 0) 确知炸弹（验证器命中过）→ 全力斩杀链，必中
    //    但被冰封时命中不炸——斩杀链白搭，这回合先控盘等冰化
    if(known!==null && !ai.frozen && !human.dormant){ // 对手休眠设伏：确知也不撞，命中被吞还送+2（走6.5的skip/贴边钓鱼）
        if(lvl>=3 && ready('empower') && humanDefensed && ready('volley')) push('empower'); // 赋能只喂连击：增伤件不消耗赋能，给了是空转
        if(ready('double')) push('double');
        if(ready('allin') && ai.hp>=2) push('allin');
        if(lvl>=3 && ready('rampage')) push('rampage');
        if(ready('bomblet')) push('bomblet');
        if(humanDefensed){ if(ready('volley')) push('volley'); else if(ready('pierce') && human.shield>0) push('pierce'); }
        if(ai.hp<ai.maxHP && ready('lifesteal')) push('lifesteal');
        if(lvl>=4 && ready('speed')) push('speed'); // 保险：万一被冰封/伪装还能续猜
        return plan;
    }

    // 1) 保命优先：残血，或对面已武装且自己扛不住一波，或对面伤害已够秒我且范围够小（真实死亡威胁）
    const inDanger = ai.hp<=2 || (humanArmed && humanCanHit && ai.hp<=4) || (humanCanHit && humanMaxDmg>=ai.hp && range<=12);
    if(inDanger){
        if(ai.hp<ai.maxHP && ready('heal')) push('heal');
        if(ready('rebirth') && !ai.rebirth) push('rebirth');
        if(ready('shield')) push('shield');
        if(lvl>=3 && ready('reflect')) push('reflect');
    }

    // 2) 反制人类武装回合：先控住再谈其他（他被冰封/暂停时武装打不出来，不浪费控制件）
    if(humanArmed && humanCanHit){
        if(ready('pause')) push('pause');
        if(lvl>=3 && ready('freeze')) push('freeze');
        // 禁猜中点：人类多半猜中点，直接废掉他蓄势已久的武装回合
        if(lvl>=3 && ready('forbid')) push('forbid');
        // 残血又被武装锁定：伪装真身，他的斩杀变空炮还暴露位置
        if(lvl>=3 && ready('disguise') && ai.hp<=3) push('disguise');
        if(!plan.includes('shield') && ready('shield')) push('shield');
        if(ready('reflect')) push('reflect');
        if(lvl>=3 && ready('dormant')) push('dormant');
        if(lvl>=3 && ready('lock') && human.skills.length>0) push('lock'); // 顺手封掉对手一个关键件
    }

    // 2.5) 反情报：对手线索已多 → 移动炸弹作废他的全部推理成果（公平的战术核按钮）
    //      但自己快解开（候选≤5或已确知）时绝不掀——作废自己的胜机才是真的蠢
    if(lvl>=3 && humanThreat>=2 && known===null && (!cands || candCount>5) && Math.random()<(lvl>=4?1:0.85)){
        // 移动是秘密的：对手不知道炸弹挪了窝，会继续抱着过期的线索自信地猜错——首选阴招
        if(ready('move')) push('move');
        if(lvl>=4 && ready('disguise')) push('disguise');
        if(ready('blind')) push('blind');       // 致盲：他这回合变瞎子，刚算的推理用不上
        if(lvl>=4 && ready('fog')) push('fog'); // 迷雾：反馈反转，他的范围判断被自己误导
        if(ready('pause')) push('pause');
    }

    // 2.6) 反运气斩杀线：范围≤5时对手裸猜命中率≥20%——自己没有线索优势就别跟他赌运气：
    //      潮汐稀释范围（命中率直接腰斩）、伪装换假身（猜假身不炸还暴露）、致盲让他凭记忆乱枪打鸟
    if(lvl>=3 && range<=5 && known===null && (!cands || candCount>2)){
        if(range<=4 && humanCanHit && humanMaxDmg>=ai.hp && ready('pause')) push('pause'); // 他一发能秒我：先偷走他的回合
        if(ready('tide')) push('tide');
        if(lvl>=4 && ready('disguise')) push('disguise');
        if(ready('blind')) push('blind');
    }

    // 3) 范围压缩（先于信息技能：压缩后的范围更小，线索过滤更精准）
    //    有信息技跟进时中等范围也值得二分：压缩+线索一套连招直接锁区
    const infoFollow = ['detect','digitsum','peek','precognition','verifier'].some(id=>ready(id));
    if(range>40 || (lvl>=4 && range>10) || (lvl>=3 && range>16 && infoFollow)){
        if(lvl>=3 && ready('empower') && ready('binary') && !plan.includes('empower')) push('empower'); // 赋能要在二分前面：赋能二分=连砍两刀
        if(ready('binary')) push('binary');
        else if(lvl>=3 && ready('blackhole') && Math.random()<0.5) push('blackhole');
    }
    // 小范围二分=直接收敛：范围2→1必中，范围3-4→砍半锁定
    if(lvl>=3 && ready('binary') && range>1 && range<=4 && !plan.includes('binary')) push('binary');

    // 4) 信息战（核心）：提示类技能拿到就用——哪怕被对面侦察到冷却，信息也是净赚；
    //    线索不过期（炸弹挪不动了），早拿早享受交集过滤，攒着不用才是纯亏
    const b = G.aiBrain;
    const clueCount = b ? ((b.parity!==null?1:0)+(b.lastDigit!==null?1:0)+(b.digitSum!==null?1:0)+(b.tens!==null?1:0)+(b.digits!==null?1:0)+(b.thermo?1:0)) : 0;
    const anyInfoReady = ['detect','digitsum','peek','precognition'].some(id=>ready(id));
    // 只要范围还没锁死、线索没拿满，信息技能就直接放（不再等候选变少——候选少时线索同样是确认器）
    // infoWanted=false 的另一层含义：信息技能全在冷却时，不得按"候选将减半"的幻影概率估算斩杀
    const infoWanted = anyInfoReady && range>2
        && clueCount<(lvl>=4?4:(lvl===3?3:2));
    if(infoWanted){
        // 不互斥：一回合可同时拿 探测+透视+数字和，交集后候选常常只剩个位数；已知的线索不重复拿
        if(ready('detect') && !(b && b.digits!==null)) push('detect'); // 已知位数，探测零信息量不拿
        if(ready('digitsum') && !(b && b.digitSum!==null)) push('digitsum');
        if(ready('peek') && !(b && b.lastDigit!==null)) push('peek');
        if(ready('precognition') && !(b && b.tens!==null)) push('precognition');
    }
    // 验证器：候选较少时验证“当前最值得怀疑”的数字——中了立刻确知，没中也能排除最优猜点
    if(ready('verifier') && candCount>1 && candCount<=(lvl>=4?14:(lvl>=3?6:3))) push('verifier');
    // 侦察：对手埋雷/设禁猜/伪装（动作公开、数字保密）→ 必侦察看穿；否则大师低概率顺手刺探
    // 侦察=拿对手冷却视野（威胁评估立刻精确化）：对手行为可疑就刺探，大师也会例行刺探
    if(lvl>=3 && ready('scout') && (ai.scoutVision||0)<=0){
        if((G.humanSuspicion||0)>=1 || avgShrink>0.4) push('scout');
        else if(lvl>=4 && human.skills.length>0 && Math.random()<0.3) push('scout');
    }
    if(lvl>=3 && topGuessScore>=0.78 && range<=16){
        if(ready('forbid')) push('forbid');
        else if(ready('trap')) push('trap');
    }

    // 4.5) 终局精确博弈：对手下回合命中概率到临界值就必须拆台——
    //      首选秘密挪弹（直接作废他全部推理，零信息暴露），再抢轮次；他能秒我时阈值更宽
    if(lvl>=3 && (oppHitProb>=0.2 || (humanCanHit && humanMaxDmg>=ai.hp && oppHitProb>=0.12) || range<=8+humanThreat*2)){
        if(known===null && (oppHitProb>=0.34 || (humanCanHit && humanMaxDmg>=ai.hp && oppHitProb>=0.2))){
            if(ready('move')) push('move');
        }
        if(ready('pause')) push('pause');
        if(lvl>=4 && ready('freeze')) push('freeze');
        if(lvl>=4 && ready('dormant')) push('dormant');
        if(lvl>=4 && ready('speed') && candCount<=4) push('speed'); // 抢在他命中之前先收完
    }

    // 5) 斩杀线精算：估算本回合最大爆发，够杀或赔率合适就全力叠伤
    let mult = (ai.doubleDamage||0)+(ai.allinMultiplier||0);
    if(ready('double')) mult += 2;
    if(ready('allin') && ai.hp>=3) mult += 3;
    let estDmg = mult>0 ? mult : 1;
    if(ready('bomblet')) estDmg += 2;
    estDmg *= (ai.rampageMulti||1);
    if(ready('rampage')) estDmg *= 2;
    // 愤怒/骰子增伤入账：本轮已挂的愤怒直接计入；还捏着且血量缺口够 → 编入斩杀链（增伤件之前放）
    const angerBonus = Math.floor((ai.maxHP-ai.hp)/2);
    const angerInChain = lvl>=3 && ready('anger') && angerBonus>=1;
    if(ai.anger || angerInChain) estDmg += angerBonus;
    estDmg += (ai.diceBonus||0);
    // 有效伤害=穿透防御后的真实输出：盾/反各挡1段，连击拆段只有穿过去的算钱；重生≈多2血
    const defLayers = Math.max(0,human.shield||0)+Math.max(0,human.reflect||0);
    const volleySegs = (humanDefensed && ready('volley')) ? (plan.includes('empower')?5:3) : 1;
    const effDmg = defLayers>0 ? Math.max(1,Math.round(estDmg/volleySegs))*Math.max(0,volleySegs-Math.min(defLayers,volleySegs)) : estDmg;
    const canLethal = effDmg >= human.hp + aiRebirthBonus(human);
    // 读人成果（软线索）：没有硬线索时给斩杀估算一个保守口径——软候选按1.5倍计入（约6折信任），
    // 体现"宁可被钓也要会跟注，但不下全部身家"；硬线索照旧全信
    const softCands = (cands===null && lvl>=3) ? aiCandidates(false) : null;
    // 命中概率按“放完信息技能后候选数约减半”乐观估计
    let estCand = infoWanted ? Math.max(1, Math.floor(candCount/2)) : candCount;
    if(!infoWanted && cands===null && softCands && softCands.length>0 && softCands.length<candCount){
        estCand = Math.max(1, Math.ceil(softCands.length*1.5));
    }
    // 计划里的小范围二分=直接收敛：范围2→1必中，范围3-4→砍半锁定，斩杀估算必须计入
    if(plan.includes('binary') && range<=4) estCand = Math.min(estCand, Math.max(1, Math.ceil(range/2)));
    const estHit = 1 / estCand;
    // 有效命中：加速续猜=本回合多次出手机会，候选数≤出手次数则必中
    const guessTries = 1 + ai.speed + (ready('speed') ? 1 : 0);
    const effHit = lvl>=3 ? Math.min(1, guessTries / estCand) : estHit;
    // 出手意愿：纯按数学期望判定（能杀/期望为正才叠伤），大师阈值更激进；逆风时再放宽
    const wMod = G.aiBehind ? 0.06 : 0;
    const willing = ((canLethal && effHit>=0.12-wMod) || (effHit>=0.34-wMod && mult>0) || (human.hp<=2 && effHit>=0.1)
        || (lvl>=4 && mult>0 && effHit>=0.25-wMod)) && !(human.dormant && lvl>=3); // 大师出手更狠：有增伤、三成把握就敢all-in；对手休眠设伏时增益会打进陷阱，不叠
    if(willing){
        if(angerInChain) push('anger'); // 愤怒本轮生效，放增伤件之前
        if(lvl>=3 && ready('empower') && humanDefensed && ready('volley')) push('empower'); // 赋能只喂连击（5段破防）
        if(ready('double')) push('double');
        if(ready('allin') && !ai.frozen && ai.hp>=(lvl>=4?2:3)) push('allin'); // 冰封回合不赌孤注一掷：猜错自伤、猜中也白搭；大师2血也敢赌
        if(lvl>=3 && ready('rampage')) push('rampage');
        if(ready('bomblet')) push('bomblet');
        if(humanDefensed){
            if(lvl>=3 && ready('empower') && ready('volley') && !plan.includes('empower')) push('empower'); // 赋能连击5段：盾/反/重生全穿
            if(ready('volley')) push('volley'); else if(ready('pierce') && human.shield>0) push('pierce');
        }
        if(lvl>=4 && ready('speed') && estCand<=4) push('speed'); // 候选少：买续猜提高收割率
        if(ai.hp<=ai.maxHP-2 && ready('lifesteal')) push('lifesteal');
    }
    // 续猜必杀：候选数 ≤ 出手次数时买加速，本回合必中
    if(lvl>=3 && ready('speed') && estCand>1 && estCand<=ai.speed+2 && !plan.includes('speed')) push('speed');

    // 6) 人类逼近时的破坏与埋雷
    if(range<=(lvl>=4?12:8) && lvl>=3){
        if(ready('pause')) push('pause');
        if(lvl>=4 && ready('freeze')) push('freeze');
        if(ready('forbid')) push('forbid');
        else if(ready('trap')) push('trap');
        if(lvl>=4){
            if(ready('disguise')) push('disguise');
            if(ready('web')) push('web');
            if(ready('blind') && Math.random()<0.5) push('blind');
            if(ready('fog') && Math.random()<0.4) push('fog');
        }
        // 掀桌只在自己没有线索优势时（否则作废的是自己的推理成果）；对手情报多时必掀
        // 移动优先：秘密挪窝，对手的过期线索会变成他的坟墓
        if((Math.random()<(lvl>=4?0.6:0.35) || humanThreat>=2) && (!cands || candCount>8)){
            if(ready('move')) push('move');
        }
    } else if(range<=12){
        if(ready('forbid')) push('forbid');
        else if(ready('trap')) push('trap');
        if(lvl===3 && ready('blind') && Math.random()<0.4) push('blind');
    }

    // 6.8) 单技能独立时机：不依赖连招，每个技能有自己的出场理由（没抽到组合也照用）
    if(known===null && lvl>=3){
        // 黑洞：范围还大就稳定缩圈（二分冷却时的第二缩圈手，与二分错开用）
        if(ready('blackhole') && range>=24 && !plan.includes('binary')) push('blackhole');
        // 潮汐：对手拿了情报、范围却不大 → 主动稀释范围，让他刚算的命中率跳水
        if(ready('tide') && humanThreat>=1 && range<=24) push('tide');
        // 封锁：对手有信息/缩圈技能待命 → 随机封一个，拖慢他的推理节奏
        if(ready('lock') && humanThreat>=1 && human.skills.length>0 && !plan.includes('lock')) push('lock');
        // 蛛网：范围越小雷区覆盖率越高，小范围防守利器（盲猜区±3全变雷）——但别等缩到个位数才埋，中小范围就铺
        if(ready('web') && range<=18 && !plan.includes('web')) push('web');
        // 禁猜/陷阱：即使对手没逼近，中小范围时埋在中点也有不错的拦截率
        if(range<=12 && !plan.includes('forbid') && !plan.includes('trap')){
            if(ready('forbid')) push('forbid');
            else if(ready('trap')) push('trap');
        }
        // 穿透：已叠了伤且对手有盾 → 独立补穿透，不绑死斩杀链
        if(ready('pierce') && human.shield>0 && !plan.includes('pierce')
            && (plan.includes('double')||plan.includes('allin')||plan.includes('rampage')||plan.includes('bomblet'))) push('pierce');
        // 赋能+移动：赋能后挪10格，过期线索错得更离谱（反情报升级版）
        if(lvl>=4 && ready('empower') && plan.includes('move') && !plan.includes('empower') && plan.length<maxSkills){
            plan.splice(plan.indexOf('move'), 0, 'empower'); // 赋能必须插在移动前面
        }
    }

    // 6.5) 借力打力：复制对手的强技；架好反射后主动跳过回合诱攻
    if(lvl>=3 && ready('copy') && human.skills.some(s=>['double','allin','rampage','volley','heal','reflect'].includes(s.id))) push('copy');
    if(lvl>=3 && ready('skip') && ai.reflect>0 && (humanArmed || human.hp<=3 || humanThreat>=2)) push('skip');
    if(ai.frozen && ready('skip')) push('skip'); // 被冰封：直接跳过等冰化，不浪费命中机会
    if(human.dormant && lvl>=3 && ready('skip') && known!==null) push('skip'); // 对手休眠设伏：已确知也不踩，跳过让它白埋伏

    // 7) 后勤续航
    if(ready('refresh') && ['double','allin','rampage','volley'].some(id=>ai.skills.some(s=>s.id===id)&&(ai.cooldowns[id]||0)>0)) push('refresh');
    if(ready('charge') && Object.keys(ai.cooldowns).some(k=>ai.cooldowns[k]>0) && Math.random()<0.6) push('charge');
    if(ready('rebirth') && !ai.rebirth) push('rebirth'); // 重生=免费保险：拿到就挂上，别等残血（挂了的不重复挂）
    if(lvl>=3 && ready('anger') && (ai.maxHP-ai.hp)>=4) push('anger');

    // 7.5) 存款回合：双倍/子母弹/狂暴/吸血"猜错不失效"=本回合内不过期的存款——
    //      翻倍可以多次累乘，越早叠越赚；炸弹已挪不动（洗牌/虫洞已删），叠了不怕被掀桌
    if(!willing && lvl>=2 && !ai.frozen && !human.dormant){ // 对手休眠设伏时增益会打进陷阱，不存款
        if(ready('double')) push('double');
        if(ready('bomblet')) push('bomblet');
        if(lvl>=3 && ready('rampage')) push('rampage'); // 翻倍多次累乘：没事干就叠，别等确知炸弹才放
        if(lvl>=3 && ready('lifesteal') && ai.hp<ai.maxHP) push('lifesteal');
        if(ready('heal') && ai.hp<ai.maxHP) push('heal'); // 满血前治疗也是白赚的存款
    }

    // 8) 博弈小注
    if(ready('dice') && (willing || ai.hp<=Math.ceil(ai.maxHP/2)) && Math.random()<0.5) push('dice'); // +3伤配攻击回合才不浪费；残血赌回血
    if(ready('gambler') && G.aiBehind && human.hp>ai.hp && Math.random()<0.6) push('gambler'); // EV=0的方差币：逆风翻盘才开，顺风开赌=送翻盘

    // 9) 估值填充：还有空位且本回合没排爆发时，给剩余可用技能打期望分，补上最值的
    //    （每个技能的分数=它这个回合能换来的数学期望，低于1.5分不出手——不值得为它暴露节奏）
    if(lvl>=3 && plan.length<maxSkills && !plan.includes('double') && !plan.includes('allin')){
        const ev = [];
        const add = (id, score) => { if(score>=1.5 && ready(id) && !plan.includes(id)) ev.push([score, id]); };
        if(candCount>3 && !infoWanted){ // 信息技：候选还多时，一条线索≈把候选砍一个数量级
            add('binary', Math.log2(range));
            add('detect', candCount>=8 ? 2.0 : 0);
            add('peek', candCount>=6 ? 2.2 : 0);
            add('digitsum', candCount>=6 ? 2.2 : 0);
            add('precognition', candCount>=6 ? 2.0 : 0);
        }
        // 控制技：对手下回合期望伤害越高越值
        add('pause', oppDmgExp>=0.5 ? oppDmgExp*4 : 0);
        add('freeze', lvl>=4 && oppDmgExp>=0.5 ? oppDmgExp*3 : 0);
        add('blind', oppHitProb>=0.2 ? 1.5 : 0);
        add('numberslash', ai.slashActive>0 ? 0 : 2.0); // 数字斩：3回合≈1点期望收益，白捡的（生效中不重复用）
        add('speed', ai.slashActive>0 && candCount<=6 ? 1.8 : 0); // 数字斩生效中：每多一次出手=多0.5攻/疗，买续猜加速积攒
        // 交换：对手技能池按牌面估价明显比我强才换（与选技共用同一张价值表）
        if(ready('swap')){
            const pool = pl => pl.skills.reduce((a,s)=>a+(AI_TUNE.skillTier[s.id]||5),0);
            if(pool(human) >= pool(ai)+4) add('swap', 3);
        }
        // 防御技：残血时活着才有输出
        if(ai.hp<=3){ add('shield', oppDmgExp*3); add('heal', ai.hp<ai.maxHP ? 2 : 0); }
        // 秘密挪弹：对手威胁越实越值（零暴露成本，作废的是他的推理）
        if(known===null && humanThreat>=2){ add('move', humanThreat*1.5); }
        ev.sort((x,y)=>y[0]-x[0]);
        for(const e of ev){ if(plan.length>=maxSkills) break; push(e[1]); }
    }

    // 互斥收尾：跳过=本回合作废——同排的暂停（抢对手回合）与加速（本回合续猜）都会被它白扔掉
    if(plan.includes('skip')){
        ['pause','speed'].forEach(id=>{ const i=plan.indexOf(id); if(i>=0) plan.splice(i,1); });
    }
    return plan;
}

// 信息技能放完后动态追加决策：看着刚拿到的线索决定要不要补刀/进一步确认
function aiTopUp(ai, human, used){
    const lvl = aiEffectiveLevel();
    if(lvl<2) return [];
    const ready = id => !used[id] && ai.skills.some(s=>s.id===id) && (ai.cooldowns[id]||0)<=0 && ai.lockedSkill!==id && ai.secondLockedSkill!==id;
    let cands = aiCandidates(true); // 追加爆发=下重注：只认硬线索
    if(cands && cands.length===0){ aiHandleContradiction(); cands=null; }
    const known = aiKnownBomb();
    const candCount = known!==null ? 1 : ((cands && cands.length>0) ? cands.length : (_aiRHi()-_aiRLo()+1));
    const out = [];
    const push = id => { if(out.length<3 && !out.includes(id) && ready(id)) out.push(id); };
    if((known!==null || candCount<=4) && !human.dormant){ // 对手休眠设伏：爆发被吞还送+2，改走压缩/确认磨过去
        // 线索已收敛 → 直接补爆发收割
        if(lvl>=3) push('empower');
        push('double');
        if(ai.hp>=3 || (lvl>=4 && ai.hp>=2)) push('allin');
        if(lvl>=3) push('rampage');
        push('bomblet');
        if(human.shield>0 || human.reflect>0 || human.rebirth){ push('volley'); push('pierce'); }
        if(lvl>=4) push('speed');
    } else if(candCount<=10){
        // 还不够精确 → 再确认/再压缩
        if(lvl>=3) push('verifier');
        push('binary');
        if(lvl>=4) push('speed');
    }
    // 终局抢轮次：砍不动就偷走对手的下回合
    if((_aiRHi()-_aiRLo()+1)<=8 && lvl>=3){
        push('pause');
        if(lvl>=4) push('freeze');
    }
    return out;
}

// 猜数决策（纯选择，不碰 DOM 不执行）：返回 {guess, usedClues}
// 本猜命中率写入 G.aiLastGuessP（仅线索制导猜>0），供情报污染检测使用；故意求不中的猜不计
function aiChooseGuess(ai){
    const range=_aiRHi()-_aiRLo()+1;
    const lvl=aiEffectiveLevel();
    G.aiLastGuessP = 0;
    const known = aiKnownBomb();
    let guess;
    let usedClues = false; // 本猜是否基于确知/候选（盲猜才允许躲雷，稳杀局绝不让步）
    if(ai.frozen && lvl>=3 && !ai.blind){
        // 被冰封：命中不炸也不缩范围，猜错反而正常缩——故意贴边"求不中"，下回合冰化再杀
        guess = Math.random()<0.5 ? _aiRLo()+1 : _aiRHi()-1;
        guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess));
    } else if(getPlayer('p1').dormant && lvl>=3 && !ai.blind){
        // 对手休眠设伏：命中=白打还送+2——贴边钓鱼降低踩中率，即使确知炸弹也绝不撞埋伏
        guess = Math.random()<0.5 ? _aiRLo()+1 : _aiRHi()-1;
        guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess));
    } else if(known!==null && !ai.blind && lvl>=2){
        guess = known; usedClues = true; G.aiLastGuessP = 1; // 验证器命中过，直接收割
    } else if(ai.blind){
        guess = Math.floor(Math.random()*range)+_aiRLo(); // 被致盲：只能瞎猜
    } else {
        // 反读心迷彩（装糖）：刚用秘密提示技——这一猜故意避开刚拿到的线索，
        // 让围观读猜测流的人读到假规律。代价：本猜只吃范围收缩的诚实收益
        let camoGuess = null;
        if(G.aiCamo && lvl>=3){
            G.aiCamo = false;
            const b = G.aiBrain;
            const pool = [];
            for(let n=_aiRLo(); n<=_aiRHi(); n++){
                if(b){
                    if(b.lastDigit!==null && n%10===b.lastDigit) continue;
                    if(b.digitSum!==null && aiDigitSum(n)===b.digitSum) continue;
                    if(b.digits!==null && String(n).length===b.digits) continue;
                    if(b.tens!==null && Math.floor(n/10)%10===b.tens) continue;
                    if(b.parity!==null && n%2===b.parity) continue;
                }
                pool.push(n);
            }
            if(pool.length>0) camoGuess = pool[Math.floor(Math.random()*pool.length)];
            // 池空=线索已锁死全部候选，放弃迷彩正常打
        }
        if(camoGuess!==null){
            guess = camoGuess; // usedClues保持false：迷彩猜不计入线索制导，SPRT污染检测不误判
        } else {
        let cands = null, wc = null;
        if(lvl>=3) wc = aiWeightedCands(); // 困难起：硬线索过滤 + 软线索概率加权
        else if(lvl===2 && Math.random()<0.9) cands = aiCandidates(); // 普通AI偶尔走神
        else if(lvl===1 && Math.random()<0.6) cands = aiCandidates(); // 简单AI也会用线索，只是经常想不起来
        if(wc && wc.length===0){ aiHandleContradiction(); wc=null; } // 线索矛盾：首次容忍，连续才清洗（ai-brain.js）
        if(cands && cands.length===0){ aiHandleContradiction(); cands=null; }
        if(wc && wc.length>0){
            usedClues = true;
            let totW = 0; wc.forEach(o=>{ totW+=o.w; });
            const best = aiPickBestWeightedGuess(wc, ai, getPlayer('p1'));
            const pick = wc.find(o=>o.n===best) || wc[0];
            guess = pick.n;
            G.aiLastGuessP = pick.w/totW;
        } else if(cands && cands.length>0){
            usedClues = true;
            const uw = cands.map(n=>({ n:n, w:1 }));
            guess = aiPickBestWeightedGuess(uw, ai, getPlayer('p1'));
            G.aiLastGuessP = 1/cands.length;
            if(lvl<=2 && range>4){ // 简单/普通AI带点抖动，不够精准
                guess += (Math.random()<0.5?-1:1)*Math.floor(Math.random()*3);
                guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess));
            }
        } else {
            const mid = (_aiRLo()+_aiRHi())/2;
            const fishRate = G.aiBehind ? 0 : (lvl>=4 ? 1 : 0.5); // 逆风不钓鱼：全速中点收敛抢回节奏
            // 大师只在范围很大时才钓鱼——范围≤12直接中点切割，快速收敛压迫感拉满
            const fishRange = lvl>=4 ? 12 : 4;
            // 钓鱼的数学前提：手里有"私有信息优势"（信息技就绪）——把范围撑大，对手的裸猜命中率就一直趴在地板上，
            // 而自己靠线索收敛。没有信息优势时钓鱼=白白放慢自己的斩杀节奏，必须中点切割全速收敛抢先命中
            const infoEdge = ['detect','digitsum','peek','precognition'].some(id=>
                ai.skills.some(s=>s.id===id) && (ai.cooldowns[id]||0)<=0 && ai.lockedSkill!==id && ai.secondLockedSkill!==id);
            // 反制钓鱼：自己没有信息优势、但对手行为可疑（逼近答案）时，也贴边猜——
            // 中点切割会把共享范围喂给他收敛，宁可自己慢一点也不送这个信息
            const denyEdge = !infoEdge && (G.humanSuspicion||0)>=2 && Math.random()<0.5;
            if(lvl>=3 && range>fishRange && (infoEdge || denyEdge) && Math.random()<fishRate){
                // 钓鱼猜法（高手策略）：猜贴边数字。命中概率与中点完全相同(1/range)，
                // 但猜错范围只缩1格——不给对手送信息；对手的中点猜法反而替我们缩圈。
                // 若炸弹恰好在最边缘(1/range概率)，范围直接塌缩成1格，下回合必中。
                guess = Math.random()<0.5 ? _aiRLo()+1 : _aiRHi()-1;
            } else if(lvl===1){
                // 简单AI：中点附近大范围乱飘（不再是全范围纯随机）
                const spread=Math.max(1, Math.floor(range*0.3));
                guess=Math.max(_aiRLo(), Math.min(_aiRHi(), Math.round(mid+(Math.floor(Math.random()*(spread*2+1))-spread))));
            } else if(lvl===2){
                const spread=Math.max(1, Math.floor(range*0.15));
                const offset=Math.floor(Math.random()*(spread*2+1))-spread;
                guess=Math.max(_aiRLo(), Math.min(_aiRHi(), Math.round(mid+offset)));
            } else {
                guess = Math.round(mid); // 范围已小：中点切割快速收敛
            }
            guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess));
        }
        } // /迷彩落空时的正常猜法分支
    }
    // 对手本回合发动了陷阱/禁猜（动作公开、数字保密），人类最爱埋正中点——AI避开
    // 仅限盲猜：确知/有候选时躲雷=放弃稳杀，聪明反被聪明误（踩雷掉1血也远小于放过必中）
    if(lvl>=3 && !usedClues && (G.humanTrap || G.humanForbid) && guess===Math.floor((_aiRLo()+_aiRHi())/2)){
        guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess + (Math.random()<0.5?-1:1)));
    }
    return { guess:guess, usedClues:usedClues };
}
