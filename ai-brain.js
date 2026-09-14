// ============================================================================
// ai-brain.js —— AI 信念层：线索推理 / 候选过滤 / 污染检测 / 伪装暂存
// 职责：回答"炸弹可能在哪"，只做认知，不做决策、不碰 DOM
// 另含：难度档案注册表 AI_LEVEL_PROFILES（各难度文件 ai-easy/normal/hard/master.js
//       向这里注册自己的旋钮与钩子，决策骨架 ai-strategy.js 通过 aiProfile() 读取）
// 兄弟层：ai-observe.js（观察对手）、ai-skills.js（技能熟练）、ai-persona.js（台词）
// 依赖主文件全局（运行时调用，无需导入）：G、dlog、aiSpeak（人格层）
// ============================================================================

// ========== AI 调参中枢：推理机制的旋钮集中在这里 ==========
const AI_TUNE = {
    softWeight: 5,      // 软线索（模式挖掘）概率加权倍率：池内匹配候选权重×5（先收敛到软线索池跟猜，池内再加权选点）
    staleThreshold: 2.5 // 情报污染检测（SPRT思想）：线索制导猜测累计期望命中到此值仍颗粒无收 → 情报已过期，全部废弃
};

// ========== 难度档案注册表：每个难度一个文件，优化哪个难度就改哪个文件 ==========
// 档案字段见 ai-easy.js 头部注释；assess/hookMid/hookLate 为难度专属钩子
const AI_LEVEL_PROFILES = {};
function aiProfile(){ return AI_LEVEL_PROFILES[aiEffectiveLevel()] || AI_LEVEL_PROFILES[2] || null; }

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
    if(!G.aiBrain) G.aiBrain={ parity:null, lastDigit:null, digitSum:null, tens:null, digits:null, thermo:null, verified:{}, candSet:null, stash:null, soft:null,
        bombCount:null, bombFeats:null, infoUsed:null }; // 多炸弹（裂变）：逐颗炸弹的特征档案+已侦察特征记忆
    return G.aiBrain;
}
// AI 估计的场上炸弹数：提示技报过的精确值 与 自己裂变埋的计数 取大（对手秘密裂变它不知道——诚实信息）
function aiEstBombCount(){
    const b = G.aiBrain;
    return Math.max((b && b.bombCount) || 1, 1 + (G.aiSacUsed||0));
}
// 提示技结果入账（模拟人类的交叉配对思考）：提示技按炸弹顺序报出特征列表，
// 人类会把"第一颗个位2"和"第一颗十位4"配成"第一颗≈42"——逐颗建档而不是记成一锅集合，
// 候选=任一颗已知炸弹的全特征交集位置的并集，比独立集合精确一个数量级。
// 炸弹数组一轮内只增不动（裂变push/移动改[0]），顺序稳定，按索引配对是安全的。
// infoUsed=侦察记忆："个位已经看过了，再看一次零信息量"——决策层据此不重复放同一个提示技
function aiNoteBombFeat(key, valFn){
    const bb = aiBrain();
    bb.bombCount = G.bombNumbers.length;
    bb.infoUsed = bb.infoUsed||{}; bb.infoUsed[key]=true;
    bb.bombFeats = G.bombNumbers.map(function(bn, i){
        const f = (bb.bombFeats && bb.bombFeats[i]) || {};
        f[key] = valFn(bn);
        return f;
    });
    if(G.bombNumbers.length===1){ // 单弹：兼容旧单值线索通路（迷彩池/软线索/线索计数等对偶使用）
        const v = valFn(G.bombNumbers[0]);
        if(key==='lastDigit') bb.lastDigit=v; else if(key==='tens') bb.tens=v;
        else if(key==='digitSum') bb.digitSum=v; else if(key==='digits') bb.digits=v;
    } else { bb.lastDigit=null; bb.tens=null; bb.digitSum=null; bb.digits=null; } // 多弹：单值无意义，只认逐颗档案
}
function aiEmptySoft(){ return { lastDigit:null, tens:null, digitSum:null, parity:null, digits:null }; }
function aiEffectiveLevel(){ return G.mode==='tutorial' ? 2 : G.aiLevel; } // 教程AI恒为普通强度：教学表现与玩家的存档难度设置无关，关卡体验可复现
function aiDigitSum(n){ let s=0; const st=String(n); for(const c of st) s+=+c; return s; }
function aiMatchFeatureSet(n, feat){
    if(!feat) return true;
    if(feat.lastDigit!==null && n%10!==feat.lastDigit) return false;
    if(feat.tens!==null && Math.floor(n/10)%10!==feat.tens) return false;
    if(feat.digitSum!==null && aiDigitSum(n)!==feat.digitSum) return false;
    if(feat.parity!==null && n%2!==feat.parity) return false;
    if(feat.digits!==undefined && feat.digits!==null && String(n).length!==feat.digits) return false;
    return true;
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
    const feats = (b.bombFeats && b.bombFeats.length) ? b.bombFeats : null;
    const sig = [b.parity,b.lastDigit,b.digitSum,b.tens,b.digits,b.thermo?b.thermo.level:'',b.candSet?b.candSet.length:'',b.bombCount||'',
        feats?JSON.stringify(feats):''].join('|');
    if(b.clueSig!==sig){ b.clueSig=sig; b.staleScore=0; }
    const hasCandSet = b.candSet && b.candSet.length>0;
    const soft = (!hardOnly && b.soft) ? b.soft : null;
    const hasSoft = soft && (soft.lastDigit!==null || soft.tens!==null || soft.digitSum!==null || soft.parity!==null || soft.digits!==null);
    const hasClue = hasCandSet || hasSoft || feats || b.parity!==null || b.lastDigit!==null || b.digitSum!==null || b.tens!==null || b.digits!==null || b.thermo || Object.keys(b.verified).length>0;
    if(!hasClue) return null;
    const cands = [];
    for(let n=_aiRLo(); n<=_aiRHi(); n++){
        if(hasCandSet && b.candSet.indexOf(n)<0) continue; // 移位追踪得到的显式候选集
        if(b.parity!==null && (n%2)!==b.parity) continue;
        if(feats){
            // 多炸弹逐颗配对：n 是候选 ⇔ 存在某颗已知炸弹，n 同时满足它的全部已侦察特征
            // 没侦察到的新炸弹（对手/自己刚裂变埋的）不进候选——它们是额外的命中红利，不稀释已有推理
            let anyMatch = false;
            for(const f of feats){
                if(!f) continue;
                if(f.lastDigit!==undefined && f.lastDigit!==null && n%10!==f.lastDigit) continue;
                if(f.tens!==undefined && f.tens!==null && Math.floor(n/10)%10!==f.tens) continue;
                if(f.digitSum!==undefined && f.digitSum!==null && aiDigitSum(n)!==f.digitSum) continue;
                if(f.digits!==undefined && f.digits!==null && String(n).length!==f.digits) continue;
                anyMatch = true; break;
            }
            if(!anyMatch) continue;
        } else {
            if(b.lastDigit!==null && (n%10)!==b.lastDigit) continue;
            if(b.tens!==null && Math.floor(n/10)%10!==b.tens) continue;
            if(b.digitSum!==null){ let s=0; const str=String(n); for(const c of str) s+=+c; if(s!==b.digitSum) continue; }
            if(b.digits!==null && String(n).length!==b.digits) continue; // 探测：炸弹是几位数
        }
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
            if(soft.digits!==null && String(n).length!==soft.digits) return false;
            return true;
        });
        if(fs.length>0) return fs;
        // 软线索与硬事实矛盾（被钓鱼了，或对手模式本就是巧合）：先丢软的，绝不丢真的
        b.soft = null;
        dlog('AI','软线索与硬线索矛盾，全部丢弃');
    }
    return cands;
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
    G.aiBrain = { parity:null, lastDigit:null, digitSum:null, tens:null, digits:null, thermo:null, verified:{}, candSet:null, stash:b.stash||null, soft:null,
        bombCount:b.bombCount||null, bombFeats:null, infoUsed:null }; // 移位/矛盾清空时软线索一起丢（炸弹已换位）；炸弹数量不是取值线索，保留；侦察记忆失效——需要重新侦察
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
    G.aiBrain = { parity:null, lastDigit:null, digitSum:null, tens:null, digits:null, thermo:null, verified:{}, candSet:out, stash:b.stash||null, soft:null,
        bombCount:b.bombCount||null, bombFeats:null, infoUsed:null }; // 自己挪的弹：软线索/特征档案描述的是旧位置，已烘焙进候选集后清空
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
    const hasClue = b.parity!==null || b.lastDigit!==null || b.digitSum!==null || b.tens!==null || b.digits!==null || b.thermo
        || (b.candSet && b.candSet.length>0) || Object.keys(b.verified).length>0
        || (b.bombFeats && b.bombFeats.length>0);
    const stash = hasClue
        ? { parity:b.parity, lastDigit:b.lastDigit, digitSum:b.digitSum, tens:b.tens, digits:b.digits, thermo:b.thermo, verified:b.verified, candSet:b.candSet, soft:b.soft||null,
            bombCount:b.bombCount||null, bombFeats:b.bombFeats, infoUsed:b.infoUsed }
        : (b.stash || null);
    G.aiBrain = { parity:null, lastDigit:null, digitSum:null, tens:null, digits:null, thermo:null, verified:{}, candSet:null, stash:stash, soft:b.soft||null,
        bombCount:null, bombFeats:null, infoUsed:null };
    if(stash) dlog('AI','对手伪装：真身线索已暂存，等识破后取回');
}
// 伪装被识破=真身归位：取回暂存的旧线索（它们描述的正是真身），立刻恢复全部推理
function aiRestoreBrain(){
    const b = G.aiBrain;
    if(!b || !b.stash){ aiWipeValueClues(); return; }
    const s = b.stash;
    G.aiBrain = { parity:s.parity, lastDigit:s.lastDigit, digitSum:s.digitSum, tens:s.tens, digits:(s.digits!==undefined?s.digits:null), thermo:s.thermo, verified:s.verified||{}, candSet:s.candSet||null, stash:null, soft:s.soft||null,
        bombCount:s.bombCount||null, bombFeats:s.bombFeats||null, infoUsed:s.infoUsed||null };
    dlog('AI','伪装识破，取回暂存线索恢复推理');
}

// 加权候选：硬线索照旧硬过滤（确定的真理不让步）；软线索=对手每一猜都在广播的行为证据——
// 收敛到软线索池内选点（跟猜是最基本的逻辑：他连着猜5十位=他看过预知，跟着猜就是），
// 池内再按特征匹配度做概率加权选出最优切割点；
// 与硬事实矛盾时照旧当场丢弃（防钓底线：最多被带偏两轮，模式一破立刻扔）
function aiWeightedCands(){
    const b = G.aiBrain;
    const hard = aiCandidates(true);
    if(hard && hard.length===0) return hard; // 硬线索矛盾：交给调用方走清空重推
    const soft = (b && b.soft) ? b.soft : null;
    const hasSoft = soft && (soft.lastDigit!==null || soft.tens!==null || soft.digitSum!==null || soft.parity!==null || soft.digits!==null);
    if(!hard && !hasSoft) return null;
    let pool = hard;
    if(!pool){ pool = []; for(let n=_aiRLo(); n<=_aiRHi(); n++) pool.push(n); }
    if(hasSoft){
        const fs = pool.filter(n=>aiMatchFeatureSet(n, soft));
        if(fs.length>0) pool = fs; // 跟猜：只在对手广播出来的特征池里选点
        else { b.soft=null; dlog('AI','软线索与硬事实矛盾，全部丢弃'); } // 被钓了：一个都匹配不上
    }
    const W = AI_TUNE.softWeight;
    const out = pool.map(n=>{
        let w = 1;
        if(hasSoft){
            if(soft.lastDigit!==null && n%10===soft.lastDigit) w*=W;
            if(soft.tens!==null && Math.floor(n/10)%10===soft.tens) w*=W;
            if(soft.digitSum!==null && aiDigitSum(n)===soft.digitSum) w*=W;
            if(soft.parity!==null && n%2===soft.parity) w*=W;
            if(soft.digits!==null && String(n).length===soft.digits) w*=W;
        }
        return { n:n, w:w };
    });
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

    // Performance Guard: Limit iteration count for entropy calculations
    const limit = Math.min(wc.length, 300);
    const step = Math.max(1, Math.floor(wc.length / limit));

    const missSet = [];
    let hit = 0;
    for(let i=0; i<wc.length; i+=step){
        const o = wc[i];
        if(o.n===guess) hit += Math.max(0, o.w||0) * step;
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

    // Performance Guard: Limit iteration to prevent freezing on large ranges
    const limit = Math.min(wc.length, 100);
    const step = Math.max(1, Math.floor(wc.length / limit));

    let entropy = 0, width = 0;
    for(let i=0; i<wc.length; i+=step){
        const actual = wc[i];
        const actualP = (Math.max(0, actual.w||0) / total) * step;
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
