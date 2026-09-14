// ============================================================================
// ai-master.js —— 难度4「大师」档案：要优化大师AI，只改这一个文件
// 字段说明见 ai-easy.js 头部注释
// 大师的三件独门武器全在本文件的钩子里：
//   assess(h)   线索污染风险评估 + 节奏赛跑估算 → 给骨架输出修正量
//   hookMid(h)  天平拆斩杀线 / 反情报升级 / 重注前再验证
//   hookLate(h) 赋能连招 / 裂变精算 / 暂停+续猜连动 / 终局拆台套件 / 估值补位
// ============================================================================
AI_LEVEL_PROFILES[4] = {
    name:'大师',
    pickNoise: 0,            // 零随机：永远锁定最优阵容，绝不拿废技
    randomPlan: false,
    maxSkills: 99,           // 连放不设上限（只受持有数+1约束）
    advanced: true, master: true,
    clueWanted: 4,           // 信息战拿满4条线索才停
    verifierCandMax: 14,     // 候选≤14就敢验证（困难只敢≤6）
    forecastDepth: 3,        // 对手预测树看三层（其余难度两层）
    useWeighted: true, softRate: 1, candJitter: false, guessSpread: 0,
    fishRate: 1,             // 有信息优势必钓鱼：把范围撑大，对手裸猜命中率永远趴在地板上
    fishRange: 12,           // 但范围≤12直接中点切割，快速收敛压迫感拉满
    useKnown: true,
    useTopUp: true, topUpCap: 4, topUpAllinHp: 2, topUpSpeed: true, topUpFreeze: true,
    deposit: true, balanceDanger: true,
    sabotageRange: 12, moveFlipRate: 0.6, blindChipRate: 0, blackholeAltRate: 0.5,
    binaryEager: true,       // 范围>10就积极二分（其余难度>40才动）
    allinMinHp: 2,           // 2血也敢孤注一掷
    willingExtra: 0.25,      // 有增伤、三成把握就敢all-in
    antiIntelRate: 1,        // 反情报掀桌必执行（困难0.85）
    knownSpeed: true,        // 确知斩杀链带续猜保险
    scoutBase: 0.3,          // 例行刺探对手冷却

    // 威胁评估修正：①线索污染风险——对手捏着就绪的挪弹/潮汐/伪装，我的线索随时整批作废
    //               ②节奏赛跑——双方命中ETA对比，落后就必须强拆抢轮次、停止一切钓鱼
    //               ③斩杀前兆——对手增伤已叠+验证器/二分就绪+伤害够秒我：他离斩杀只差一猜
    assess: function(h){
        const clueRisky = h.known===null && h.humanThreat>=1 && aiClueRisky(h.oppCdReady);
        const aiETA = aiRoundsToHit(h.candCount, 1+(h.ai.speed||0)+(h.ready('speed')?1:0));
        const humanETA = h.humanCanHit ? aiRoundsToHit(h.oppCands, 1+(h.human.speed||0)) : 99;
        const losingRace = h.known===null && humanETA<aiETA;
        G.aiRaceState = losingRace ? 'losing' : (aiETA+1<humanETA ? 'winning' : 'even'); // 供猜数层：落后立刻停止钓鱼贴边
        const lethalSetup = h.humanArmed && h.humanCanHit && h.humanMaxDmg>=h.ai.hp
            && (h.oppCdReady('verifier')||h.oppCdReady('binary'));
        // 连招阅读：斩杀链已上膛且伤害够秒我，即使他还没接近答案也要提前拆台
        const combo = aiReadHumanCombo(h.human);
        const chainThreat = combo==='lethal-chain' && h.humanCanHit && h.humanMaxDmg>=h.ai.hp && h.oppHitProb>=0.08;
        return {
            // 只在"真靠线索下重注且不急"时抬门槛：没线索无所谓过期，赛跑落后时拖延才是真的亏
            riskUp: (clueRisky && h.cands && !losingRace) ? 0.08 : 0,
            forceSabotage: losingRace || lethalSetup || chainThreat, // 落后/斩杀前兆/斩杀链上膛：强拆
            scoutBoost: clueRisky,
            clueRisky: clueRisky,
            losingRace: losingRace
        };
    },

    // 中盘钩子：保命/反制之后、范围压缩之前
    hookMid: function(h){
        const plan=h.plan, ready=h.ready, push=h.push, ai=h.ai, human=h.human;
        // 天平拆斩杀线：未进危险线，但对面一发能秒我且血差≥2——平分后他的秒杀线直接崩掉
        if(ready('balance') && !plan.includes('balance') && human.hp-ai.hp>=2 && h.humanCanHit && h.humanMaxDmg>=ai.hp) push('balance');
        // 反情报升级：对手情报已多且自己离解开还远——伪装/迷雾一起上，让他的推理成果彻底作废
        if(h.humanThreat>=2 && h.known===null && (!h.cands || h.candCount>5)){
            if(ready('disguise')) push('disguise');
            if(ready('fog')) push('fog');
        }
        // 小范围反运气：伪装换假身，猜假身不炸还暴露位置
        if(h.range<=5 && h.known===null && (!h.cands || h.candCount>2) && ready('disguise')) push('disguise');
        // 线索污染风险：下重注前先再验证当前最优候选——确认没过期的情报才配下重注
        if(h.assess && h.assess.clueRisky && ready('verifier') && h.candCount>1 && h.candCount<=16 && !plan.includes('verifier')) push('verifier');
    },

    // 收尾钩子：估值填充之后、互斥收尾之前
    hookLate: function(h){
        const plan=h.plan, ready=h.ready, push=h.push, ai=h.ai, human=h.human;
        // 终局拆台套件：对手命中概率到临界（或赛跑落后）时的全套反制
        if(h.oppHitProb>=0.2 || (h.humanCanHit && h.humanMaxDmg>=ai.hp && h.oppHitProb>=0.12)
            || h.range<=8+h.humanThreat*2 || (h.assess && h.assess.forceSabotage)){
            if(ready('freeze')) push('freeze');
            if(ready('dormant')) push('dormant');
            if(ready('speed') && h.candCount<=4) push('speed'); // 抢在他命中之前先收完
            if(h.assess && h.assess.losingRace && ready('blind') && !plan.includes('blind')) push('blind'); // 致盲抹平他的ETA优势
        }
        // 暂停+续猜连动收割：对手空过的回合≈白送两次出手
        if(plan.includes('pause') && ready('speed') && h.candCount<=6 && !plan.includes('speed')) push('speed');
        // 小范围破坏套件：伪装/蛛网/致盲/迷雾全上
        if(h.range<=12){
            if(ready('disguise')) push('disguise');
            if(ready('web')) push('web');
            if(ready('blind') && Math.random()<0.5) push('blind');
            if(ready('fog') && Math.random()<0.4) push('fog');
        }
        // 斩杀回合：候选少买续猜，收割率拉满
        if(h.willing && ready('speed') && h.estCand<=4 && !plan.includes('speed')) push('speed');
        // 裂变精算：免费多炸弹=平局器，只帮信息落后方——发散没线索/赛跑落后时必放；
        // 带续猜（speed）时多目标放大续猜收益是例外，收敛与否都值。前提：范围还放得下
        if(ready('sacrifice') && !plan.includes('sacrifice') && h.range<=30 && h.estBombs<h.range && h.known===null
            && (!h.cands || h.candCount>4 || (h.assess && h.assess.losingRace) || (ai.speed||0)>0 || plan.includes('speed'))){
            push('sacrifice');
        }
        // 赋能连招：赋能必须紧排在目标技前一位（赋能只喂下一个技能）
        if(ready('empower') && !plan.includes('empower') && plan.length<h.maxSkills-1){
            if(ready('heal') && ai.hp<=ai.maxHP-2 && !plan.includes('heal')){ push('empower'); push('heal'); } // 赋能+治疗=回2血：残血补给翻倍
            else if(ready('lock') && human.skills.length>=2 && h.humanThreat>=1 && !plan.includes('lock')){ push('empower'); push('lock'); } // 赋能+封锁=一封二：直接卸他两件套
            else if(ready('sacrifice') && !plan.includes('sacrifice') && h.range<=30 && h.estBombs+2<=h.range && h.known===null && (!h.cands || h.candCount>4)){ push('empower'); push('sacrifice'); } // 赋能+裂变=一次两弹：平局器连招，只在信息不占优时放（范围放得下两颗）
        }
        // 赋能+移动：赋能后挪10格，过期线索错得更离谱（反情报升级版）
        if(ready('empower') && plan.includes('move') && !plan.includes('empower') && plan.length<h.maxSkills){
            plan.splice(plan.indexOf('move'), 0, 'empower'); // 赋能必须插在移动前面
        }
        // 估值补位：本回合没排爆发时，天平/裂变/冰封按局势补进空位
        if(!plan.includes('double') && !plan.includes('allin')){
            if(ready('balance') && human.hp-ai.hp>=2) push('balance'); // 天平：血差越大越值
            if(ready('sacrifice') && h.known===null && h.estBombs<h.range && (!h.cands || h.candCount>=4)) push('sacrifice'); // 裂变=平局器：信息不占优时埋弹才赚
            if(ready('freeze') && h.oppDmgExp>=0.5) push('freeze'); // 对手期望伤害高：冰封值得常备
        }
        // 冷却节奏：先用先冷却——技能捏着不用=白白浪费周转，局势中性偏赚就早用早转CD
        if(plan.length<h.maxSkills){
            // 侦察：纯收益（2回合冷却视野+立刻开始转CD），对手有技能就越早开越值
            if(ready('scout') && (ai.scoutVision||0)<=0 && human.skills.length>0 && !plan.includes('scout')) push('scout');
            // 缩圈利己性：我有线索优势（候选占比≤范围一半）→ 黑洞缩圈放大我的优势，顺带转CD
            if(ready('blackhole') && !plan.includes('blackhole') && !plan.includes('binary')
                && h.cands && h.candCount<=Math.max(2, Math.floor(h.range*0.5)) && h.range>=8) push('blackhole');
            // 充能：有技能在冷却=纯赚1回合CD周转，早用早转
            if(ready('charge') && !plan.includes('charge') && Object.keys(ai.cooldowns).some(k=>ai.cooldowns[k]>0)) push('charge');
            // 刷新：有技能冷却≥2就刷——刷新本身也开始转自己的CD，捏着=双份浪费
            if(ready('refresh') && !plan.includes('refresh') && Object.keys(ai.cooldowns).some(k=>ai.cooldowns[k]>=2)) push('refresh');
        }
        // 潮汐自伤否决：候选快收敛（≤6）时撤下潮汐——稀释对手视野的同时也在稀释自己的线索成果
        if(plan.includes('tide') && h.cands && h.candCount<=6){
            plan.splice(plan.indexOf('tide'), 1);
        }
        // 对手休眠设伏：不踩伏也别干等——跳过让埋伏烂掉（回合照过，增益照存）
        if(human.dormant && h.candCount>1 && ready('skip') && !plan.includes('skip')) push('skip');
        // 信息技精算：①剔除零信息技（线索在当前范围恒定=白暴露冷却）
        //              ②剩余按精确期望缩减重排，最好的先放（链子断了也不亏）
        const infoIds = ['binary','peek','digitsum','precognition','detect'];
        const lo = _aiRLo(), hi = _aiRHi();
        for(let i=plan.length-1; i>=0; i--){
            if(infoIds.indexOf(plan[i])>=0 && aiInfoUseless(plan[i], lo, hi)) plan.splice(i,1);
        }
        const infos = plan.filter(id=>infoIds.indexOf(id)>=0);
        if(infos.length>1){
            // 打包：empower+X 视为一体（赋能只喂下一个技能，排序绝不拆散）
            const units = [];
            for(let i=0;i<plan.length;i++){
                const id = plan[i];
                if(id==='empower' && i+1<plan.length && infoIds.indexOf(plan[i+1])>=0){
                    units.push({ ids:['empower', plan[i+1]], info:plan[i+1] });
                    i++;
                } else {
                    units.push({ ids:[id], info: infoIds.indexOf(id)>=0 ? id : null });
                }
            }
            const infoUnits = units.filter(u=>u.info);
            infoUnits.sort((a,b)=>aiExpectedPoolAfter(a.info,lo,hi)-aiExpectedPoolAfter(b.info,lo,hi));
            const out = [];
            let inserted = false;
            for(const u of units){
                if(u.info){
                    if(!inserted){ infoUnits.forEach(iu=>iu.ids.forEach(id=>out.push(id))); inserted=true; }
                } else {
                    u.ids.forEach(id=>out.push(id));
                }
            }
            plan.length = 0;
            out.forEach(id=>plan.push(id));
        }
    },

    // 读雷躲雷：综合预测对手雷区（预测树高分点±1 ∪ 历史雷位热区±1）
    // 盲猜：整片让开；线索制导：首选踩雷区才换备选，且备选概率≥首选一半——防被埋，但不防傻
    guessAdjust: function(c){
        if(c.known!==null) return null;
        if(!(G.humanTrap || G.humanForbid)) return null;
        const zones = aiPredictedTrapZones(c.lo, c.hi);
        if(!c.usedClues){
            if(zones[c.guess]){
                for(let d=2; d<=6; d++){
                    const lo=c.guess-d, hi=c.guess+d;
                    if(lo>=c.lo && !zones[lo]) return lo;
                    if(hi<=c.hi && !zones[hi]) return hi;
                }
            }
            return null;
        }
        if(!zones[c.guess]) return null;
        const wc = aiWeightedCands();
        if(!wc || wc.length<2) return null;
        const total = aiWeightedTotal(wc);
        if(total<=0) return null;
        const cur = wc.find(o=>o.n===c.guess);
        if(!cur) return null;
        const alt = wc.filter(o=>!zones[o.n]).sort((a,b)=>b.w-a.w)[0];
        if(alt && alt.w >= cur.w*0.5) return alt.n; // 备选明显更差就不换：踩雷掉1血<放弃稳杀
        return null;
    }
};
