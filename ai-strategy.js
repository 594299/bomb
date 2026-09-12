// ============================================================================
// ai-strategy.js —— AI 决策层：选技评分 / 回合技能规划 / 动态追加 / 猜数选择
// 职责：回答"这回合该干什么"。纯选择逻辑，不碰 DOM、不执行动作
//   （aiChooseGuess 只返回选好的数，执行在 ai.js 的 aiGuess 里）
// 依赖：ai-brain.js（信念/配置），主文件全局（运行时调用）：G、getPlayer
// ============================================================================

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
        if(owned.includes('peek') && s.id==='detect') sc -= 3; // 有透视再拿探测=白费一个格子
        // 残血优先保命件
        if(ai.hp<=2 && ['heal','shield','reflect','rebirth'].includes(s.id)) sc += 2;
        // 反射+跳过连招协同：有反射才值得拿跳过
        if(owned.includes('reflect') && s.id==='skip') sc += 3;
        if(owned.includes('skip') && s.id==='reflect') sc += 2;
        // 对面有防御件优先破防件
        if((human.shield>0||human.reflect>0||human.rebirth) && ['volley','pierce'].includes(s.id)) sc += 2;
        // 针对选技（counter-pick）：对手技能列表公开——他信息技多，挪弹三件套升值；他控制多，保险件升值
        const humanHas = id => human.skills.some(x=>x.id===id);
        if(['detect','peek','digitsum','precognition','verifier','thermometer'].some(humanHas) && ['move','shuffle','wormhole','fog','tide'].includes(s.id)) sc += 2;
        if(['pause','freeze','blind','lock','slow'].some(humanHas) && ['speed','dormant','rebirth'].includes(s.id)) sc += 1;
        if(human.skills.length>=5 && s.id==='copy') sc += 2; // 对手技能池越深，复制越值
        if(sc > bestSc){ bestSc = sc; best = s; }
    });
    return best;
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
    const range = G.high - G.low + 1;
    let cands = aiCandidates(true); // 技能规划=下重注：只认硬线索，软线索（模式挖掘）不得参与
    if(cands && cands.length===0){ aiWipeValueClues(); cands=null; } // 线索矛盾：清空取值线索重推（保留侦察情报）
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
    const humanThreat = (G.humanSuspicion||0)
        + (avgShrink>0.45?1:0) // 收敛接近二分效率：不是瞎猜，是有章法的推进
        + (oppCdReady('verifier')?1:0)
        + (oppCdReady('binary')?1:0);
    // 对手这回合伤不了我：冰封命中不炸 / 被暂停没有回合——别为空气交保命件
    const humanCanHit = !human.frozen && !human.skipNext;
    // 宏观节奏：血量落后或对手威胁逼近了——放弃钓鱼全速收敛，斩杀阈值也放宽
    G.aiBehind = ai.hp<=human.hp-2 || humanThreat>=3;
    // 对手命中概率估计（终局博弈的核心输入，只看公开行为）：
    // 模式挖出了软线索 → 他大概率只在线索候选里猜，候选数可精确算；否则按收敛效率粗估
    const _soft = (G.aiBrain && G.aiBrain.soft) || null;
    const _hasSoft = _soft && (_soft.lastDigit!==null || _soft.tens!==null || _soft.digitSum!==null || _soft.parity!==null);
    let oppCands = range;
    if(_hasSoft){
        oppCands = 0;
        for(let n=G.low; n<=G.high; n++){
            if(_soft.lastDigit!==null && n%10!==_soft.lastDigit) continue;
            if(_soft.tens!==null && Math.floor(n/10)%10!==_soft.tens) continue;
            if(_soft.digitSum!==null){ let sm=0; const st=String(n); for(const c of st) sm+=+c; if(sm!==_soft.digitSum) continue; }
            if(_soft.parity!==null && n%2!==_soft.parity) continue;
            oppCands++;
        }
        oppCands = Math.max(1, oppCands);
    } else if(avgShrink>0.45) oppCands = Math.max(1, Math.ceil(range/2)); // 有章法的推进：按二分收敛估
    else if(avgShrink>0.3) oppCands = Math.max(1, Math.ceil(range*0.7));
    // 对手出手次数计入加速续猜（公开buff）：带2层加速的对手终局命中率是裸估的3倍
    const oppHitProb = Math.min(1, (1+(human.speed||0))/oppCands);
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
        if(ready('rebirth')) push('rebirth');
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
        else if(ready('shuffle')) push('shuffle');
        else if(ready('wormhole')) push('wormhole');
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

    // 3) 范围压缩（先于信息技能：压缩后的范围更小，线索过滤更精准；
    //    且温度计是范围类线索，若先拿线索再二分，线索会立刻过期——顺序必须压缩→信息）
    //    有信息技跟进时中等范围也值得二分：压缩+线索一套连招直接锁区
    const infoFollow = ['detect','digitsum','peek','precognition','thermometer','verifier'].some(id=>ready(id));
    if(range>40 || (lvl>=4 && range>10) || (lvl>=3 && range>16 && infoFollow)){
        if(lvl>=3 && ready('empower') && ready('binary') && !plan.includes('empower')) push('empower'); // 赋能要在二分前面：赋能二分=连砍两刀
        if(ready('binary')) push('binary');
        else if(lvl>=3 && ready('blackhole') && Math.random()<0.5) push('blackhole');
    }
    // 小范围二分=直接收敛：范围2→1必中，范围3-4→砍半锁定
    if(lvl>=3 && ready('binary') && range>1 && range<=4 && !plan.includes('binary')) push('binary');

    // 4) 信息战（核心）：压缩后立刻拿线索——信息技能结果写入 aiBrain，本回合猜数直接用
    //    多条线索自动组合取交集：奇偶∩个位∩数字和∩首位∩温度计∩验证记录 → 候选集
    const b = G.aiBrain;
    const clueCount = b ? ((b.parity!==null?1:0)+(b.lastDigit!==null?1:0)+(b.digitSum!==null?1:0)+(b.tens!==null?1:0)+(b.thermo?1:0)) : 0;
    const anyInfoReady = ['detect','digitsum','peek','precognition','thermometer'].some(id=>ready(id));
    // 提示类技能优先：只要候选还没收窄到斩杀线、且线索没拿满，就先拿信息再谈其他
    // （按候选数 candCount 判断而非范围：已有线索时范围可能还很大但候选已很少，反之亦然）
    const infoWanted = anyInfoReady && range>2
        && clueCount<(lvl>=4?4:(lvl===3?3:2))
        && candCount>(lvl>=4?3:(lvl===3?6:10)); // 信息技能全在冷却时，不得按"候选将减半"的幻影概率估算斩杀
    if(infoWanted){
        // 不互斥：大师一回合可同时拿 探测+透视+数字和，交集后候选常常只剩个位数
        if(ready('detect') && !(b && b.lastDigit!==null)) push('detect'); // 已知个位=已知奇偶，探测零信息量不拿
        if(lvl>=3 && ready('digitsum')) push('digitsum');
        if(ready('peek')) push('peek');
        if(lvl>=3 && ready('precognition')) push('precognition');
        if(lvl>=3 && ready('thermometer')) push('thermometer');
    }
    // 验证器：候选较少时验证中位候选——中了直接确知炸弹，没中也排除一半候选
    if(ready('verifier') && candCount>1 && candCount<=(lvl>=4?14:(lvl>=3?6:3))) push('verifier');
    // 侦察：对手埋雷/设禁猜/伪装（动作公开、数字保密）→ 必侦察看穿；否则大师低概率顺手刺探
    // 侦察=拿对手冷却视野（威胁评估立刻精确化）：对手行为可疑就刺探，大师也会例行刺探
    if(lvl>=3 && ready('scout') && (ai.scoutVision||0)<=0){
        if((G.humanSuspicion||0)>=1 || avgShrink>0.4) push('scout');
        else if(lvl>=4 && human.skills.length>0 && Math.random()<0.3) push('scout');
    }

    // 4.5) 终局精确博弈：对手下回合命中概率到临界值就必须拆台——
    //      首选秘密挪弹（直接作废他全部推理，零信息暴露），再抢轮次；他能秒我时阈值更宽
    if(lvl>=3 && (oppHitProb>=0.2 || (humanCanHit && humanMaxDmg>=ai.hp && oppHitProb>=0.12) || range<=8+humanThreat*2)){
        if(known===null && (oppHitProb>=0.34 || (humanCanHit && humanMaxDmg>=ai.hp && oppHitProb>=0.2))){
            if(ready('move')) push('move');
            else if(ready('shuffle')) push('shuffle');
            else if(ready('wormhole')) push('wormhole');
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
    const canLethal = effDmg >= human.hp + (human.rebirth?2:0);
    // 命中概率按“放完信息技能后候选数约减半”乐观估计
    let estCand = infoWanted ? Math.max(1, Math.floor(candCount/2)) : candCount;
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
            if(ready('slow') && Math.random()<0.4) push('slow');
            if(ready('rewind') && Math.random()<0.45) push('rewind');
        }
        // 掀桌只在自己没有线索优势时（否则作废的是自己的推理成果）；对手情报多时必掀
        // 移动优先：秘密挪窝，对手的过期线索会变成他的坟墓
        if((Math.random()<(lvl>=4?0.6:0.35) || humanThreat>=2) && (!cands || candCount>8)){
            if(ready('move')) push('move');
            else if(ready('shuffle')) push('shuffle');
            else if(ready('wormhole')) push('wormhole');
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
        // 缓速：范围已小 → 对手猜错也不缩范围，拖住他的收敛速度
        if(ready('slow') && range<=10 && !plan.includes('slow')) push('slow');
        // 蛛网：范围越小雷区覆盖率越高，小范围防守利器（盲猜区±3全变雷）
        if(ready('web') && range<=14 && !plan.includes('web')) push('web');
        // 禁猜/陷阱：即使对手没逼近，小范围时埋在中点也有不错的拦截率
        if(range<=8 && !plan.includes('forbid') && !plan.includes('trap')){
            if(ready('forbid')) push('forbid');
            else if(ready('trap')) push('trap');
        }
        // 回退：被迫进入赌博区（范围小但没线索）→ 重开到自己上次猜之前，拒绝赌命
        if(lvl>=4 && ready('rewind') && range<=6 && candCount>2 && ai.prevLow!==undefined && ai.prevLow!==null) push('rewind');
        // 说谎：这回合反正是低价值猜（被冰封/对手休眠/大范围盲猜），反馈不重要——
        // 赌一手假反馈：50%概率范围不缩小，对手也吃不到自己猜错的收敛红利
        if(ready('lie') && (ai.frozen || human.dormant || candCount>15) && Math.random()<0.5) push('lie');
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
    if(ready('timerewind') && ai.hp<G.roundStartHP.p2 && human.hp>=G.roundStartHP.p1) push('timerewind'); // 回溯也会奶对手，对手没掉血才用
    if(lvl>=3 && ready('anger') && (ai.maxHP-ai.hp)>=4) push('anger');

    // 7.5) 死回合埋伏笔：双倍/子母弹/吸血"猜错不失效"=永不过期的存款——
    //      这回合没事干就提前叠一层，给未来的斩杀存利息（范围大时对手也懒得为它掀桌）
    if(plan.length===0 && lvl>=2 && !ai.frozen && !human.dormant && range>12){ // 对手休眠设伏时增益会打进陷阱，不存款
        if(ready('double')) push('double');
        else if(lvl>=3 && ready('bomblet')) push('bomblet');
        else if(lvl>=4 && ready('lifesteal')) push('lifesteal');
        else if(ready('heal') && ai.hp<ai.maxHP) push('heal'); // 满血前治疗也是白赚的存款
    }

    // 8) 博弈小注
    if(ready('bet') && oppHitProb<0.1 && Math.random()<0.5) push('bet'); // 押对手猜错：他命中概率越低越值（不再拍range>20）
    if(ready('dice') && (willing || ai.hp<=Math.ceil(ai.maxHP/2)) && Math.random()<0.5) push('dice'); // +3伤配攻击回合才不浪费；残血赌回血
    if(ready('gambler') && G.aiBehind && human.hp>ai.hp && Math.random()<0.6) push('gambler'); // EV=0的方差币：逆风翻盘才开，顺风开赌=送翻盘

    // 9) 估值填充：还有空位且本回合没排爆发时，给剩余可用技能打期望分，补上最值的
    //    （每个技能的分数=它这个回合能换来的数学期望，低于1.5分不出手——不值得为它暴露节奏）
    if(lvl>=3 && plan.length<maxSkills && !plan.includes('double') && !plan.includes('allin')){
        const ev = [];
        const add = (id, score) => { if(score>=1.5 && ready(id) && !plan.includes(id)) ev.push([score, id]); };
        if(candCount>3 && !infoWanted){ // 信息技：候选还多时，一条线索≈把候选砍一个数量级
            add('binary', Math.log2(range));
            add('detect', candCount>=8 ? 2.5 : 0);
            add('peek', candCount>=6 ? 2.2 : 0);
            add('digitsum', candCount>=6 ? 2.2 : 0);
            add('precognition', candCount>=6 ? 2.0 : 0);
            add('thermometer', candCount>=10 ? 1.5 : 0);
        }
        // 控制技：对手下回合期望伤害越高越值
        add('pause', oppDmgExp>=0.5 ? oppDmgExp*4 : 0);
        add('freeze', lvl>=4 && oppDmgExp>=0.5 ? oppDmgExp*3 : 0);
        add('blind', oppHitProb>=0.2 ? 1.5 : 0);
        add('slow', range<=10 && oppHitProb>=0.15 ? 1.6 : 0);
        add('numberslash', ai.slashActive>0 ? 0 : 2.0); // 数字斩：3回合≈1点期望收益，白捡的（生效中不重复用）
        // 交换：对手技能池按牌面估价明显比我强才换（与选技共用同一张价值表）
        if(ready('swap')){
            const pool = pl => pl.skills.reduce((a,s)=>a+(AI_TUNE.skillTier[s.id]||5),0);
            if(pool(human) >= pool(ai)+4) add('swap', 3);
        }
        // 防御技：残血时活着才有输出
        if(ai.hp<=3){ add('shield', oppDmgExp*3); add('heal', ai.hp<ai.maxHP ? 2 : 0); }
        // 秘密挪弹：对手威胁越实越值（零暴露成本，作废的是他的推理）
        if(known===null && humanThreat>=2){ add('move', humanThreat*1.5); add('shuffle', humanThreat*1.2); }
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
    if(cands && cands.length===0){ aiWipeValueClues(); cands=null; }
    const known = aiKnownBomb();
    const candCount = known!==null ? 1 : ((cands && cands.length>0) ? cands.length : (G.high-G.low+1));
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
    if((G.high-G.low+1)<=8 && lvl>=3){
        push('pause');
        if(lvl>=4) push('freeze');
    }
    return out;
}

// 猜数决策（纯选择，不碰 DOM 不执行）：返回 {guess, usedClues}
// 本猜命中率写入 G.aiLastGuessP（仅线索制导猜>0），供情报污染检测使用；故意求不中的猜不计
function aiChooseGuess(ai){
    const range=G.high-G.low+1;
    const lvl=aiEffectiveLevel();
    G.aiLastGuessP = 0;
    const known = aiKnownBomb();
    let guess;
    let usedClues = false; // 本猜是否基于确知/候选（盲猜才允许躲雷，稳杀局绝不让步）
    if(ai.frozen && lvl>=3 && !ai.blind && !ai.fog){
        // 被冰封：命中不炸也不缩范围，猜错反而正常缩——故意贴边"求不中"，下回合冰化再杀
        guess = Math.random()<0.5 ? G.low+1 : G.high-1;
        guess = Math.max(G.low, Math.min(G.high, guess));
    } else if(getPlayer('p1').dormant && lvl>=3 && !ai.blind && !ai.fog){
        // 对手休眠设伏：命中=白打还送+2——贴边钓鱼降低踩中率，即使确知炸弹也绝不撞埋伏
        guess = Math.random()<0.5 ? G.low+1 : G.high-1;
        guess = Math.max(G.low, Math.min(G.high, guess));
    } else if(known!==null && !ai.blind && !ai.fog && lvl>=2){
        guess = known; usedClues = true; G.aiLastGuessP = 1; // 验证器命中过，直接收割
    } else if(ai.blind || ai.fog){
        guess = Math.floor(Math.random()*range)+G.low; // 被致盲/迷雾：只能瞎猜
    } else {
        let cands = null, wc = null;
        if(lvl>=3) wc = aiWeightedCands(); // 困难起：硬线索过滤 + 软线索概率加权
        else if(lvl===2 && Math.random()<0.9) cands = aiCandidates(); // 普通AI偶尔走神
        else if(lvl===1 && Math.random()<0.6) cands = aiCandidates(); // 简单AI也会用线索，只是经常想不起来
        if(wc && wc.length===0){ aiWipeValueClues(); wc=null; } // 线索矛盾：清空取值线索重推（保留侦察情报）
        if(cands && cands.length===0){ aiWipeValueClues(); cands=null; }
        if(wc && wc.length>0){
            usedClues = true;
            let totW = 0; wc.forEach(o=>{ totW+=o.w; });
            if(wc.length<=2){
                // 候选极少：按概率权重抽（软线索加权后的最大似然收割）
                let r = Math.random()*totW, pick = wc[0];
                for(let i=0;i<wc.length;i++){ r-=wc[i].w; if(r<=0){ pick=wc[i]; break; } }
                guess = pick.n; G.aiLastGuessP = pick.w/totW;
            } else {
                // 加权最优分割：按"概率质量"对半切，而非按数值中点——
                // 软线索把概率压歪时（如个位=2的候选挤在82/92），切质量中位比切数值中点收敛快一截
                let best=wc[0].n, bestW=wc[0].w, bestScore=Infinity;
                for(let ci=0;ci<wc.length;ci++){
                    const g=wc[ci].n;
                    let below=0, above=0;
                    for(let cj=0;cj<wc.length;cj++){ if(wc[cj].n<g) below+=wc[cj].w; else if(wc[cj].n>g) above+=wc[cj].w; }
                    const tot=below+above;
                    if(tot===0){ best=g; bestW=wc[ci].w; break; }
                    const score=(below*below+above*above)/tot; // 期望剩余概率质量（两侧越均匀越小）
                    if(score<bestScore-1e-9){ bestScore=score; best=g; bestW=wc[ci].w; }
                }
                guess=best; G.aiLastGuessP=bestW/totW;
            }
        } else if(cands && cands.length>0){
            usedClues = true;
            if(cands.length<=2) guess = cands[Math.floor(Math.random()*cands.length)]; // 候选极少：直接收割
            else guess = cands[Math.floor(cands.length/2)]; // 中位切割，最大信息量
            G.aiLastGuessP = 1/cands.length;
            if(lvl<=2 && range>4){ // 简单/普通AI带点抖动，不够精准
                guess += (Math.random()<0.5?-1:1)*Math.floor(Math.random()*3);
                guess = Math.max(G.low, Math.min(G.high, guess));
            }
        } else {
            const mid = (G.low+G.high)/2;
            const fishRate = G.aiBehind ? 0 : (lvl>=4 ? 1 : 0.5); // 逆风不钓鱼：全速中点收敛抢回节奏
            // 大师只在范围很大时才钓鱼——范围≤12直接中点切割，快速收敛压迫感拉满
            const fishRange = lvl>=4 ? 12 : 4;
            // 钓鱼的数学前提：手里有"私有信息优势"（信息技就绪）——把范围撑大，对手的裸猜命中率就一直趴在地板上，
            // 而自己靠线索收敛。没有信息优势时钓鱼=白白放慢自己的斩杀节奏，必须中点切割全速收敛抢先命中
            const infoEdge = ['detect','digitsum','peek','precognition','thermometer'].some(id=>
                ai.skills.some(s=>s.id===id) && (ai.cooldowns[id]||0)<=0 && ai.lockedSkill!==id && ai.secondLockedSkill!==id);
            // 反制钓鱼：自己没有信息优势、但对手行为可疑（逼近答案）时，也贴边猜——
            // 中点切割会把共享范围喂给他收敛，宁可自己慢一点也不送这个信息
            const denyEdge = !infoEdge && (G.humanSuspicion||0)>=2 && Math.random()<0.5;
            if(lvl>=3 && range>fishRange && (infoEdge || denyEdge) && Math.random()<fishRate){
                // 钓鱼猜法（高手策略）：猜贴边数字。命中概率与中点完全相同(1/range)，
                // 但猜错范围只缩1格——不给对手送信息；对手的中点猜法反而替我们缩圈。
                // 若炸弹恰好在最边缘(1/range概率)，范围直接塌缩成1格，下回合必中。
                guess = Math.random()<0.5 ? G.low+1 : G.high-1;
            } else if(lvl===1){
                // 简单AI：中点附近大范围乱飘（不再是全范围纯随机）
                const spread=Math.max(1, Math.floor(range*0.3));
                guess=Math.max(G.low, Math.min(G.high, Math.round(mid+(Math.floor(Math.random()*(spread*2+1))-spread))));
            } else if(lvl===2){
                const spread=Math.max(1, Math.floor(range*0.15));
                const offset=Math.floor(Math.random()*(spread*2+1))-spread;
                guess=Math.max(G.low, Math.min(G.high, Math.round(mid+offset)));
            } else {
                guess = Math.round(mid); // 范围已小：中点切割快速收敛
            }
            guess = Math.max(G.low, Math.min(G.high, guess));
        }
    }
    // 对手本回合发动了陷阱/禁猜（动作公开、数字保密），人类最爱埋正中点——AI避开
    // 仅限盲猜：确知/有候选时躲雷=放弃稳杀，聪明反被聪明误（踩雷掉1血也远小于放过必中）
    if(lvl>=3 && !usedClues && (G.humanTrap || G.humanForbid) && guess===Math.floor((G.low+G.high)/2)){
        guess = Math.max(G.low, Math.min(G.high, guess + (Math.random()<0.5?-1:1)));
    }
    return { guess:guess, usedClues:usedClues };
}
