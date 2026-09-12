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
        blind:5, lock:5, slow:5, disguise:5, web:5, anger:5, lifesteal:5, thermometer:5,
        refresh:5, charge:5, move:5, tide:5, wormhole:5, blackhole:5,
        rewind:4, bet:4, fog:4, lie:4, copy:4, timerewind:4, swap:4,
        dice:3, gambler:3, skip:4
    }
};

// AI 大脑：只用公开信息 + 信息技能私有结果做推理（不偷看炸弹）
function aiIsUser(u){ return u.id==='p2' && (G.mode.includes('ai') || G.mode==='tutorial'); }
function aiBrain(){
    if(!G.aiBrain) G.aiBrain={ parity:null, lastDigit:null, digitSum:null, tens:null, thermo:null, verified:{}, candSet:null, stash:null, soft:null };
    return G.aiBrain;
}
function aiEmptySoft(){ return { lastDigit:null, tens:null, digitSum:null, parity:null }; }
function aiEffectiveLevel(){ return G.mode==='tutorial' ? Math.min(G.aiLevel, 2) : G.aiLevel; }
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
    for(let n=G.low; n<=G.high; n++){
        if(hasCandSet && b.candSet.indexOf(n)<0) continue; // 移位追踪得到的显式候选集
        if(b.parity!==null && (n%2)!==b.parity) continue;
        if(b.lastDigit!==null && (n%10)!==b.lastDigit) continue;
        if(b.tens!==null && Math.floor(n/10)%10!==b.tens) continue;
        if(b.digitSum!==null){ let s=0; const str=String(n); for(const c of str) s+=+c; if(s!==b.digitSum) continue; }
        if(b.thermo && b.thermo.low===G.low && b.thermo.high===G.high){ const d=Math.abs(n-b.thermo.mid); const lv=Math.max(1,Math.min(10,Math.round(10-(d/b.thermo.maxDist)*9))); if(lv!==b.thermo.level) continue; }
        if(b.verified[n]===false) continue;
        cands.push(n);
    }
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
    const dsum = n => { let sm=0; const st=String(n); for(const c of st) sm+=+c; return sm; };
    // 已确认的软线索被新猜测打破 → 当场作废
    if(s.lastDigit!==null && guess%10!==s.lastDigit){ s.lastDigit=null; dlog('AI','软线索[个位]被打破，丢弃'); }
    if(s.tens!==null && Math.floor(guess/10)%10!==s.tens){ s.tens=null; dlog('AI','软线索[十位]被打破，丢弃'); }
    if(s.digitSum!==null && dsum(guess)!==s.digitSum){ s.digitSum=null; dlog('AI','软线索[数字和]被打破，丢弃'); }
    if(s.parity!==null && guess%2!==s.parity){ s.parity=null; dlog('AI','软线索[奇偶]被打破，丢弃'); }
    // 确认新软线索：连续N次猜中同一特征才采信（N按巧合率定）；确认=对手在线索驱动，威胁拉满
    const confirm = (attr, val, need) => {
        if(s[attr]!==null || seq.length<need) return;
        const tail = seq.slice(-need);
        const f = attr==='lastDigit' ? (n=>n%10) : attr==='tens' ? (n=>Math.floor(n/10)%10) : attr==='digitSum' ? dsum : (n=>n%2);
        if(!tail.every(n=>f(n)===val)) return;
        s[attr]=val;
        G.humanSuspicion=(G.humanSuspicion||0)+2;
        dlog('AI','模式挖掘确认：对手疑似掌握['+attr+'='+val+']（连续'+need+'次一致）');
    };
    confirm('lastDigit', guess%10, 2); // 连续2次同个位，巧合率~1%
    if(Math.floor(G.low/10)!==Math.floor(G.high/10)) confirm('tens', Math.floor(guess/10)%10, 2); // 范围横跨十位才有意义
    if(lvl>=4){ // 大师才做弱信号模式
        confirm('digitSum', dsum(guess), 3); // 数字和巧合率不低，要3次
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
    if(!pool){ pool = []; for(let n=G.low; n<=G.high; n++) pool.push(n); }
    const W = AI_TUNE.softWeight;
    const dsum = n => { let s=0; const st=String(n); for(const c of st) s+=+c; return s; };
    let boosted = 0;
    const out = pool.map(n=>{
        let w = 1;
        if(hasSoft){
            if(soft.lastDigit!==null && n%10===soft.lastDigit) w*=W;
            if(soft.tens!==null && Math.floor(n/10)%10===soft.tens) w*=W;
            if(soft.digitSum!==null && dsum(n)===soft.digitSum) w*=W;
            if(soft.parity!==null && n%2===soft.parity) w*=W;
        }
        if(w>1) boosted++;
        return { n:n, w:w };
    });
    if(hasSoft && boosted===0){ b.soft=null; dlog('AI','软线索与硬事实矛盾，全部丢弃'); } // 被钓了：一个都匹配不上
    return out;
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
