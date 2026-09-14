// ============================================================================
// ai-strategy.js —— AI 决策骨架：回合技能规划 / 动态追加 / 猜数选择
// 职责：回答"这回合该干什么"。纯选择逻辑，不碰 DOM、不执行动作
//   （aiChooseGuess 只返回选好的数，执行在 ai.js 的 aiGuess 里）
// 本文件只放"所有难度共用的决策流程"。难度差异全部在各难度文件中：
//   ai-easy.js(简单) ai-normal.js(普通) ai-hard.js(困难) ai-master.js(大师)
//   通过 AI_LEVEL_PROFILES 档案注入旋钮（maxSkills/verifierCandMax/fishRate...）
//   与专属钩子：assess(威胁评估修正) / hookMid(规划中盘追加) / hookLate(规划收尾追加)
//   要优化哪个难度，直接去改那个难度的文件，本骨架不用动
// 依赖：ai-brain.js（信念/档案）、ai-observe.js（观察）、ai-skills.js（技能熟练）
// ============================================================================

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
// 加权候选上的最优猜点：命中收益 + 信息增益 + 节奏摆动（猜丢后双方在新子范围里的再命中率差）
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

// AI 回合技能规划：按局势返回一串要连放的技能id（有先后顺序，赋能必须在被强化技能前面）
// 骨架只含通用打法；难度专属打法走 prof.assess / prof.hookMid / prof.hookLate
function aiPlanSkills(ai, human){
    if(!G.isSkillMode || ai.skills.length===0){ G.aiRaceState=null; return []; } // 无规划即无赛跑评估：清掉残留状态，防猜数层读到过期结论
    const prof = aiProfile();
    const adv = prof.advanced, mst = prof.master;
    const ready = id => ai.skills.some(s=>s.id===id) && (ai.cooldowns[id]||0)<=0 && ai.lockedSkill!==id && ai.secondLockedSkill!==id;
    // 对手公开技能冷却档案：每AI回合tick一次（≈对手每回合转1格），换回合重置（技能重发）
    if(G.aiOppCdRound!==G.roundCount){ G.aiOppCd={}; G.aiOppCdRound=G.roundCount; }
    if(G.aiOppCd){ for(const k in G.aiOppCd){ if(G.aiOppCd[k]>0) G.aiOppCd[k]--; } }
    if(prof.randomPlan){
        // 乱丢技能模式（简单AI）：偶尔丢一个不咬人的技能
        if(Math.random()<prof.randomPlanSkip) return [];
        const ok = ai.skills.map(s=>s.id).filter(id=>ready(id)&&prof.neverUse.indexOf(id)<0);
        return ok.length ? [ok[Math.floor(Math.random()*ok.length)]] : [];
    }
    // 每回合连放上限：与持有技能数硬挂钩（+1留给刷新/充能/复制联动），
    // 玩家每回合反而没有此限制——这是AI的自我约束，不是特权
    const maxSkills = Math.min(prof.maxSkills, ai.skills.length + 1);
    const plan = [];
    const push = id => { if(plan.length<maxSkills && !plan.includes(id)) plan.push(id); };
    const range = _aiRHi() - _aiRLo() + 1;
    let cands = aiCandidates(true); // 技能规划=下重注：只认硬线索，软线索（模式挖掘）不得参与
    if(cands && cands.length===0){ aiHandleContradiction(); cands=null; } // 线索矛盾：首次容忍，连续才清洗（ai-brain.js）
    const known = aiKnownBomb();
    const candCount = known!==null ? 1 : ((cands && cands.length>0) ? cands.length : range);
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
    const humanGuessMap = aiPredictHumanGuessMap(hView.low, hView.high, prof.forecastDepth);
    const topGuessScore = humanGuessMap.length ? humanGuessMap[0].score : 0;
    let humanThreat = (G.humanSuspicion||0)
        + (avgShrink>0.45?1:0) // 收敛接近二分效率：不是瞎猜，是有章法的推进
        + (oppCdReady('verifier')?1:0)
        + (oppCdReady('binary')?1:0);
    if(humanForecast && humanForecast.confidence>=0.55) humanThreat += 1;
    if(humanForecast && humanForecast.effectivePool<=4) humanThreat += 1;
    // 侦察发现炸弹数 > 1+自己埋的 = 对手偷偷裂变过（人类思维：他不急着猜反而在布场，必有后续）→ 威胁上调
    if(G.aiBrain && G.aiBrain.bombCount && G.aiBrain.bombCount > 1+(G.aiSacUsed||0)) humanThreat += 1;
    // 下回合预案（看懂对面技能栏）：对手捏着≥2件新鲜爆发件（双倍/孤注/翻倍/连击就绪）——
    // 他现在没叠buff≠下回合不叠，一套上膛就是斩杀——威胁上调，提前按武装对待
    const humanReadyBurst = adv ? ['double','allin','rampage','volley'].filter(id=>oppCdReady(id)).length : 0;
    if(humanReadyBurst>=2) humanThreat += 1;
    // 对面交换就绪而我的好牌新鲜：攒牌=替他攒的——威胁上调，好牌宁可以存款形式立刻用掉也别留在手里
    if(adv && oppCdReady('swap') && ai.skills.some(s=>['double','allin','rampage','volley'].includes(s.id) && (ai.cooldowns[s.id]||0)<=0)) humanThreat += 1;
    // 对手这回合伤不了我：冰封命中不炸 / 被暂停没有回合——别为空气交保命件
    const humanCanHit = !human.frozen && !human.skipNext;
    // 宏观节奏：血量落后或对手威胁逼近了——放弃钓鱼全速收敛，斩杀阈值也放宽
    G.aiBehind = ai.hp<=human.hp-2 || humanThreat>=3;
    // 对手命中概率估计（终局博弈的核心输入）：优先采用"候选池+习惯"预测，退化时再回落到收敛率粗估
    let oppCands = humanForecast ? humanForecast.effectivePool : range;
    if(!humanForecast && avgShrink>0.45) oppCands = Math.max(1, Math.ceil(range/2)); // 有章法的推进：按二分收敛估
    else if(!humanForecast && avgShrink>0.3) oppCands = Math.max(1, Math.ceil(range*0.7));
    // 场上炸弹数估计（裂变时代）：提示技报过的精确值/自己埋的计数取大，对手秘密埋的不知道
    const estBombs = aiEstBombCount();
    // 对手出手次数计入加速续猜（公开buff）：带2层加速的对手终局命中率是裸估的3倍；多炸弹命中面按炸弹数放大
    const oppHitProb = humanForecast ? Math.max(Math.min(1, estBombs*(1+(human.speed||0))/oppCands), humanForecast.hitProb) : Math.min(1, estBombs*(1+(human.speed||0))/oppCands);
    const oppDmgExp = humanCanHit ? oppHitProb * Math.max(1, humanMaxDmg) : 0; // 对手下回合的期望伤害

    // 难度专属威胁评估（大师的线索污染风险/节奏赛跑等）：返回 riskUp/forceSabotage/scoutBoost 修正量
    const h = { ai:ai, human:human, plan:plan, push:push, ready:ready, range:range, cands:cands, known:known,
        candCount:candCount, humanArmed:humanArmed, humanDefensed:humanDefensed, humanMaxDmg:humanMaxDmg,
        oppCdReady:oppCdReady, avgShrink:avgShrink, humanForecast:humanForecast, topGuessScore:topGuessScore,
        humanThreat:humanThreat, humanCanHit:humanCanHit, oppCands:oppCands, oppHitProb:oppHitProb,
        oppDmgExp:oppDmgExp, maxSkills:maxSkills, prof:prof, adv:adv, mst:mst, estBombs:estBombs,
        humanReadyBurst:humanReadyBurst, oppCdKnown:oppCdKnown,
        infoWanted:false, estCand:candCount, willing:false, assess:null };
    const assess = prof.assess ? (prof.assess(h)||{}) : {};
    if(!prof.assess) G.aiRaceState = null; // 无评估钩子的难度：清掉可能残留的大师赛跑状态，防钓鱼门控读到过期结论
    h.assess = assess;
    const riskUp = assess.riskUp||0;           // 重注门槛修正（线索有污染风险时抬高）
    const forceSabotage = !!assess.forceSabotage; // 节奏赛跑落后：强拆抢轮次
    const scoutBoost = !!assess.scoutBoost;    // 提高侦察刺探频率

    // 0) 确知炸弹（验证器命中过）→ 全力斩杀链，必中
    //    但被冰封时命中不炸——斩杀链白搭，这回合先控盘等冰化
    if(known!==null && !ai.frozen && !human.dormant){ // 对手休眠设伏：确知也不撞，命中被吞还送+2（走6.5的skip/贴边钓鱼）
        if(adv && ready('empower') && humanDefensed && ready('volley')) push('empower'); // 赋能只喂连击：增伤件不消耗赋能，给了是空转
        if(ready('double')) push('double');
        if(ready('allin') && ai.hp>=2) push('allin');
        if(adv && ready('rampage')) push('rampage');
        if(ready('bomblet')) push('bomblet');
        if(humanDefensed){ if(ready('volley')) push('volley'); else if(ready('pierce') && human.shield>0) push('pierce'); }
        if(ai.hp<ai.maxHP && ready('lifesteal')) push('lifesteal');
        if(prof.knownSpeed && ready('speed')) push('speed'); // 保险：万一被冰封/伪装还能续猜
        return plan;
    }

    // 1) 保命优先：残血，或对面已武装且自己扛不住一波，或对面伤害已够秒我且范围够小（真实死亡威胁）
    const inDanger = ai.hp<=2 || (humanArmed && humanCanHit && ai.hp<=4) || (humanCanHit && humanMaxDmg>=ai.hp && range<=12);
    if(inDanger){
        // 绝境翻盘神技：如果血量大幅落后，先用天平平分血量
        if(prof.balanceDanger && ready('balance') && human.hp - ai.hp >= 3) push('balance');
        if(ai.hp<ai.maxHP && ready('heal')) push('heal');
        if(ready('rebirth') && !ai.rebirth) push('rebirth');
        if(ready('shield')) push('shield');
        if(adv && ready('reflect')) push('reflect');
    }

    // 2) 反制人类武装回合：先控住再谈其他（他被冰封/暂停时武装打不出来，不浪费控制件）
    //    对手≥2件新鲜爆发件也算"准武装"——他的斩杀链只差一点火，别等他先动手
    if((humanArmed || humanReadyBurst>=2) && humanCanHit){
        if(ready('pause')) push('pause');
        if(adv && ready('freeze')) push('freeze');
        // 禁猜中点：人类多半猜中点，直接废掉他蓄势已久的武装回合
        if(adv && ready('forbid')) push('forbid');
        // 残血又被武装锁定：伪装真身，他的斩杀变空炮还暴露位置
        if(adv && ready('disguise') && ai.hp<=3) push('disguise');
        if(!plan.includes('shield') && ready('shield')) push('shield');
        if(ready('reflect')) push('reflect');
        if(adv && ready('dormant')) push('dormant');
        if(adv && ready('lock') && human.skills.length>0) push('lock'); // 顺手封掉对手一个关键件
    }

    // 2.5) 反情报：对手线索已多 → 移动炸弹作废他的全部推理成果（公平的战术核按钮）
    //      但自己快解开（候选≤5或已确知）时绝不掀——作废自己的胜机才是真的蠢
    if(adv && humanThreat>=2 && known===null && (!cands || candCount>5) && Math.random()<prof.antiIntelRate){
        // 移动是秘密的：对手不知道炸弹挪了窝，会继续抱着过期的线索自信地猜错——首选阴招
        if(ready('move')) push('move');
        if(ready('blind')) push('blind');       // 致盲：他这回合变瞎子，刚算的推理用不上
        if(ready('pause')) push('pause');
    }

    // 2.6) 反运气斩杀线：范围≤5时对手裸猜命中率≥20%——自己没有线索优势就别跟他赌运气：
    //      潮汐稀释范围（命中率直接腰斩）、致盲让他凭记忆乱枪打鸟
    if(adv && range<=5 && known===null && (!cands || candCount>2)){
        if(range<=4 && humanCanHit && humanMaxDmg>=ai.hp && ready('pause')) push('pause'); // 他一发能秒我：先偷走他的回合
        if(ready('tide')) push('tide');
        if(ready('blind')) push('blind');
    }

    // 难度专属中盘钩子（大师：天平拆斩杀线/反情报升级/重注前再验证...）
    if(prof.hookMid) prof.hookMid(h);

    // 3) 范围压缩（先于信息技能：压缩后的范围更小，线索过滤更精准）
    //    有信息技跟进时中等范围也值得二分：压缩+线索一套连招直接锁区
    const infoFollow = ['detect','digitsum','peek','precognition','verifier'].some(id=>ready(id));
    if(range>40 || (prof.binaryEager && range>10) || (adv && range>16 && infoFollow)){
        if(adv && ready('empower') && ready('binary') && !plan.includes('empower')) push('empower'); // 赋能要在二分前面：赋能二分=连砍两刀
        if(ready('binary')) push('binary');
        else if(adv && ready('blackhole') && Math.random()<prof.blackholeAltRate) push('blackhole');
    }
    // 小范围二分=直接收敛：范围2→1必中，范围3-4→砍半锁定
    if(adv && ready('binary') && range>1 && range<=4 && !plan.includes('binary')) push('binary');

    // 裂变=平局器（人类式算计）：新弹随机无约束——已收敛一方命中率不变（他猜他的锁定候选照样中），
    // 落后方白捡命中面。所以信息发散/没收敛时埋弹才赚；已收敛马上收人头时埋弹=纯帮对手提速。
    // 前提：范围还放得下新炸弹（estBombs<range）；已确知准备收割时不放（多此一举还暴露节奏）
    if(adv && ready('sacrifice') && known===null && (!cands || candCount>3) && estBombs < range && range <= 25 && Math.random() < (range<=10?0.7:0.4)){
        push('sacrifice');
    }

    // 4) 信息战（核心）：提示类技能拿到就用——哪怕被对面侦察到冷却，信息也是净赚；
    //    线索不过期（炸弹挪不动了），早拿早享受交集过滤，攒着不用才是纯亏
    const b = G.aiBrain;
    const infoUsed = (b && b.infoUsed) || {}; // 侦察记忆：哪个特征这回合已经看过（看过了再看=零信息量空转）
    const clueCount = b ? ((b.parity!==null?1:0)+(b.lastDigit!==null?1:0)+(b.digitSum!==null?1:0)+(b.tens!==null?1:0)+(b.digits!==null?1:0)+(b.thermo?1:0)) : 0;
    const anyInfoReady = ['detect','digitsum','peek','precognition'].some(id=>ready(id));
    // 多炸弹（裂变）逐颗配对：场上炸弹变多但档案没跟上（对手偷埋/自己刚埋/档案数对不上）→ 像人一样先刷新情报再动手
    const featsStale = estBombs>1 && (!b || !b.bombFeats || b.bombFeats.length<estBombs
        || !(infoUsed.peek||infoUsed.precognition||infoUsed.digitsum||infoUsed.detect));
    // 只要范围还没锁死、线索没拿满，信息技能就直接放（不再等候选变少——候选少时线索同样是确认器）
    // infoWanted=false 的另一层含义：信息技能全在冷却时，不得按"候选将减半"的幻影概率估算斩杀
    const infoWanted = anyInfoReady && range>2 && (clueCount<prof.clueWanted || featsStale);
    h.infoWanted = infoWanted;
    if(infoWanted){
        // 不互斥：一回合可同时拿 探测+透视+数字和，交集后候选常常只剩个位数；
        // 侦察过的特征不重复看（多炸弹时提示技报全列表，用过一次=该特征全弹覆盖）
        if(ready('detect') && !infoUsed.detect && !(b && b.digits!==null)) push('detect');
        if(ready('digitsum') && !infoUsed.digitsum && !(b && b.digitSum!==null)) push('digitsum');
        if(ready('peek') && !infoUsed.peek && !(b && b.lastDigit!==null)) push('peek');
        if(ready('precognition') && !infoUsed.precognition && !(b && b.tens!==null)) push('precognition');
    }
    // 验证器：候选较少时验证“当前最值得怀疑”的数字——中了立刻确知，没中也能排除最优猜点
    if(ready('verifier') && candCount>1 && candCount<=prof.verifierCandMax) push('verifier');
    // 侦察：对手埋雷/设禁猜/伪装（动作公开、数字保密）→ 必侦察看穿；否则按难度基准频率顺手刺探
    if(adv && ready('scout') && (ai.scoutVision||0)<=0){
        if((G.humanSuspicion||0)>=1 || avgShrink>0.4) push('scout');
        else if(prof.scoutBase>0 && human.skills.length>0 && Math.random()<(scoutBoost?0.6:prof.scoutBase)) push('scout');
    }
    if(adv && topGuessScore>=0.78 && range<=16){
        if(ready('forbid')) push('forbid');
        else if(ready('trap')) push('trap');
    }

    // 4.5) 终局精确博弈：对手下回合命中概率到临界值就必须拆台——
    //      首选秘密挪弹（直接作废他全部推理，零信息暴露），再抢轮次；他能秒我时阈值更宽
    if(adv && (oppHitProb>=0.2 || (humanCanHit && humanMaxDmg>=ai.hp && oppHitProb>=0.12) || range<=8+humanThreat*2 || forceSabotage)){
        if(known===null && (oppHitProb>=0.34 || (humanCanHit && humanMaxDmg>=ai.hp && oppHitProb>=0.2))){
            if(ready('move')) push('move');
        }
        if(ready('pause')) push('pause');
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
    const angerInChain = adv && ready('anger') && angerBonus>=1;
    if(ai.anger || angerInChain) estDmg += angerBonus;
    estDmg += (ai.diceBonus||0);
    // 有效伤害=穿透防御后的真实输出：盾/反各挡1段，连击拆段只有穿过去的算钱；重生≈多2血
    const defLayers = Math.max(0,human.shield||0)+Math.max(0,human.reflect||0);
    const volleySegs = (humanDefensed && ready('volley')) ? (plan.includes('empower')?5:3) : 1;
    const effDmg = defLayers>0 ? Math.max(1,Math.round(estDmg/volleySegs))*Math.max(0,volleySegs-Math.min(defLayers,volleySegs)) : estDmg;
    const canLethal = effDmg >= human.hp + aiRebirthBonus(human);
    // 读人成果（软线索）：没有硬线索时给斩杀估算一个保守口径——软候选按1.5倍计入（约6折信任），
    // 体现"宁可被钓也要会跟注，但不下全部身家"；硬线索照旧全信
    const softCands = (cands===null && adv) ? aiCandidates(false) : null;
    // 命中概率按“放完信息技能后候选数约减半”乐观估计
    let estCand = infoWanted ? Math.max(1, Math.floor(candCount/2)) : candCount;
    if(!infoWanted && cands===null && softCands && softCands.length>0 && softCands.length<candCount){
        estCand = Math.max(1, Math.ceil(softCands.length*1.5));
    }
    // 计划里的小范围二分=直接收敛：范围2→1必中，范围3-4→砍半锁定，斩杀估算必须计入
    if(plan.includes('binary') && range<=4) estCand = Math.min(estCand, Math.max(1, Math.ceil(range/2)));
    // 本回合计划里排了裂变：技能先放完才猜，命中面按+1弹计入（先埋后猜，一气呵成）
    const planBombs = estBombs + (plan.includes('sacrifice') ? 1 : 0);
    // 单发命中≈炸弹数/候选数：多炸弹（裂变）命中面直接按倍数放大
    const estHit = Math.min(1, planBombs / estCand);
    // 有效命中：加速续猜=本回合多次出手机会，候选数≤出手次数×炸弹数则必中
    const guessTries = 1 + ai.speed + (ready('speed') ? 1 : 0);
    const effHit = adv ? Math.min(1, guessTries * planBombs / estCand) : estHit;
    // 出手意愿：纯按数学期望判定（能杀/期望为正才叠伤），willingExtra 是难度专属的激进阈值；逆风时再放宽
    const wMod = G.aiBehind ? 0.06 : 0;
    const willing = ((canLethal && effHit>=0.12-wMod) || (effHit>=0.34-wMod+riskUp && mult>0) || (human.hp<=2 && effHit>=0.1)
        || (mult>0 && effHit>=prof.willingExtra-wMod+riskUp)) && !(human.dormant && adv); // 对手休眠设伏时增益会打进陷阱，不叠
    h.estCand = estCand;
    h.willing = willing;
    if(willing){
        if(angerInChain) push('anger'); // 愤怒本轮生效，放增伤件之前
        if(adv && ready('empower') && humanDefensed && ready('volley')) push('empower'); // 赋能只喂连击（5段破防）
        if(ready('double')) push('double');
        if(ready('allin') && !ai.frozen && ai.hp>=prof.allinMinHp) push('allin'); // 冰封回合不赌孤注一掷：猜错自伤、猜中也白搭
        if(adv && ready('rampage')) push('rampage');
        if(ready('bomblet')) push('bomblet');
        if(humanDefensed){
            if(adv && ready('empower') && ready('volley') && !plan.includes('empower')) push('empower'); // 赋能连击5段：盾/反/重生全穿
            if(ready('volley')) push('volley'); else if(ready('pierce') && human.shield>0) push('pierce');
        }
        if(ai.hp<=ai.maxHP-2 && ready('lifesteal')) push('lifesteal');
    }
    // 续猜必杀：候选数 ≤ 出手次数时买加速，本回合必中
    if(adv && ready('speed') && estCand>1 && estCand<=ai.speed+2 && !plan.includes('speed')) push('speed');

    // 6) 人类逼近时的破坏与埋雷
    if(range<=prof.sabotageRange && adv){
        if(ready('pause')) push('pause');
        if(ready('forbid')) push('forbid');
        else if(ready('trap')) push('trap');
        // 掀桌只在自己没有线索优势时（否则作废的是自己的推理成果）；对手情报多时必掀
        // 移动优先：秘密挪窝，对手的过期线索会变成他的坟墓
        if((Math.random()<prof.moveFlipRate || humanThreat>=2) && (!cands || candCount>8)){
            if(ready('move')) push('move');
        }
    } else if(range<=12){
        if(ready('forbid')) push('forbid');
        else if(ready('trap')) push('trap');
        if(prof.blindChipRate>0 && ready('blind') && Math.random()<prof.blindChipRate) push('blind');
    }

    // 6.8) 单技能独立时机：不依赖连招，每个技能有自己的出场理由（没抽到组合也照用）
    if(known===null && adv){
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
    }

    // 6.5) 借力打力：复制对手的强技；架好反射后主动跳过回合诱攻
    if(adv && ready('copy') && human.skills.some(s=>['double','allin','rampage','volley','heal','reflect'].includes(s.id))) push('copy');
    if(adv && ready('skip') && ai.reflect>0 && (humanArmed || human.hp<=3 || humanThreat>=2)) push('skip');
    if(ai.frozen && ready('skip')) push('skip'); // 被冰封：直接跳过等冰化，不浪费命中机会
    if(human.dormant && adv && ready('skip') && known!==null) push('skip'); // 对手休眠设伏：已确知也不踩，跳过让它白埋伏

    // 7) 后勤续航
    if(ready('refresh') && ['double','allin','rampage','volley'].some(id=>ai.skills.some(s=>s.id===id)&&(ai.cooldowns[id]||0)>0)) push('refresh');
    if(ready('charge') && Object.keys(ai.cooldowns).some(k=>ai.cooldowns[k]>0) && Math.random()<0.6) push('charge');
    if(ready('rebirth') && !ai.rebirth) push('rebirth'); // 重生=免费保险：拿到就挂上，别等残血（挂了的不重复挂）
    if(adv && ready('anger') && (ai.maxHP-ai.hp)>=4) push('anger');

    // 7.5) 存款回合：双倍/子母弹/狂暴/吸血"猜错不失效"=本回合内不过期的存款——
    //      翻倍可以多次累乘，越早叠越赚；炸弹已挪不动（洗牌/虫洞已删），叠了不怕被掀桌
    if(!willing && prof.deposit && !ai.frozen && !human.dormant){ // 对手休眠设伏时增益会打进陷阱，不存款
        if(ready('double')) push('double');
        if(ready('bomblet')) push('bomblet');
        if(adv && ready('rampage')) push('rampage'); // 翻倍多次累乘：没事干就叠，别等确知炸弹才放
        if(adv && ready('lifesteal') && ai.hp<ai.maxHP) push('lifesteal');
        if(ready('heal') && ai.hp<ai.maxHP) push('heal'); // 满血前治疗也是白赚的存款
    }

    // 8) 博弈小注
    if(ready('dice') && (willing || ai.hp<=Math.ceil(ai.maxHP/2)) && Math.random()<0.5) push('dice'); // +3伤配攻击回合才不浪费；残血赌回血
    if(ready('gambler') && G.aiBehind && human.hp>ai.hp && Math.random()<0.6) push('gambler'); // EV=0的方差币：逆风翻盘才开，顺风开赌=送翻盘

    // 9) 估值填充：还有空位且本回合没排爆发时，给剩余可用技能打期望分，补上最值的
    //    （每个技能的分数=它这个回合能换来的数学期望，低于1.5分不出手——不值得为它暴露节奏）
    if(adv && plan.length<maxSkills && !plan.includes('double') && !plan.includes('allin')){
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
        add('blind', oppHitProb>=0.2 ? 1.5 : 0);
        add('numberslash', ai.slashActive>0 ? 0 : 2.0); // 数字斩：3回合≈1点期望收益，白捡的（生效中不重复用）
        add('speed', ai.slashActive>0 && candCount<=6 ? 1.8 : 0); // 数字斩生效中：每多一次出手=多0.5攻/疗，买续猜加速积攒
        // 防御技：残血时活着才有输出
        if(ai.hp<=3){ add('shield', oppDmgExp*3); add('heal', ai.hp<ai.maxHP ? 2 : 0); }
        // 秘密挪弹：对手威胁越实越值（零暴露成本，作废的是他的推理）
        if(known===null && humanThreat>=2){ add('move', humanThreat*1.5); }
        ev.sort((x,y)=>y[0]-x[0]);
        for(const e of ev){ if(plan.length>=maxSkills) break; push(e[1]); }
    }

    // 难度专属收尾钩子（大师：赋能连招/裂变精算/暂停+续猜连动/终局拆台套件...）
    if(prof.hookLate) prof.hookLate(h);

    // 10) 交换连招（看懂对面技能栏的终极应用，放在最后：自己的好牌先排完）：
    //     先用完自己的好牌 → 交换 → 白捡对面整副新鲜技能接着放，一回合当两回合打；
    //     对面下回合接手的是我用剩的冷却壳子，直接技能荒。
    //     估值只算新鲜度：对面没冷却的才是白捡的战斗力；我没排进计划的新鲜牌才是嫁妆成本
    //     （已排掉的牌换过去时在冷却=白送壳子）。冷却情报走诚实渠道：侦察=精确，公开用过=推断，没见过=0.7估
    if(adv && ready('swap') && !plan.includes('swap') && plan.length<maxSkills && human.skills.length>0){
        const tierOf = id => AI_SKILL_TIER[id]||5;
        const oppFresh = id => {
            if(oppCdKnown) return (human.cooldowns[id]||0)<=0 ? 1 : 0;
            const obs = G.aiOppCd||{};
            return (id in obs) ? (obs[id]<=0 ? 1 : 0) : 0.7;
        };
        const dowry = ai.skills.filter(s=>!plan.includes(s.id) && s.id!=='swap')
            .reduce((a,s)=>a+tierOf(s.id)*((ai.cooldowns[s.id]||0)<=0 ? 1 : 0.2), 0);
        const incomingList = human.skills.filter(s=>s.id!=='swap' && oppFresh(s.id)>0.5)
            .sort((x,y)=>tierOf(y.id)-tierOf(x.id));
        const incoming = incomingList.reduce((a,s)=>a+tierOf(s.id)*oppFresh(s.id), 0);
        if(incoming >= dowry+4 || (dowry<=3 && incoming>=6)){
            push('swap');
            if(plan.includes('swap')){
                // 换完接着放对面的强技：执行链按技能新归属即时校验（ai.skills/cooldowns 已易主），天然生效。
                // 连招特许溢出上限+3：本质是借用对面的回合配额（玩家每回合本就无连放限制）
                const added = {};
                incomingList.slice(0,3).forEach(s=>{ if(plan.length<maxSkills+3 && !added[s.id]){ added[s.id]=1; plan.push(s.id); } });
                dlog('AI','交换连招：嫁妆'+dowry.toFixed(1)+' 换对面火力'+incoming.toFixed(1)+'，接 ['+Object.keys(added).join(',')+']');
            }
        }
    }

    // 互斥收尾：跳过=本回合作废——同排的暂停（抢对手回合）与加速（本回合续猜）都会被它白扔掉
    if(plan.includes('skip')){
        ['pause','speed'].forEach(id=>{ const i=plan.indexOf(id); if(i>=0) plan.splice(i,1); });
    }
    return plan;
}

// 信息技能放完后动态追加决策：看着刚拿到的线索决定要不要补刀/进一步确认
function aiTopUp(ai, human, used){
    const prof = aiProfile();
    if(!prof.useTopUp) return [];
    const adv = prof.advanced;
    const ready = id => !used[id] && ai.skills.some(s=>s.id===id) && (ai.cooldowns[id]||0)<=0 && ai.lockedSkill!==id && ai.secondLockedSkill!==id;
    let cands = aiCandidates(true); // 追加爆发=下重注：只认硬线索
    if(cands && cands.length===0){ aiHandleContradiction(); cands=null; }
    const known = aiKnownBomb();
    const candCount = known!==null ? 1 : ((cands && cands.length>0) ? cands.length : (_aiRHi()-_aiRLo()+1));
    const out = [];
    const push = id => { if(out.length<prof.topUpCap && !out.includes(id) && ready(id)) out.push(id); };
    if((known!==null || candCount<=4) && !human.dormant){ // 对手休眠设伏：爆发被吞还送+2，改走压缩/确认磨过去
        // 线索已收敛 → 直接补爆发收割
        if(adv) push('empower');
        push('double');
        if(ai.hp>=prof.topUpAllinHp) push('allin');
        if(adv) push('rampage');
        push('bomblet');
        if(human.shield>0 || human.reflect>0 || human.rebirth){ push('volley'); push('pierce'); }
        if(prof.topUpSpeed) push('speed');
    } else if(candCount<=10){
        // 还不够精确 → 再确认/再压缩
        if(adv) push('verifier');
        push('binary');
        if(prof.topUpSpeed) push('speed');
    }
    // 终局抢轮次：砍不动就偷走对手的下回合
    if((_aiRHi()-_aiRLo()+1)<=8 && adv){
        push('pause');
        if(prof.topUpFreeze) push('freeze');
    }
    return out;
}

// 猜数决策（纯选择，不碰 DOM 不执行）：返回 {guess, usedClues}
// 本猜命中率写入 G.aiLastGuessP（仅线索制导猜>0），供情报污染检测使用；故意求不中的猜不计
function aiChooseGuess(ai){
    const range=_aiRHi()-_aiRLo()+1;
    const prof=aiProfile();
    const adv=prof.advanced;
    G.aiLastGuessP = 0;
    const known = aiKnownBomb();
    let guess;
    let usedClues = false; // 本猜是否基于确知/候选（盲猜才允许躲雷，稳杀局绝不让步）
    if(ai.frozen && adv && !ai.blind){
        // 被冰封：命中不炸也不缩范围，猜错反而正常缩——故意贴边"求不中"，下回合冰化再杀
        guess = Math.random()<0.5 ? _aiRLo()+1 : _aiRHi()-1;
        guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess));
    } else if(getPlayer('p1').dormant && adv && !ai.blind){
        // 对手休眠设伏：命中=白打还送+2——贴边钓鱼降低踩中率，即使确知炸弹也绝不撞埋伏
        guess = Math.random()<0.5 ? _aiRLo()+1 : _aiRHi()-1;
        guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess));
    } else if(known!==null && !ai.blind && prof.useKnown){
        guess = known; usedClues = true; G.aiLastGuessP = 1; // 验证器命中过，直接收割
    } else if(ai.blind){
        guess = Math.floor(Math.random()*range)+_aiRLo(); // 被致盲：只能瞎猜
    } else {
        // 反读心迷彩（装糖）：刚用秘密提示技——这一猜故意避开刚拿到的线索，
        // 让围观读猜测流的人读到假规律。代价：本猜只吃范围收缩的诚实收益
        let camoGuess = null;
        if(G.aiCamo && adv){
            const _hc = aiCandidates(true);
            if(_hc && _hc.length<=3){
                G.aiCamo = false; // 快赢了不装糖：候选≤3还故意偏离线索=白送节奏（防钓鱼别把自己防傻）
            } else {
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
        }
        if(camoGuess!==null){
            guess = camoGuess; // usedClues保持false：迷彩猜不计入线索制导，SPRT污染检测不误判
        } else {
        let cands = null, wc = null;
        if(prof.useWeighted) wc = aiWeightedCands(); // 困难起：硬线索过滤 + 软线索概率加权
        else if(Math.random()<prof.softRate) cands = aiCandidates(); // 低难度会用线索，只是经常想不起来
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
            if(prof.candJitter && range>4){ // 低难度带点抖动，不够精准
                guess += (Math.random()<0.5?-1:1)*Math.floor(Math.random()*3);
                guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess));
            }
        } else {
            const mid = (_aiRLo()+_aiRHi())/2;
            const fishRate = (G.aiBehind || G.aiRaceState==='losing') ? 0 : prof.fishRate; // 逆风/赛跑落后不钓鱼：全速中点收敛抢回节奏
            const fishRange = prof.fishRange; // 只有范围很大时才钓鱼——小了直接中点切割，快速收敛
            // 钓鱼的数学前提：手里有"私有信息优势"（信息技就绪）——把范围撑大，对手的裸猜命中率就一直趴在地板上，
            // 而自己靠线索收敛。没有信息优势时钓鱼=白白放慢自己的斩杀节奏，必须中点切割全速收敛抢先命中
            const infoEdge = ['detect','digitsum','peek','precognition'].some(id=>
                ai.skills.some(s=>s.id===id) && (ai.cooldowns[id]||0)<=0 && ai.lockedSkill!==id && ai.secondLockedSkill!==id);
            // 反制钓鱼：自己没有信息优势、但对手行为可疑（逼近答案）时，也贴边猜——
            // 中点切割会把共享范围喂给他收敛，宁可自己慢一点也不送这个信息
            // 仅限大范围：小范围贴边=自己永远追不上对手的中点切割（防信息泄露别防傻）
            const denyEdge = !infoEdge && range>=16 && (G.humanSuspicion||0)>=2 && Math.random()<0.5;
            if(adv && range>fishRange && (infoEdge || denyEdge) && Math.random()<fishRate){
                // 钓鱼猜法（高手策略）：猜贴边数字。命中概率与中点完全相同(1/range)，
                // 但猜错范围只缩1格——不给对手送信息；对手的中点猜法反而替我们缩圈。
                // 若炸弹恰好在最边缘(1/range概率)，范围直接塌缩成1格，下回合必中。
                guess = Math.random()<0.5 ? _aiRLo()+1 : _aiRHi()-1;
            } else if(prof.guessSpread>0){
                // 低难度：中点附近散步（不再是全范围纯随机）
                const spread=Math.max(1, Math.floor(range*prof.guessSpread));
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
    if(adv && !prof.guessAdjust && !usedClues && (G.humanTrap || G.humanForbid) && guess===Math.floor((_aiRLo()+_aiRHi())/2)){
        guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess + (Math.random()<0.5?-1:1)));
    }
    // 难度专属猜数修正钩子（大师：盲猜躲雷升级版）
    if(prof.guessAdjust){
        const adj = prof.guessAdjust({ guess:guess, usedClues:usedClues, known:known, lo:_aiRLo(), hi:_aiRHi(), range:range, ai:ai });
        if(typeof adj==='number') guess = Math.max(_aiRLo(), Math.min(_aiRHi(), Math.round(adj)));
    }
    return { guess:guess, usedClues:usedClues };
}
