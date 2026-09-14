// ============================================================================
// ai.js —— AI 执行层（装配入口）：看门狗 / 选技流程 / 回合执行链 / 教程脚本AI
// 架构（全部在内联主脚本之前加载，声明提升使跨层调用无需关心顺序）：
//   ai-brain.js    信念层：线索推理/模式挖掘/污染检测/冷却档案 + 配置中枢 AI_TUNE
//   ai-strategy.js 决策层：选技评分/技能规划/动态追加/猜数选择（纯选择，不碰DOM）
//   ai-persona.js  人格层：垃圾话/承接对话/即席反应（只表达，不决策）
//   ai.js          执行层：唯一碰 G 流程状态和 DOM 的地方（本文件）
// 依赖主文件全局（运行时调用，无需导入）：G、useSkill、processGuess、dlog、$、
//   getPlayer、setKeypadEnabled、messageDisplay、renderSkills、showCheatToast 等
// ============================================================================

let aiWatchdogInterval = null;
let aiLastProgress = 0;

// ========== AI 看门狗：任何原因导致AI回合停滞超过10秒，强制恢复，杜绝卡死 ==========
function aiMarkProgress(){ aiLastProgress = Date.now(); }
function startAiWatchdog(){
    stopAiWatchdog();
    aiMarkProgress();
    aiWatchdogInterval = setInterval(function(){
        if(!G.active) return;
        if(!(G.mode.includes('ai')||G.mode==='tutorial')) return;
        if(G.currentPlayer!=='p2'){ aiMarkProgress(); return; }
        if(G.pendingSkillSelect || skillSelectPhase){ aiMarkProgress(); return; } // 技能选择阶段不干预
        if(Date.now()-aiLastProgress < 10000) return;
        // AI回合10秒无任何进展 → 作废旧执行链（令牌++），强制重新驱动
        G.aiTurnToken=(G.aiTurnToken||0)+1;
        G.processing=false;
        aiMarkProgress();
        dlog('WATCHDOG','AI停滞超10s，强制重启回合 新token='+G.aiTurnToken);
        if(G.mode==='tutorial') tutorialAI(); else aiPlayNormal();
    }, 2000);
}
function stopAiWatchdog(){ if(aiWatchdogInterval){ clearInterval(aiWatchdogInterval); aiWatchdogInterval=null; } }

function aiSelectSkillWithCallback(skillCount, onComplete){
    const selectedSkills = [];
    for(let i=0; i<skillCount; i++){
        const options = drawSkillOptionIds(3, selectedSkills.map(s=>s.id)).map(getSkillById).filter(s=>s);
        if(options.length === 0) continue;
        const skill = aiChooseSkill(getPlayer('p2'), getPlayer('p1'), options);
        selectedSkills.push(skill);
    }
    getPlayer('p2').skills = [...selectedSkills];
    getPlayer('p2').cooldowns = {};
    G.processing = true;
    messageDisplay.textContent = '对方已选择技能';
    setTimeout(function(){
        if(!G.active){ if(onComplete) onComplete(); return; }
        renderSkills();
        if(onComplete) onComplete();
    }, 900);
}

function aiTurn(){
    if(G.mode==='tutorial'){ tutorialAI(); return; }
    aiPlayNormal();
}
// 决策链异常兜底：绝不能卡死——降级为直接猜视图范围中点，保住回合流转。
// 真实异常已记入 DBG_LOGS（[ERROR] 前缀），事后可翻日志定位
function aiFallbackGuess(){
    if(!G.active || G.currentPlayer!=='p2') return;
    G.processing = false;
    const g = Math.max(_aiRLo(), Math.min(_aiRHi(), Math.round((_aiRLo()+_aiRHi())/2)));
    dlog('AI','兜底猜 '+g+'（决策链异常降级）');
    setTimeout(function(){ if(G.active && G.currentPlayer==='p2'){ G.processing=false; processGuess(g, false, 'p2'); } }, 600);
}
// 通用AI回合（教程模式脚本用完后也走这里）：规划技能连放 → 策略猜数
function aiPlayNormal(){
    try { aiPlayNormalImpl(); }
    catch(e){
        dlog('ERROR','AI回合异常：'+((e&&e.message)||e)+' '+(e&&e.stack ? String(e.stack).split('\n')[1] : ''));
        G.processing = false;
        aiFallbackGuess();
    }
}
function aiPlayNormalImpl(){
    if(!G.active||G.processing||G.currentPlayer!=='p2') return;
    if(G.mode!=='tutorial' && !G.mode.includes('ai')) return;
    const token = ++G.aiTurnToken; // 回合令牌：看门狗重启回合后，旧执行链自动失效
    aiMarkProgress();
    G.processing=true;
    setKeypadEnabled(false);
    messageDisplay.textContent = '对方思考中...';
    const ai=getPlayer('p2'), human=getPlayer('p1');
    const plan = aiPlanSkills(ai, human);
    dlog('AI','回合开始 token='+token+' plan=['+plan.join(',')+'] range='+_aiRLo()+'~'+_aiRHi()+' hp='+ai.hp+'/'+human.hp);
    // 赛前垃圾话/鼓励
    if(G.mode.includes('ai')){
        const combo = ['double','allin','rampage','volley'].filter(id=>plan.includes(id)).length;
        if(combo>=2 && Math.random()<0.6) aiTalk('lethal');
        else if(ai.hp<=2 && Math.random()<0.35) aiTalk('aiLowHP');
        else if(human.hp<=2 && Math.random()<0.35) aiTalk('playerLowHP');
        else if(_aiRHi()-_aiRLo()+1<=6 && Math.random()<0.3) aiTalk('playerClose');
        else if(Math.random()<0.12) aiTalk('idle');
        else if(Math.random()<0.08) aiTalk('encourage');
    }
    let i = 0;
    let topUpDone = false;
    const used = {};
    const step = function(){
        if(!G.active || G.currentPlayer!=='p2' || token!==G.aiTurnToken){ dlog('AI','step中止 active='+G.active+' turn='+G.currentPlayer+' token='+token+'/'+G.aiTurnToken); return; }
        aiMarkProgress();
        if(i>=plan.length && !topUpDone){
            topUpDone = true;
            // 信息技能已放完，候选集已收敛——动态追加斩杀/确认技能（真正的“看着线索打”）
            try {
                const extra = aiTopUp(ai, human, used);
                if(extra.length){ plan.push.apply(plan, extra); dlog('AI','追加技能 ['+extra.join(',')+']'); }
            } catch(e){ dlog('ERROR','AI追加决策异常：'+((e&&e.message)||e)); }
        }
        if(i>=plan.length){ G.processing=false; const _think = G.aiDisguise ? 1500+Math.random()*2500 : 500; dlog('AI','技能放完，'+_think+'ms后猜数'); setTimeout(function(){ if(token===G.aiTurnToken) aiGuess(token); }, _think); return; } // 必须复位processing，否则aiGuess的守卫会拒绝执行导致卡死；伪装模式加真人思考延迟
        const id = plan[i++];
        // 放之前再校验一次（前面的技能可能改变了状态），同一技能每回合只放一次
        const usable = !used[id] && ai.skills.some(s=>s.id===id) && (ai.cooldowns[id]||0)<=0 && ai.lockedSkill!==id && ai.secondLockedSkill!==id;
        if(usable){
            used[id]=true;
            G.processing=false;
            dlog('AI','放技能 '+id+' ('+i+'/'+plan.length+')');
            try {
                useSkill(id, 'p2', true); // ignoreChecks：已预检，且让选数类技能走自动选数
                if(id==='swap'){ for(const k in used) delete used[k]; dlog('AI','交换完成：技能归属易主，使用记录重置——换来的技能接着放'); } // 交换连招：换来的同id技能是另一张牌，不受"每回合一次"约束
            } catch(e){ dlog('ERROR','AI放技能异常 '+id+'：'+((e&&e.message)||e)); } // 单个技能炸了跳过它，链子不能断
            // skip/终局类技能可能已换边或结束游戏，此时绝不能恢复processing（否则人类回合被锁死）
            if(G.active && G.currentPlayer==='p2') G.processing=true;
            else { dlog('AI','技能改变了回合/游戏状态 processing保持false turn='+G.currentPlayer); return; }
        }
        setTimeout(step, 850);
    };
    setTimeout(step, 700);
}

function aiGuess(token){
    if(token!==undefined && token!==G.aiTurnToken){ dlog('AI','aiGuess被令牌拦截 token='+token+'/'+G.aiTurnToken); return; } // 旧执行链的残留调用直接丢弃
    if(!G.active||G.processing||G.currentPlayer!=='p2'){ dlog('AI','aiGuess被守卫拦截 active='+G.active+' processing='+G.processing+' turn='+G.currentPlayer); return; }
    if(G.mode!=='tutorial' && !G.mode.includes('ai')) return;
    aiMarkProgress();
    const ai=getPlayer('p2');
    let guess, usedClues = false;
    try {
        const pick = aiChooseGuess(ai); // 决策层纯选择：返回 {guess, usedClues}
        guess = pick.guess; usedClues = !!pick.usedClues;
    } catch(e){
        dlog('ERROR','AI猜数决策异常：'+((e&&e.message)||e)+' '+(e&&e.stack ? String(e.stack).split('\n')[1] : ''));
        guess = Math.round((_aiRLo()+_aiRHi())/2); // 降级：中点切割，回合必须流转
    }
    if(typeof guess!=='number' || isNaN(guess)){ dlog('ERROR','AI猜数得到非法值 '+guess+'，降级中点'); guess = Math.round((_aiRLo()+_aiRHi())/2); }
    guess = Math.max(_aiRLo(), Math.min(_aiRHi(), guess));
    G.playerInput=String(guess);
    updateInputDisplay();
    // 人类用迷雾冻结了AI视野：AI的猜测数字对人类保密——输入框与消息全部遮蔽
    const aiFogged = getPlayer('p1').viewFog>0;
    if(aiFogged) inputDisplay.textContent='🌫️';
    const _c = aiCandidates();
    const known = aiKnownBomb();
    dlog('AI','猜 '+guess+' range='+_aiRLo()+'~'+_aiRHi()+(usedClues?'(线索)':'(盲猜)')+' 已知='+(known!==null?('确知'+known):('候选'+(_c?_c.length:'无线索'))));
    messageDisplay.textContent= aiFogged ? '🌫️ 对方在迷雾中猜了一个数……' : '对方输入了 '+guess;
    setTimeout(function(){
        if(!G.active) return;
        if(token!==undefined && token!==G.aiTurnToken) return;
        aiMarkProgress();
        G.playerInput='';
        G.processing=false;
        processGuess(guess,false,'p2');
    }, G.aiDisguise ? 900+Math.random()*1500 : 800); // 伪装模式：输入后也像真人一样停顿一下才确定
}

function tutorialAI(){
    if(G.demo) return; // 技能演示：双方都由演示脚本驱动，AI不自主行动
    if(!G.active || G.processing || G.currentPlayer!=='p2') return;
    const t = G.tutorial;
    if(!t) return;
    aiMarkProgress();
    G.processing = true;
    setKeypadEnabled(false);
    if(t.aiScriptQueue.length === 0){
        // aiScript 是按回合分组的二维数组，执行前展平成一维动作队列
        t.aiScriptQueue = t.levelData.aiScript.flat();
        t.currentStepIndex = 0;
    }
    if(t.currentStepIndex >= t.aiScriptQueue.length){
        // 教学脚本执行完毕：切换为正常AI强度（会用技能+策略猜数）
        G.processing = false;
        aiPlayNormal();
        return;
    }
    const action = t.aiScriptQueue[t.currentStepIndex];
    t.currentStepIndex++;
    if(action.note) showCheatToast('🎓 ' + action.note, 4000);
    if(action.type === 'skill'){
        // 脚本里的技能若不可用（冷却中/被封锁），跳过该动作继续下一步
        const aiP = getPlayer('p2');
        const cdOk = (aiP.cooldowns[action.id]||0) <= 0;
        const locked = aiP.lockedSkill===action.id || aiP.secondLockedSkill===action.id;
        const hasSkill = aiP.skills.some(s=>s.id===action.id);
        G.processing = false;
        if(cdOk && !locked && hasSkill) useSkill(action.id, 'p2', true);
        setTimeout(()=>{ if(G.active && G.currentPlayer==='p2') tutorialAI(); }, 800);
    } else if(action.type === 'guess'){
        G.processing = false;
        // 夹取到当前范围，避免脚本数字越界导致无效猜测
        const n = Math.max(_aiRLo(), Math.min(_aiRHi(), action.number));
        processGuess(n, false, 'p2');
    }
}
