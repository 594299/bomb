// ============================================================================
// ai-observe.js —— AI 观察层：专门负责"读懂对手"
// 职责：对手行为模型（EMA习惯画像）/ 猜测流模式挖掘（反推对手的秘密线索）/
//       对手下一猜预测（含多层预测树）/ 公开技能冷却档案 / 节奏赛跑估算
// 只做认知，不做决策、不碰 DOM。要优化"AI 如何读人"，只改这一个文件
// 依赖：ai-brain.js（信念/特征匹配），主文件全局（运行时调用）：G、dlog、getPlayer
// ============================================================================

// 对手习惯画像：全部来自公开行为的指数滑动平均（EMA）——不偷看任何私密信息
function aiOpponentModel(){
    if(!G.aiOppModel){
        G.aiOppModel = {
            samples:0,
            centerEMA:0.5,      // 爱猜中点的程度
            edgeEMA:0.5,        // 爱贴边的程度
            precisionEMA:0.5,   // 反常精确猜（偏离中点的自信出手）
            shrinkEMA:0,        // 每猜平均缩圈效率（接近二分=有章法）
            lowEdgeCount:0,
            highEdgeCount:0,
            softAligned:0,      // 猜测落在"软线索池"内的次数（他疑似有线索）
            softBroken:0,
            recent:[]
        };
    }
    return G.aiOppModel;
}
// 人类每猜一次（无论命中与否），主文件调用此函数喂样本
function aiObserveHumanGuess(guess, prevLow, prevHigh, newLow, newHigh){
    if(!G.mode.includes('ai')) return;
    const m = aiOpponentModel();
    const width = Math.max(1, prevHigh-prevLow+1);
    const newWidth = Math.max(1, newHigh-newLow+1);
    const mid = (prevLow+prevHigh)/2;
    const span = Math.max(1, width-1);
    const pos = (guess-prevLow)/span;
    const centerHit = Math.abs(guess-mid)<=Math.max(1, width*0.15) ? 1 : 0;
    const edgeHit = Math.min(pos, 1-pos)<=0.2 ? 1 : 0;
    const preciseOffMid = (width>=20 && Math.abs(guess-mid)>width*0.2) ? 1 : 0;
    const shrink = Math.max(0, Math.min(1, (width-newWidth)/width));
    const ema = m.samples===0 ? 1 : 0.28;
    m.centerEMA = m.samples===0 ? centerHit : (m.centerEMA*(1-ema) + centerHit*ema);
    m.edgeEMA = m.samples===0 ? edgeHit : (m.edgeEMA*(1-ema) + edgeHit*ema);
    m.precisionEMA = m.samples===0 ? preciseOffMid : (m.precisionEMA*(1-ema) + preciseOffMid*ema);
    m.shrinkEMA = m.samples===0 ? shrink : (m.shrinkEMA*(1-ema) + shrink*ema);
    if(pos<=0.35) m.lowEdgeCount++;
    if(pos>=0.65) m.highEdgeCount++;
    m.samples++;
    const pool = aiInferHumanBombPool(prevLow, prevHigh);
    if(pool && pool.length){
        if(pool.indexOf(guess)>=0) m.softAligned++;
        else m.softBroken++;
    }
    m.recent.push({ guess:guess, low:prevLow, high:prevHigh, pos:pos });
    if(m.recent.length>8) m.recent.shift();
}
// 用已挖到的软线索（对手的秘密提示）反推他眼中的候选池
function aiInferHumanBombPool(low, high){
    const b = G.aiBrain;
    const soft = (b && b.soft) ? b.soft : null;
    const hasSoft = soft && (soft.lastDigit!==null || soft.tens!==null || soft.digitSum!==null || soft.parity!==null || soft.digits!==null);
    if(!hasSoft) return null;
    const out = [];
    for(let n=low; n<=high; n++){
        if(aiMatchFeatureSet(n, soft)) out.push(n);
    }
    return out.length ? out : null;
}
function aiProjectRangeAfterMiss(low, high, guess, dir){
    if(dir==='below') return { low:low, high:Math.max(low, guess-1) };
    return { low:Math.min(high, guess+1), high:high };
}
function aiEstimateBombSideProb(low, high, guess){
    const pool = aiInferHumanBombPool(low, high);
    let below = 0, above = 0;
    if(pool && pool.length){
        for(const n of pool){
            if(n<guess) below++;
            else if(n>guess) above++;
        }
    } else {
        below = Math.max(0, guess-low);
        above = Math.max(0, high-guess);
    }
    const total = below + above;
    if(total<=0) return { below:0.5, above:0.5 };
    return { below:below/total, above:above/total };
}
// 对手下一猜的多层预测树：递推"他猜X→没中→范围缩成Y→他再猜什么"
// depth 由难度档案控制（大师看3层，其余2层）
function aiPredictHumanGuessMap(low, high, depth){
    const scores = {};
    const add = (n, w) => {
        if(n<low || n>high || w<=0) return;
        scores[n] = (scores[n]||0) + w;
    };
    const walk = (lo, hi, d, weight) => {
        if(d<=0 || lo>hi || weight<=0.02) return;
        const fc = aiPredictHumanGuess(lo, hi);
        if(!fc) return;
        const picks = [fc.primary].concat(fc.alternatives||[]).filter((n, i, arr)=>n>=lo && n<=hi && arr.indexOf(n)===i);
        if(!picks.length) return;
        const base = Math.max(0.2, fc.confidence||0.4);
        for(let i=0; i<picks.length; i++){
            const n = picks[i];
            const localWeight = weight * base * (i===0 ? 1 : (i===1 ? 0.58 : 0.33));
            add(n, localWeight);
            const side = aiEstimateBombSideProb(lo, hi, n);
            const below = aiProjectRangeAfterMiss(lo, hi, n, 'below');
            const above = aiProjectRangeAfterMiss(lo, hi, n, 'above');
            if(below.low<=below.high) walk(below.low, below.high, d-1, localWeight * side.below * 0.82);
            if(above.low<=above.high) walk(above.low, above.high, d-1, localWeight * side.above * 0.82);
        }
    };
    walk(low, high, depth, 1);
    return Object.keys(scores)
        .map(k=>({ n:parseInt(k), score:scores[k] }))
        .sort((a,b)=>b.score-a.score);
}
// 对手下一猜的单点预测：先看他疑似持有的软线索池，再按习惯画像（中点/贴边/四分位）推断
function aiPredictHumanGuess(low, high){
    const m = aiOpponentModel();
    const human = getPlayer('p1');
    const width = Math.max(1, high-low+1);
    const pool = aiInferHumanBombPool(low, high);
    const preferCenter = m.samples>=3 ? m.centerEMA>=0.56 : true;
    const preferEdge = m.samples>=3 ? m.edgeEMA>=0.58 : false;
    const preferLow = (m.lowEdgeCount||0) >= (m.highEdgeCount||0);
    const estBombs = aiEstBombCount(); // 多炸弹（裂变）：命中面按炸弹数放大
    const result = { primary:Math.floor((low+high)/2), alternatives:[], effectivePool:width, hitProb:Math.min(1, estBombs*(1+(human.speed||0))/width), confidence:0.2, style:'mid' };
    if(pool && pool.length){
        const q1 = pool[Math.max(0, Math.floor((pool.length-1)*0.25))];
        const mid = pool[Math.floor(pool.length/2)];
        const q3 = pool[Math.max(0, Math.ceil((pool.length-1)*0.75))];
        result.style = pool.length<=4 ? 'candidate-finish' : (preferEdge ? 'candidate-edge' : 'candidate-mid');
        result.primary = pool.length===1 ? pool[0] : (preferEdge ? (preferLow ? q1 : q3) : mid);
        result.alternatives = [mid, preferLow ? q3 : q1].filter((n, i, arr)=>arr.indexOf(n)===i && n!==result.primary);
        const softConfidence = (m.softAligned+1) / (m.softAligned + m.softBroken + 2);
        result.effectivePool = Math.max(1, Math.ceil(pool.length * (softConfidence>=0.6 ? 0.75 : 1)));
        result.hitProb = Math.min(1, estBombs*(1+(human.speed||0))/result.effectivePool);
        result.confidence = Math.min(0.95, 0.45 + softConfidence*0.4 + (pool.length<=4 ? 0.12 : 0));
        return result;
    }
    const avgShrink = (G.humanGuesses||0)>0 ? (G.humanShrink||0)/G.humanGuesses : 0;
    if(preferEdge){
        result.style = 'edge';
        result.primary = preferLow ? Math.min(high, low+1) : Math.max(low, high-1);
        result.alternatives = [Math.floor((low+high)/2), preferLow ? Math.max(low, low+Math.floor(width*0.25)) : Math.min(high, high-Math.floor(width*0.25))]
            .filter((n, i, arr)=>arr.indexOf(n)===i && n!==result.primary);
    } else if(!preferCenter && m.precisionEMA>=0.52 && width>=8){
        result.style = 'quarter';
        result.primary = Math.round(low + (high-low) * (preferLow ? 0.35 : 0.65));
        result.alternatives = [Math.floor((low+high)/2), preferLow ? Math.max(low, low+1) : Math.min(high, high-1)]
            .filter((n, i, arr)=>arr.indexOf(n)===i && n!==result.primary);
    } else {
        result.style = 'mid';
        result.primary = Math.floor((low+high)/2);
        result.alternatives = [Math.max(low, result.primary-1), Math.min(high, result.primary+1)]
            .filter((n, i, arr)=>arr.indexOf(n)===i && n!==result.primary);
    }
    let effPool = width;
    if(m.precisionEMA>=0.58) effPool = Math.max(1, Math.ceil(width*0.55));
    else if(avgShrink>0.45 || m.shrinkEMA>0.45) effPool = Math.max(1, Math.ceil(width/2));
    else if(avgShrink>0.3 || m.shrinkEMA>0.3) effPool = Math.max(1, Math.ceil(width*0.7));
    result.effectivePool = effPool;
    result.hitProb = Math.min(1, estBombs*(1+(human.speed||0))/effPool);
    result.confidence = Math.min(0.8, 0.22 + Math.max(m.centerEMA, m.edgeEMA)*0.35 + m.precisionEMA*0.15);
    return result;
}
// ========== 模式挖掘：从对手的猜测流反推他的秘密线索 ==========
// 对手技能列表公开、使用保密——但拿到线索的人最优打法就是只猜符合线索的数，行为即广播。
// 防被钓三条铁律：①软线索只用于猜数选点，斩杀/叠伤等下重注决策只认硬线索（aiCandidates(true)）；
// ②模式一旦被打破当场丢弃，不恋战；③与硬线索矛盾先丢软线索——被骗的代价最多猜偏两轮
function aiMinePatterns(guess){
    if(!G.mode.includes('ai')) return;
    const lvl = aiEffectiveLevel();
    if(lvl<2) return; // 普通起就会读猜测流（宁可被钓也要跟猜——钓我两轮最多猜偏，真线索不跟=白送）
    const b = G.aiBrain;
    if(!b) return;
    if(!b.soft) b.soft = aiEmptySoft();
    const s = b.soft;
    const seq = G.humanGuessSeq || [];
    // 已确认的软线索被新猜测打破 → 当场作废；同一特征被骗过一次，下次要多1次一致性才再采信（适应性防钓，跨回合记忆）
    G.aiSoftSkeptic = G.aiSoftSkeptic||{};
    const broke = attr => { G.aiSoftSkeptic[attr]=(G.aiSoftSkeptic[attr]||0)+1; dlog('AI','软线索['+attr+']被打破，丢弃（该特征今后需多1次确认）'); };
    if(s.lastDigit!==null && guess%10!==s.lastDigit){ s.lastDigit=null; broke('lastDigit'); }
    if(s.tens!==null && Math.floor(guess/10)%10!==s.tens){ s.tens=null; broke('tens'); }
    if(s.digitSum!==null && aiDigitSum(guess)!==s.digitSum){ s.digitSum=null; broke('digitSum'); }
    if(s.parity!==null && guess%2!==s.parity){ s.parity=null; broke('parity'); }
    if(s.digits!==null && String(guess).length!==s.digits){ s.digits=null; broke('digits'); }
    // 确认新软线索：连续N次猜中同一特征才采信（N按巧合率定+被钓追加）；确认=对手在线索驱动，威胁拉满
    const confirm = (attr, val, need) => {
        need += Math.min(1, G.aiSoftSkeptic[attr]||0); // 被钓过一次：确认门槛+1
        if(s[attr]!==null || seq.length<need) return;
        const tail = seq.slice(-need);
        const f = attr==='lastDigit' ? (n=>n%10) : attr==='tens' ? (n=>Math.floor(n/10)%10) : attr==='digitSum' ? aiDigitSum : attr==='digits' ? (n=>String(n).length) : (n=>n%2);
        if(!tail.every(n=>f(n)===val)) return;
        s[attr]=val;
        G.humanSuspicion=(G.humanSuspicion||0)+2;
        dlog('AI','模式挖掘确认：对手疑似掌握['+attr+'='+val+']（连续'+need+'次一致）');
    };
    confirm('lastDigit', guess%10, 2); // 连续2次同个位，巧合率~1%
    if(Math.floor(_aiRLo()/10)!==Math.floor(_aiRHi()/10)) confirm('tens', Math.floor(guess/10)%10, 2); // 范围横跨十位才有意义
    if(String(_aiRLo()).length!==String(_aiRHi()).length) confirm('digits', String(guess).length, 2); // 范围横跨位数边界才有意义（读出对手的探测）
    if(lvl>=3){ // 困难起做弱信号模式：不管是不是装糖，先跟了再说
        confirm('digitSum', aiDigitSum(guess), 2); // 数字和连续2次一致就跟（装糖代价=最多被骗两轮，真线索不跟=整局白给）
        confirm('parity', guess%2, 3);       // 奇偶巧合率50%，要3次
    }
}
// 对手公开技能使用档案：公开播报的技能使用=免费的冷却情报（秘密技能观察不到，仍靠侦察）
function aiObservePublicSkill(skillId){
    if(!G.mode.includes('ai')) return;
    // 对手用过反制技=证明他会做反制操作——伪装/装糖这类二阶动作只对这种对手才有观众
    if(['move','tide','disguise','fog'].indexOf(skillId)>=0) G.humanUsedCounter = true;
    const sk = getSkillById(skillId);
    if(!sk || sk.cooldown<=0) return;
    if(G.aiOppCdRound!==G.roundCount){ G.aiOppCd={}; G.aiOppCdRound=G.roundCount; }
    G.aiOppCd = G.aiOppCd||{};
    G.aiOppCd[skillId] = sk.cooldown;
    dlog('AI','对手公开使用 '+skillId+'，冷却档案记录 cd='+sk.cooldown);
}
// 对手埋雷习惯档案：禁猜/陷阱数字被踩揭示时记录相对位置（0~1归一化十桶），跨回合累积
// 人类埋雷有规律（爱中点、爱埋自己刚算的位置）——记住它，躲雷和读雷都更准
function aiTrapMemory(){
    if(!G.aiTrapMem) G.aiTrapMem = { buckets:{}, count:0 };
    return G.aiTrapMem;
}
function aiObserveTrapPosition(n, low, high){
    if(!G.mode.includes('ai')) return;
    const m = aiTrapMemory();
    const span = Math.max(1, high-low);
    const rel = Math.max(0, Math.min(0.999, (n-low)/span));
    const b = Math.floor(rel*10);
    m.buckets[b] = (m.buckets[b]||0)+1;
    m.count++;
}
// 综合预测对手雷区：①预测树高分猜点（他预测"我会猜哪"≈他埋哪）②历史热桶 → 返回查表 {n:1}
function aiPredictedTrapZones(low, high){
    const zones = {};
    const add = n => { zones[n-1]=1; zones[n]=1; zones[n+1]=1; }; // 雷区都是±1三格
    const map = aiPredictHumanGuessMap(low, high, 2);
    map.slice(0, 3).forEach(x => add(x.n));
    const m = aiTrapMemory();
    if(m.count>=2){
        let bestB = -1, bestN = 1;
        for(const b in m.buckets){ if(m.buckets[b]>bestN){ bestN=m.buckets[b]; bestB=parseInt(b); } }
        if(bestB>=0) add(Math.round(low + (bestB+0.5)/10*Math.max(1, high-low)));
    }
    return zones;
}
// 对手连招阅读：从公开buff读出他这回合的剧本（增伤buff使用时全部公开播报=免费剧本）
// 返回剧本名供决策层针对性拆招：trap-burst=设伏诱爆 / bait=反射跳过诱攻 / lethal-chain=斩杀链上膛
function aiReadHumanCombo(human){
    if(!human) return null;
    const stacked = (human.doubleDamage||0)+(human.allinMultiplier||0)+(((human.rampageMulti||1)>1)?2:0)+(human.bombletDamage||0);
    if(human.dormant && stacked>0) return 'trap-burst';
    if(human.reflect>0 && human.skipNext) return 'bait';
    if(stacked>=3) return 'lethal-chain';
    return null;
}
// 节奏赛跑估算：还需几回合命中（终局博弈的宏观输入）——
// 我落后就全力拆台抢轮次，我领先就省下控制件直接收敛/爆发
function aiRoundsToHit(candCount, tries){ return Math.max(1, Math.ceil(Math.max(1, candCount) / Math.max(1, tries))); }
// 线索污染风险：对手手里捏着就绪的挪弹/潮汐/伪装（冷却档案或侦察视野可见），
// 我的候选线索随时可能整批作废——下重注前要么再验证一次，要么抬高出手门槛
function aiClueRisky(oppCdReady){ return !!(oppCdReady && (oppCdReady('move')||oppCdReady('tide')||oppCdReady('disguise'))); }
