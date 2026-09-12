// ============================================================================
// ai-brain.js —— AI 信念层：线索推理 / 模式挖掘 / 情报污染检测 / 对手冷却档案
// 职责：回答"炸弹可能在哪"和"对手知道多少"，只做认知，不做决策、不碰 DOM
// 配置：全部可调旋钮集中在 AI_TUNE（决策层 ai-strategy.js 共用 skillTier）
// 依赖主文件全局（运行时调用，无需导入）：G、dlog、getSkillById、aiSpeak（人格层）
// ============================================================================

// ========== AI 调参中枢：推理机制的旋钮集中在这里 ==========
const AI_TUNE = {
    softWeight: 5,      // 软线索（模式挖掘）概率加权倍率：匹配候选权重×5（半信半疑），而不是硬过滤
    staleThreshold: 2.5,// 情报污染检测（SPRT思想）：线索制导猜测累计期望命中到此值仍颗粒无收 → 情报已过期，全部废弃
    // 技能牌面价值表：选技评分（aiChooseSkill）与交换估值（aiPlanSkills第9段）共用同一张表
    skillTier: {
        volley:9, double:8, rampage:8, detect:8, binary:8, verifier:8, digitsum:8,
        shield:7, reflect:7, heal:7, rebirth:7, allin:7, empower:7, pause:7, peek:7, precognition:7,
        bomblet:6, forbid:6, trap:6, pierce:6, dormant:6, shuffle:6, speed:6, freeze:6, scout:6, numberslash:6,
        blind:5, lock:5, disguise:5, web:5, anger:5, lifesteal:5, thermometer:5,
        refresh:5, charge:5, move:5, tide:5, wormhole:5, blackhole:5,
        slow:6, fog:6, lie:6, // 控制三兄弟加强后升值：缓速2次/迷雾3次/说谎进攻型
        rewind:4, bet:4, copy:4, timerewind:4, swap:4,
        dice:3, gambler:3, skip:4
    }
};

// AI 的视图范围（可能被说谎/迷雾欺骗）：推理永远用"AI 看到的范围"，真实范围只在主文件结算
function _aiRLo(){ const p=getPlayer('p2'); return (p && p.view) ? p.view.low : G.low; }
function _aiRHi(){ const p=getPlayer('p2'); return (p && p.view) ? p.view.high : G.high; }
// 线索矛盾处理：首次矛盾不离场（可能只是视图被说谎假缩，同步后自动恢复）；
// 连续两轮（按AI回合计）矛盾才废弃——人类秘密挪弹的持续性污染才会触发真正的清洗
function aiHandleContradiction(){
    const b = G.aiBrain;
    if(!b) return;
    if(b.contraToken !== G.aiTurnToken){ b.contraToken = G.aiTurnToken; b.contraStrikes = (b.contraStrikes||0)+1; }
    if((b.contraStrikes||0)>=2){
        aiWipeValueClues();
        dlog('AI','连续两轮线索矛盾：情报确已过期，废弃取值线索重推');
    } else {
        dlog('AI','线索矛盾（首次）：暂不离场再观察一轮——若只是视图被假缩，同步后自动恢复');
    }
}

// AI 大脑：只用公开信息 + 信息技能私有结果做推理（不偷看炸弹）
function aiIsUser(u){ return u.id==='p2' && (G.mode.includes('ai') || G.mode==='tutorial'); }
function aiBrain(){
    if(!G.aiBrain) G.aiBrain={ parity:null, lastDigit:null, digitSum:null, tens:null, thermo:null, verified:{}, candSet:null, stash:null, soft:null };
    return G.aiBrain;
}
function aiEmptySoft(){ return { lastDigit:null, tens:null, digitSum:null, parity:null }; }
function aiEffectiveLevel(){ return G.mode==='tutorial' ? Math.min(G.aiLevel, 2) : G.aiLevel; }
function aiDigitSum(n){ let s=0; const st=String(n); for(const c of st) s+=+c; return s; }
function aiMatchFeatureSet(n, feat){
    if(!feat) return true;
    if(feat.lastDigit!==null && n%10!==feat.lastDigit) return false;
    if(feat.tens!==null && Math.floor(n/10)%10!==feat.tens) return false;
    if(feat.digitSum!==null && aiDigitSum(n)!==feat.digitSum) return false;
    if(feat.parity!==null && n%2!==feat.parity) return false;
    return true;
}
function aiOpponentModel(){
    if(!G.aiOppModel){
        G.aiOppModel = {
            samples:0,
            centerEMA:0.5,
            edgeEMA:0.5,
            precisionEMA:0.5,
            shrinkEMA:0,
            lowEdgeCount:0,
            highEdgeCount:0,
            softAligned:0,
            softBroken:0,
            recent:[]
        };
    }
    return G.aiOppModel;
}
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
function aiInferHumanBombPool(low, high){
    const b = G.aiBrain;
    const soft = (b && b.soft) ? b.soft : null;
    const hasSoft = soft && (soft.lastDigit!==null || soft.tens!==null || soft.digitSum!==null || soft.parity!==null);
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
function aiPredictHumanGuess(low, high){
    const m = aiOpponentModel();
    const human = getPlayer('p1');
    const width = Math.max(1, high-low+1);
    const pool = aiInferHumanBombPool(low, high);
    const preferCenter = m.samples>=3 ? m.centerEMA>=0.56 : true;
    const preferEdge = m.samples>=3 ? m.edgeEMA>=0.58 : false;
    const preferLow = (m.lowEdgeCount||0) >= (m.highEdgeCount||0);
    const result = { primary:Math.floor((low+high)/2), alternatives:[], effectivePool:width, hitProb:Math.min(1, (1+(human.speed||0))/width), confidence:0.2, style:'mid' };
    if(pool && pool.length){
        const q1 = pool[Math.max(0, Math.floor((pool.length-1)*0.25))];
        const mid = pool[Math.floor(pool.length/2)];
        const q3 = pool[Math.max(0, Math.ceil((pool.length-1)*0.75))];
        result.style = pool.length<=4 ? 'candidate-finish' : (preferEdge ? 'candidate-edge' : 'candidate-mid');
        result.primary = pool.length===1 ? pool[0] : (preferEdge ? (preferLow ? q1 : q3) : mid);
        result.alternatives = [mid, preferLow ? q3 : q1].filter((n, i, arr)=>arr.indexOf(n)===i && n!==result.primary);
        const softConfidence = (m.softAligned+1) / (m.softAligned + m.softBroken + 2);
        result.effectivePool = Math.max(1, Math.ceil(pool.length * (softConfidence>=0.6 ? 0.75 : 1)));
        result.hitProb = Math.min(1, (1+(human.speed||0))/result.effectivePool);
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
    result.hitProb = Math.min(1, (1+(human.speed||0))/effPool);
    result.confidence = Math.min(0.8, 0.22 + Math.max(m.centerEMA, m.edgeEMA)*0.35 + m.precisionEMA*0.15);
    return result;
}
// 根据 AI 已掌握的线索过滤候选炸弹数字（多条线索取交集组合推理：
// 已知个位 → 只留该个位的数；再知数字和 → 进一步只留“其余位之和 = 数字和-个位”的数。
// 例：个位=2 ∩ 数字和=6 → 范围内只剩 42；再∩奇偶/首位/温度计/验证排除，候选常收敛到个位数）
// 没有任何线索时返回 null（不浪费遍历）
// hardOnly=true：只认硬线索（下重注的决策用）；false：再叠上模式挖掘来的软线索（猜数选点用）
function aiCandidates(hardOnly){
    const b = G.aiBrain;
    if(!b) return null;
    // 线索签名：拿到新硬线索/候选集烘焙变化 → 污染计数清零（新情报重新获得信任）
    const sig = [b.parity,b.lastDigit,b.digitSum,b.tens,b.thermo?b.thermo.level:'',b.candSet?b.candSet.length:''].join('|');
    if(b.clueSig!==sig){ b.clueSig=sig; b.staleScore=0; }
    const hasCandSet = b.candSet && b.candSet.length>0;
    const soft = (!hardOnly && b.soft) ? b.soft : null;
    const hasSoft = soft && (soft.lastDigit!==null || soft.tens!==null || soft.digitSum!==null || soft.parity!==null);
    const hasClue = hasCandSet || hasSoft || b.parity!==null || b.lastDigit!==null || b.digitSum!==null || b.tens!==null || b.thermo || Object.keys(b.verified).length>0;
    if(!hasClue) return null;
    const cands = [];
    for(let n=_aiRLo(); n<=_aiRHi(); n++){
        if(hasCandSet && b.candSet.indexOf(n)<0) continue; // 移位追踪得到的显式候选集
        if(b.parity!==null && (n%2)!==b.parity) continue;
        if(b.lastDigit!==null && (n%10)!==b.lastDigit) continue;
        if(b.tens!==null && Math.floor(n/10)%10!==b.tens) continue;
        if(b.digitSum!==null){ let s=0; const str=String(n); for(const c of str) s+=+c; if(s!==b.digitSum) continue; }
        if(b.thermo && b.thermo.low===_aiRLo() && b.thermo.high===_aiRHi()){ const d=Math.abs(n-b.thermo.mid); const lv=Math.max(1,Math.min(10,Math.round(10-(d/b.thermo.maxDist)*9))); if(lv!==b.thermo.level) continue; }
        if(b.verified[n]===false) continue;
        cands.push(n);
    }
    if(cands.length>0) b.contraStrikes = 0; // 候选恢复一致：此前的矛盾已解除
    if(hasSoft){
        const fs = cands.filter(n=>{
            if(soft.lastDigit!==null && n%10!==soft.lastDigit) return false;
            if(soft.tens!==null && Math.floor(n/10)%10!==soft.tens) return false;
            if(soft.digitSum!==null){ let s=0; const str=String(n); for(const c of str) s+=+c; if(s!==soft.digitSum) return false; }
            if(soft.parity!==null && n%2!==soft.parity) return false;
            return true;
        });
        if(fs.length>0) return fs;
        // 软线索与硬事实矛盾（被钓鱼了，或对手模式本就是巧合）：先丢软的，绝不丢真的
        b.soft = null;
        dlog('AI','软线索与硬线索矛盾，全部丢弃');
    }
    return cands;
}
// ========== 模式挖掘：从对手的猜测流反推他的秘密线索 ==========
// 对手技能列表公开、使用保密——但拿到线索的人最优打法就是只猜符合线索的数，行为即广播。
// 防被钓三条铁律：①软线索只用于猜数选点，斩杀/叠伤等下重注决策只认硬线索（aiCandidates(true)）；
// ②模式一旦被打破当场丢弃，不恋战；③与硬线索矛盾先丢软线索——被骗的代价最多猜偏两轮
function aiMinePatterns(guess){
    if(!G.mode.includes('ai')) return;
    const lvl = aiEffectiveLevel();
    if(lvl<3) return; // 困难起才会读猜测流
    const b = G.aiBrain;
    if(!b) return;
    if(!b.soft) b.soft = aiEmptySoft();
    const s = b.soft;
    const seq = G.humanGuessSeq || [];
    // 已确认的软线索被新猜测打破 → 当场作废
    if(s.lastDigit!==null && guess%10!==s.lastDigit){ s.lastDigit=null; dlog('AI','软线索[个位]被打破，丢弃'); }
    if(s.tens!==null && Math.floor(guess/10)%10!==s.tens){ s.tens=null; dlog('AI','软线索[十位]被打破，丢弃'); }
    if(s.digitSum!==null && aiDigitSum(guess)!==s.digitSum){ s.digitSum=null; dlog('AI','软线索[数字和]被打破，丢弃'); }
    if(s.parity!==null && guess%2!==s.parity){ s.parity=null; dlog('AI','软线索[奇偶]被打破，丢弃'); }
    // 确认新软线索：连续N次猜中同一特征才采信（N按巧合率定）；确认=对手在线索驱动，威胁拉满
    const confirm = (attr, val, need) => {
        if(s[attr]!==null || seq.length<need) return;
        const tail = seq.slice(-need);
        const f = attr==='lastDigit' ? (n=>n%10) : attr==='tens' ? (n=>Math.floor(n/10)%10) : attr==='digitSum' ? aiDigitSum : (n=>n%2);
        if(!tail.every(n=>f(n)===val)) return;
        s[attr]=val;
        G.humanSuspicion=(G.humanSuspicion||0)+2;
        dlog('AI','模式挖掘确认：对手疑似掌握['+attr+'='+val+']（连续'+need+'次一致）');
    };
    confirm('lastDigit', guess%10, 2); // 连续2次同个位，巧合率~1%
    if(Math.floor(_aiRLo()/10)!==Math.floor(_aiRHi()/10)) confirm('tens', Math.floor(guess/10)%10, 2); // 范围横跨十位才有意义
    if(lvl>=4){ // 大师才做弱信号模式
        confirm('digitSum', aiDigitSum(guess), 3); // 数字和巧合率不低，要3次
        confirm('parity', guess%2, 3);       // 奇偶巧合率50%，要3次
    }
}
// 验证器曾命中 → AI 确知炸弹；移位追踪收敛到唯一候选也算确知
function aiKnownBomb(){
    const b = G.aiBrain;
    if(!b) return null;
    for(const k in b.verified){ if(b.verified[k]===true) return parseInt(k); }
    if(b.candSet && b.candSet.length===1) return b.candSet[0];
    return null;
}
// 只清空"炸弹取值类"线索：炸弹被随机换位（洗牌）≠ 对手的秘密部署（陷阱/禁猜/暂存）失效
function aiWipeValueClues(){
    if(!G.aiBrain) return;
    const b = G.aiBrain;
    G.aiBrain = { parity:null, lastDigit:null, digitSum:null, tens:null, thermo:null, verified:{}, candSet:null, stash:b.stash||null, soft:null }; // 洗牌/矛盾清空时软线索一起丢（炸弹已随机换位）
}
// 炸弹被 AI 已知的手段移位（自己挪的；或对手用公开播报的虫洞）——
// AI 把已有线索烘焙成显式候选集并整体迁移到新位置，而不是清空记忆当瞎子
// isHumanMove：对手挪的才能触发"我跟上了"的嘲讽（自己挪的自己知道，不用演）
function aiTrackBombShift(mapFn, tag, isHumanMove){
    const b = G.aiBrain;
    if(!b) return;
    const cands = aiCandidates(true); // 烘焙只用硬线索：软线索不固化进候选集，给自己挪弹留反悔余地
    if(!cands) return; // 本来就没线索，无需迁移
    const seen = {}; const out = [];
    cands.forEach(n=>{
        const m = mapFn(n);
        if(m>=G.minVal && m<=G.maxVal && !seen[m]){ seen[m]=1; out.push(m); }
    });
    if(out.length===0){ aiWipeValueClues(); return; } // 理论到不了这（移位钳制在范围内），兜底
    G.aiBrain = { parity:null, lastDigit:null, digitSum:null, tens:null, thermo:null, verified:{}, candSet:out, stash:b.stash||null, soft:null }; // 自己挪的弹：软线索描述的是旧位置，丢弃后重新挖
    dlog('AI', tag+'：候选集迁移 '+cands.length+'→'+out.length+(out.length<=8?' ['+out.join(',')+']':''));
    // 追踪成功且候选不多 → 按人格嘲讽一句（只暗示"我跟上了"，不泄露具体候选）
    if(isHumanMove && out.length<=8 && G.mode.includes('ai') && Math.random()<0.4){
        const tlPool = TRACK_TAUNT;
        setTimeout(function(){ if(G.active) aiSpeak(tlPool[Math.floor(Math.random()*tlPool.length)]); }, 1200);
    }
}
// 伪装启动：旧线索描述的是真身（现在被藏起来了）——暂存而非丢弃，识破后还能用
function aiStashBrain(){
    const b = G.aiBrain;
    if(!b) return;
    const hasClue = b.parity!==null || b.lastDigit!==null || b.digitSum!==null || b.tens!==null || b.thermo
        || (b.candSet && b.candSet.length>0) || Object.keys(b.verified).length>0;
    const stash = hasClue
        ? { parity:b.parity, lastDigit:b.lastDigit, digitSum:b.digitSum, tens:b.tens, thermo:b.thermo, verified:b.verified, candSet:b.candSet, soft:b.soft||null }
        : (b.stash || null);
    G.aiBrain = { parity:null, lastDigit:null, digitSum:null, tens:null, thermo:null, verified:{}, candSet:null, stash:stash, soft:b.soft||null };
    if(stash) dlog('AI','对手伪装：真身线索已暂存，等识破后取回');
}
// 伪装被识破=真身归位：取回暂存的旧线索（它们描述的正是真身），立刻恢复全部推理
function aiRestoreBrain(){
    const b = G.aiBrain;
    if(!b || !b.stash){ aiWipeValueClues(); return; }
    const s = b.stash;
    G.aiBrain = { parity:s.parity, lastDigit:s.lastDigit, digitSum:s.digitSum, tens:s.tens, thermo:s.thermo, verified:s.verified||{}, candSet:s.candSet||null, stash:null, soft:s.soft||null };
    dlog('AI','伪装识破，取回暂存线索恢复推理');
}

// 对手公开技能使用档案：公开播报的技能使用=免费的冷却情报（秘密技能观察不到，仍靠侦察）
function aiObservePublicSkill(skillId){
    if(!G.mode.includes('ai')) return;
    const sk = getSkillById(skillId);
    if(!sk || sk.cooldown<=0) return;
    if(G.aiOppCdRound!==G.roundCount){ G.aiOppCd={}; G.aiOppCdRound=G.roundCount; }
    G.aiOppCd = G.aiOppCd||{};
    G.aiOppCd[skillId] = sk.cooldown;
    dlog('AI','对手公开使用 '+skillId+'，冷却档案记录 cd='+sk.cooldown);
}
// 加权候选：硬线索照旧硬过滤（确定的真理不让步），软线索只做概率加权（半信半疑）——
// 被钓鱼的代价从"候选被掏空"降级为"概率被轻微带偏"，且与硬事实矛盾时照旧当场丢弃
function aiWeightedCands(){
    const b = G.aiBrain;
    const hard = aiCandidates(true);
    if(hard && hard.length===0) return hard; // 硬线索矛盾：交给调用方走清空重推
    const soft = (b && b.soft) ? b.soft : null;
    const hasSoft = soft && (soft.lastDigit!==null || soft.tens!==null || soft.digitSum!==null || soft.parity!==null);
    if(!hard && !hasSoft) return null;
    let pool = hard;
    if(!pool){ pool = []; for(let n=_aiRLo(); n<=_aiRHi(); n++) pool.push(n); }
    const W = AI_TUNE.softWeight;
    let boosted = 0;
    const out = pool.map(n=>{
        let w = 1;
        if(hasSoft){
            if(soft.lastDigit!==null && n%10===soft.lastDigit) w*=W;
            if(soft.tens!==null && Math.floor(n/10)%10===soft.tens) w*=W;
            if(soft.digitSum!==null && aiDigitSum(n)===soft.digitSum) w*=W;
            if(soft.parity!==null && n%2===soft.parity) w*=W;
        }
        if(w>1) boosted++;
        return { n:n, w:w };
    });
    if(hasSoft && boosted===0){ b.soft=null; dlog('AI','软线索与硬事实矛盾，全部丢弃'); } // 被钓了：一个都匹配不上
    return out;
}
function aiWeightedTotal(wc){
    if(!wc || !wc.length) return 0;
    let total = 0;
    wc.forEach(o=>{ total += Math.max(0, o.w||0); });
    return total;
}
function aiWeightedEntropy(wc){
    const total = aiWeightedTotal(wc);
    if(total<=0) return 0;
    let ent = 0;
    wc.forEach(o=>{
        const w = Math.max(0, o.w||0);
        if(w<=0) return;
        const p = w / total;
        ent -= p * Math.log2(p);
    });
    return ent;
}
function aiSplitWeightedGuess(wc, guess){
    let total = 0, hit = 0, below = 0, above = 0;
    const belowSet = [], aboveSet = [];
    if(!wc || !wc.length) return { total:0, hit:0, miss:0, below:0, above:0, belowSet:belowSet, aboveSet:aboveSet };
    for(let i=0; i<wc.length; i++){
        const o = wc[i];
        const w = Math.max(0, o.w||0);
        total += w;
        if(o.n===guess) hit += w;
        else if(o.n<guess){ below += w; belowSet.push(o); }
        else { above += w; aboveSet.push(o); }
    }
    return { total:total, hit:hit, miss:Math.max(0, total-hit), below:below, above:above, belowSet:belowSet, aboveSet:aboveSet };
}
function aiExpectedPostGuessEntropy(wc, guess){
    const sp = aiSplitWeightedGuess(wc, guess);
    if(sp.total<=0) return 0;
    return (sp.below/sp.total)*aiWeightedEntropy(sp.belowSet) + (sp.above/sp.total)*aiWeightedEntropy(sp.aboveSet);
}
function aiExpectedPostVerifyEntropy(wc, guess){
    const total = aiWeightedTotal(wc);
    if(total<=0) return 0;
    const missSet = [];
    let hit = 0;
    for(let i=0; i<wc.length; i++){
        const o = wc[i];
        if(o.n===guess) hit += Math.max(0, o.w||0);
        else missSet.push(o);
    }
    const missP = Math.max(0, total-hit) / total;
    return missP * aiWeightedEntropy(missSet);
}
function aiBlackholeRangeForBomb(low, high, pivot, bomb){
    let newLow = low;
    let newHigh = high;
    if(low < pivot) newLow = Math.min(low + 2, pivot);
    if(high > pivot) newHigh = Math.max(high - 2, pivot);
    if(bomb < newLow) newLow = bomb;
    if(bomb > newHigh) newHigh = bomb;
    if(newLow > newHigh) return null;
    return { low:newLow, high:newHigh };
}
function aiExpectedBlackholeOutcome(wc, low, high, pivot){
    const total = aiWeightedTotal(wc);
    if(total<=0) return { entropy:0, width:Math.max(1, high-low+1) };
    let entropy = 0, width = 0;
    for(let i=0; i<wc.length; i++){
        const actual = wc[i];
        const actualP = Math.max(0, actual.w||0) / total;
        if(actualP<=0) continue;
        const r = aiBlackholeRangeForBomb(low, high, pivot, actual.n);
        if(!r) continue;
        const next = wc.filter(o=>o.n>=r.low && o.n<=r.high);
        entropy += actualP * aiWeightedEntropy(next);
        width += actualP * Math.max(1, r.high-r.low+1);
    }
    return { entropy:entropy, width:width };
}
// AI 猜错后的情报自检（由 processGuess 在未命中分支调用，能走到这=猜的数确定不是炸弹）：
// ① 猜过的数标记排除（免费排除法，纯公开信息）
// ② "确知"落空 → 情报已过期（被秘密挪弹阴了），立刻废弃全部取值线索
// ③ 慢性污染检测：线索制导猜测的累计期望命中 ≥ 阈值仍零命中 → 即使没确知也判定情报过期
//    （奇偶/数字和这类宽线索被阴时候选集永远不会归零，靠候选归零纠错要白白漏血好几轮）
function aiRegisterMiss(guess){
    if(!G.aiBrain) return;
    const b = G.aiBrain;
    const wasKnown = b.verified[guess]===true || (b.candSet && b.candSet.length===1 && b.candSet[0]===guess);
    if(wasKnown){
        aiWipeValueClues();
        dlog('AI','确知落空：情报过期（炸弹疑似被挪动），清空线索重新侦察');
        return;
    }
    if(b.verified[guess]===undefined) b.verified[guess]=false;
    const p = G.aiLastGuessP||0;
    if(p>0){
        b.staleScore = (b.staleScore||0)+p;
        if(b.staleScore>=AI_TUNE.staleThreshold){
            aiWipeValueClues();
            dlog('AI','线索制导连续落空（累计期望命中≥'+AI_TUNE.staleThreshold+'仍零命中）：情报疑似被秘密挪弹污染，全部废弃重侦');
        }
    }
}
