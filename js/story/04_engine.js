// =====================================================================
// 04_engine.js · v3 引擎（v3 剧情系统 · 核心）
// =====================================================================
// 职责：抽意图 / 查反应 / 记痕迹 / 判结局 / 触发连拍 / 反向表白 / 存档
//
// 存档 key：bomb_chat_story_v3（旧档 bomb_chat_story 不读，玩家是干净的初识状态）
// 对外接口（蓝图改动5）：
//   H3.open()              打开聊天
//   H3.say(intent,variant) 玩家发言
//   H3.close()             关闭聊天
//   H3.status()            查询状态（好感/心情/痕迹/结局）
// 旧系统钩子：
//   window.H3.开场白       openStoryChat 进场播一组开场白（story.js 已预留）
//   window.h3CheckEndings  evalEnding 战斗结算时调用（story.js 已预留）
// =====================================================================
(function(){
'use strict';

var SAVE_KEY = 'bomb_chat_story_v3';

// 女主注册表：旧系统女主 id → v3 数据对象（heroines/*.js 挂在 window 上）
var REGISTRY = {
    lili: function(){ return window.HEROINE_SHUSHADOW; }   // 林溪瑶 · 傲娇青梅竹马（剧情任务/shuying.js）
};

// 反向表白台词（蓝图概念8：勇气值攒满 + 藏心档，她主动开口。数据文件未提供时兜底）
var REVERSE_CONFESS = {
    lili: ['（她盯着屏幕看了很久）', '（打字，删掉，又打）', '哼，我……我也不是不喜欢你。', '……笨蛋。', '#*这句话，她攒了整整三年。*']
};
var CONFESS_AFF = 90;      // 藏心档才触发
var CONFESS_COURAGE = 40;  // 勇气阈值

// =====================================================================
// 人格守卫：她的性格不能丢
// 数据池 98% 的候选是纯叙事拍（打字/喝水/放下手机），本身没有人格。
// 守卫做两件事：
//   1. 抽选偏好：格子里有带性格标记的候选时，优先抽它们（75%）
//   2. 补丁收尾：组装完仍没有一个性格标记时，按好感档补一拍招牌语气
// =====================================================================
var PERSONA_GUARD = {
    lili: {   // 林溪瑶 · 傲娇
        mark: /哼|笨蛋|喂|才不是|又不是|别多想|少得意|要你管|不许|你敢|当我没说|谁稀罕|懒得|啰嗦|讨厌|烦|装傻|闭嘴|坏蛋|想得美|咬你|揍你|别过脸|耳尖|脸红|红了脸|瞪|撇嘴|嘟嘴|赌气|别扭|偷偷|藏|嘴硬|口是心非|想撤回|打了又删|凶|佯装|假装|故意|装作|逞强|死撑|不情不愿|别开头|扭过头|硬邦邦|没好气|翻.*白眼|冷冷/,
        patch: {
            nemesis:  ['（她补了一句）哼。', '（又补）……你别自作多情。', '（隔了很久，她别扭地补来一条）哦。'],
            cold:     ['（她补了一句）……哼。', '（又补）哼，随便你怎么想。', '（她没好气地补）哦。'],
            normal:   ['（她补）哼。', '（又补）……笨蛋。', '（她顿了顿，嘴硬地补一句）哦。'],
            care:     ['（她补）……哼，别多想。', '（又补）才不是担心你。', '（她别扭了一下）笨蛋。'],
            active:   ['（她补）哼，就这一次。', '（又补）……你少得意。', '（她别过脸）笨蛋。'],
            open:     ['（她小声补）……笨蛋。', '（又补）哼，你管我。', '（她耳尖红了）……别多想。'],
            clingy:   ['（她补）哼，就这一次哦。', '（又补）……哼，笨蛋。', '（她把手机抱在怀里）别多想。'],
            hidden:   ['（她补）……哼，当我没说。', '（又补）你不许笑。', '（她别过脸）……笨蛋。'],
            destined: ['（她补）哼。……笨蛋。', '（又补）就依你这一次。哼。', '（她小声）……不许告诉别人。'],
        }
    }
};

// =====================================================================
// 情境回应：她反向表白之后，玩家的四种自由回应（接受/调戏/拖着/拒绝）
// 每种都有独立后果（好感/心情/痕迹/勇气/是否还能再等到她开口）
// =====================================================================
var CONFESS_REPLY = {
    lili: {
        // 接受：她也终于不用再撑了（但嘴上还是要撑一下）
        accept: [
            '（她盯着"我也喜欢你"四个字，看了整整十秒）',
            '……哼。',
            '（连发三条）',
            '算你有眼光。',
            '以后只许对我一个人好。',
            '听见没有，笨蛋。',
            '#*那天她的日记只有一行：他说了。我也是。*',
        ],
        // 调戏：故意说没听清，她当场炸毛
        tease: [
            '（她炸了）',
            '你你你你故意的吧！',
            '（连发三条）',
            '没听清就算了！',
            '我什么都没说！',
            '……你笑什么笑！',
            '（过了半分钟）',
            '（小声）……真的没听清？',
            '（又立刻补）没听清最好！哼！',
            '#*她把脸埋进枕头，蹬了三下腿。*',
        ],
        // 拖着：让她等。她说不急，其实一整晚没睡
        delay: [
            '（她盯着"让我想想"看了很久）',
            '……哦。',
            '（又补）那你慢慢想。',
            '（再补）我又不急。',
            '（再补）一点都不急。',
            '#*她把手机放在胸口，盯着天花板。那一晚，她看了四十七次手机。*',
        ],
        // 拒绝：她的勇气碎了一地，还要假装是开玩笑
        reject: [
            '（她很久没回）',
            '（久到你以为她下线了）',
            '……哦。',
            '知道了。',
            '（又补）当我没说。刚才那条，是发错人了。',
            '（再补）哼，你还真敢当真啊。',
            '#*她的输入框亮了一整夜。一个字都没再发出来。*',
        ],
    }
};

// 好感 9 档（蓝图概念1）：每一档不是"更甜一点"，是"换了个人跟你说话"
var AFF_TIERS = [
    { id:'nemesis',  name:'💢 宿敌', color:'#ff5555', min:-100 },
    { id:'cold',     name:'🧊 冷淡', color:'#7db4ff', min:-39  },
    { id:'normal',   name:'🙂 普通', color:'#cccccc', min:-9   },
    { id:'care',     name:'🌱 在意', color:'#a5e8a0', min:16   },
    { id:'active',   name:'☀️ 主动', color:'#ffe08a', min:36   },
    { id:'open',     name:'🌙 心扉', color:'#7dffbe', min:56   },
    { id:'clingy',   name:'💫 黏人', color:'#ffb3d9', min:76   },
    { id:'hidden',   name:'💗 藏心', color:'#ff9ec6', min:90   },
    { id:'destined', name:'💞 认定', color:'#ff7eb9', min:100  }
];
var AFF_ORDER = ['nemesis','cold','normal','care','active','open','clingy','hidden','destined'];
// 心情 5 档（蓝图概念2）
var MOOD_TIERS = [
    { id:'angry', name:'💢 闹别扭', color:'#ff5555', min:0  },
    { id:'down',  name:'😒 郁闷',   color:'#7db4ff', min:21 },
    { id:'calm',  name:'🙂 平静',   color:'#cccccc', min:41 },
    { id:'happy', name:'😊 开心',   color:'#7dffbe', min:61 },
    { id:'love',  name:'💕 心动',   color:'#ff9ec6', min:86 }
];

function blankState(data){
    var a = (data && data.档案) || {};
    return {
        aff:  (a.好感初始值 != null) ? a.好感初始值 : 10,
        mood: (a.心情初始值 != null) ? a.心情初始值 : 70,
        traces:{}, courage:0, endings:{}, confessed:false,
        msgCount:0, interludeAt: 5 + Math.floor(Math.random()*6), recent:[]
    };
}

var save = { heroines:{} };
try {
    var s = localStorage.getItem(SAVE_KEY);
    if(s){ var p = JSON.parse(s); if(p && p.heroines) save = p; }
} catch(e){}

function persist(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }catch(e){} }
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function tierOf(tiers, v){
    var r = tiers[0];
    for(var i=0;i<tiers.length;i++){ if(v >= tiers[i].min) r = tiers[i]; }
    return r;
}

var Engine = {

has: function(id){ return !!(REGISTRY[id] && REGISTRY[id]()); },
data: function(id){ id = id || Engine.activeId(); return REGISTRY[id] ? REGISTRY[id]() : null; },
activeId: function(){ return (typeof curHero === 'function') ? curHero() : 'lili'; },
state: function(id){
    id = id || Engine.activeId();
    if(!save.heroines[id]){ save.heroines[id] = blankState(Engine.data(id)); persist(); }
    return save.heroines[id];
},
save: persist,
affTier: function(a){ return tierOf(AFF_TIERS, a); },
moodTier: function(m){ return tierOf(MOOD_TIERS, m); },
endingTotal: function(id){ var d = Engine.data(id); return (d && d.结局) ? d.结局.length : 0; },

// ---------- 反应矩阵：意图 × 9 好感档 × 5 心情档，精确命中 ----------
_pickCell: function(data, intent, st, id){
    var pools = data.反应 || {};
    // 数据没写这个意图（如 试探/抽象 未写池）→ 回退到 走心 → 问候
    var pool = pools[intent] || pools['走心'] || pools['问候'];
    if(!pool) return ['……'];
    var tierId = Engine.affTier(st.aff).id, moodId = Engine.moodTier(st.mood).id;
    // 好感档缺失 → 找距离最近的一档
    var t = tierId;
    if(!pool[t]){
        var want = AFF_ORDER.indexOf(tierId), best = null, bd = 99;
        Object.keys(pool).forEach(function(k){
            var idx = AFF_ORDER.indexOf(k); if(idx < 0) return;
            var d = Math.abs(idx - want);
            if(d < bd){ bd = d; best = k; }
        });
        t = best || Object.keys(pool)[0];
    }
    var cell = pool[t] || {};
    // 心情档缺失 → calm → 任意一档
    var m = cell[moodId] ? moodId : (cell.calm ? 'calm' : Object.keys(cell)[0]);
    var cand = cell[m] || [];
    if(!cand.length) return ['……'];
    // 池深加固：每条玩家发言都要有 ≥15 种随机回复。
    // 本格不足 15 条时，先并入同档其他心情，再并入相邻好感档的同心情格。
    if(cand.length < 15){
        var more = cand.slice();
        ['angry','down','calm','happy','love'].forEach(function(mm){
            if(mm !== m && cell[mm]) more = more.concat(cell[mm]);
        });
        if(more.length < 15){
            var ti = AFF_ORDER.indexOf(t);
            for(var d = 1; d <= 3 && more.length < 15; d++){
                [ti - d, ti + d].forEach(function(j){
                    var pc = pool[AFF_ORDER[j]];
                    if(pc && pc[m]) more = more.concat(pc[m]);
                });
            }
        }
        cand = more;
    }
    // 抽 1~3 条连拍，避开最近用过的（同一状态反复说同一句话，她也不重复）
    var fresh = cand.filter(function(c){ return st.recent.indexOf(c.join('')) < 0; });
    if(!fresh.length){ st.recent = []; fresh = cand.slice(); }
    // 人格守卫①：优先抽带性格标记的候选（75% 概率收窄到带标记的子集）
    var guard = PERSONA_GUARD[id];
    if(guard && Math.random() < 0.75){
        var marked = fresh.filter(function(c){ return guard.mark.test(c.join('')); });
        if(marked.length) fresh = marked;
    }
    var n = 1 + (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0);
    n = Math.min(n, fresh.length);
    var out = [];
    for(var i=0;i<n;i++){
        var idx = Math.floor(Math.random()*fresh.length);
        var entry = fresh.splice(idx,1)[0];
        st.recent.push(entry.join(''));
        for(var j=0;j<entry.length;j++) out.push(entry[j]);
    }
    if(st.recent.length > 15) st.recent = st.recent.slice(st.recent.length - 15);

    // ---------- 微拍库组合生长 ----------
    // 主干之外，按 当前心情 × 关系温度 从她的私有素材池袋式抽 1~2 拍，
    // 插进主干的随机位置。袋式：整池抽完一轮前绝不重复。
    var w = ['nemesis','cold'].indexOf(t) >= 0 ? 'y0'
          : ['normal','care','active'].indexOf(t) >= 0 ? 'y1' : 'y2';
    var mp = data.微拍库 && data.微拍库[m] && data.微拍库[m][w];
    if(mp && mp.length){
        st.microBag = st.microBag || {};
        var wk = m + '|' + w, bag = st.microBag[wk];
        if(!bag || !bag.length){
            bag = []; for(var bi = 0; bi < mp.length; bi++) bag.push(bi);
            for(var bs = bag.length - 1; bs > 0; bs--){
                var bj = Math.floor(Math.random() * (bs + 1));
                var bt = bag[bs]; bag[bs] = bag[bj]; bag[bj] = bt;
            }
        }
        var mn = 1 + (Math.random() < 0.45 ? 1 : 0);
        for(var mi = 0; mi < mn && bag.length; mi++){
            var mEntry = mp[bag.pop()];
            var mPos = Math.floor(Math.random() * (out.length + 1));
            for(var mj = 0; mj < mEntry.length; mj++) out.splice(mPos + mj, 0, mEntry[mj]);
        }
        st.microBag[wk] = bag;
    }
    return out;
},

// =====================================================================
// 对话链：她说一句 → 挂最多 35 个语气各异的选项 → 每个选项通向
// 截然不同的她（回复带随机变体，抽完一轮前不重复）→ 选项跟着刷新。
// 选项走尽（无 下）→ 落入反应矩阵 + 微拍库，再回续杯节点，无限接续。
// =====================================================================
_chains: function(data){ return (data && data.对话链) || null; },

// 变体是否匹配当前好感/心情（变体可带 好感:[lo,hi] / 心情:[lo,hi] 条件）
_chainFit: function(v, st){
    if(!v || Array.isArray(v)) return true;   // 无条件变体永远可抽
    if(v.好感 && (st.aff  < v.好感[0] || st.aff  > v.好感[1])) return false;
    if(v.心情 && (st.mood < v.心情[0] || st.mood > v.心情[1])) return false;
    return true;
},

// 抽节点的一个 说 变体：先按好感/心情过滤，再袋式抽取（抽完一轮前不重复）
// 带条件的变体（如"双高→考满分"）与无条件变体同池竞争；
// 若条件变体全部不匹配，自然落到无条件兜底变体。
_chainVariant: function(chains, st, nodeId){
    var node = chains.节点[nodeId];
    if(!node || !node.说 || !node.说.length) return { lines: [] };
    st.chainUsed = st.chainUsed || {};
    var used = st.chainUsed[nodeId] || [], fresh = [];
    for(var i = 0; i < node.说.length; i++)
        if(used.indexOf(i) < 0 && Engine._chainFit(node.说[i], st)) fresh.push(i);
    if(!fresh.length){   // 匹配的都抽过了：在匹配范围内重开一袋
        used = []; fresh = [];
        for(var j = 0; j < node.说.length; j++)
            if(Engine._chainFit(node.说[j], st)) fresh.push(j);
    }
    if(!fresh.length){   // 全部不匹配（数据缺口）：无视条件兜底
        for(var k = 0; k < node.说.length; k++) fresh.push(k);
    }
    var vi = fresh[Math.floor(Math.random() * fresh.length)];
    used.push(vi); st.chainUsed[nodeId] = used;
    var v = node.说[vi];
    if(v && !Array.isArray(v)){ st.chainVarOpts = v.选 || null; return { lines: v.拍 || [] }; }
    st.chainVarOpts = null;
    return { lines: v || [] };
},

// 打开聊天时尝试进链：条件加权入口（真实时段/好感/心情/距上次聊天间隔）
// 返回她的第一句话（null = 走旧开场白）
chainEntry: function(id){
    var data = Engine.data(id), chains = Engine._chains(data), st = Engine.state(id);
    st.chainNode = null; st.chainVarOpts = null; st.chainScene = null;
    if(!chains || !chains.入口 || !chains.入口.length) return null;

    // ---- 过滤出当前条件命中的入口，按权重抽一个 ----
    var now = new Date(), hour = now.getHours();
    var idleH = st.lastChat ? (Date.now() - st.lastChat) / 3600000 : 999;
    var cand = [], totalW = 0;
    for(var i = 0; i < chains.入口.length; i++){
        var e = chains.入口[i];
        if(typeof e === 'string') e = { id:e, 权重:10 };   // 兼容旧格式
        if(!chains.节点[e.id]) continue;
        if(e.时段){   // [起,止]，止>24 表示跨午夜（如 21~27 = 21点~凌晨3点）
            var h = hour < e.时段[0] ? hour + 24 : hour;
            if(h < e.时段[0] || h > e.时段[1]) continue;
        }
        if(e.好感 && (st.aff  < e.好感[0] || st.aff  > e.好感[1])) continue;
        if(e.心情 && (st.mood < e.心情[0] || st.mood > e.心情[1])) continue;
        if(e.间隔小时 && idleH < e.间隔小时) continue;   // 你离开不够久，她还没到"想你"
        var w = e.权重 || 10;
        cand.push({ id:e.id, 场景:e.场景 || null, w:w }); totalW += w;
    }
    if(!cand.length) return null;
    if(Math.random() >= 0.6) return null;   // 60% 概率进链，40% 旧开场白
    var roll = Math.random() * totalW, pick = cand[0];
    for(var j = 0; j < cand.length; j++){ roll -= cand[j].w; if(roll <= 0){ pick = cand[j]; break; } }

    st.chainNode = pick.id;
    st.chainScene = pick.场景;
    var r = Engine._chainVariant(chains, st, pick.id);
    persist();
    return r.lines;
},

// 当前链节点的选项（null = 不在链中，UI 回退到 12 意图矩阵）
chainOptions: function(id){
    var data = Engine.data(id), chains = Engine._chains(data), st = Engine.state(id);
    if(!chains || !st.chainNode || !chains.节点[st.chainNode]) return null;
    var node = chains.节点[st.chainNode];
    return st.chainVarOpts || node.选 || [];
},

// 玩家选了链上第 idx 个选项 → 记痕迹/调数值 → 她接话（截然不同的回复）
chainSay: function(id, idx){
    var data = Engine.data(id), chains = Engine._chains(data), st = Engine.state(id);
    if(!data || !chains) return null;
    var opts = Engine.chainOptions(id);
    var opt = opts && opts[idx];
    if(!opt) return null;
    var idef = (window.H3_INTENTS && window.H3_INTENTS[opt.意]) || {};
    var dA = (opt.aff  != null) ? opt.aff  : (idef.aff  || 0);
    var dM = (opt.mood != null) ? opt.mood : (idef.mood || 0);

    H3_TRACES.record(st, opt.意);                        // 记痕迹 → 通向不同结局
    st.aff  = clamp(st.aff + dA, -100, 100);
    st.mood = clamp(st.mood + dM, 0, 100);
    if(dA > 0) st.courage += 2;
    else if(dA < 0) st.courage = Math.max(0, st.courage - 1);
    st.msgCount++;

    st.lastChat = Date.now();   // 记录互动时间（"想念"入口按此计算间隔）
    // 续杯目标：本场景续杯节点（链走尽/选项自带 回 之后回到这里）
    var xb = (chains.续杯表 && st.chainScene && chains.续杯表[st.chainScene]) || chains.续杯节点 || null;
    var lines;
    if(opt.下 && chains.节点[opt.下]){
        // 手写分支：截然不同的专属回复（带随机变体）
        st.chainNode = opt.下;
        var node = chains.节点[opt.下];
        if(node.静默){ lines = []; st.chainVarOpts = null; }
        else lines = Engine._chainVariant(chains, st, opt.下).lines;
    } else if(opt.回){
        // 选项自带专属回复：每个选项都有自己的她，不再共用一段
        // 回 = ['拍',...]
        //   或 [ ['拍',...], ['拍',...] ]（多变体随机）
        //   或 [ {拍:[...],选:[...]}, ... ]（对象变体：每个回复带专属选项组）
        var rep = opt.回;
        if(Array.isArray(rep) && rep.length && (Array.isArray(rep[0]) || typeof rep[0] === 'object'))
            rep = rep[Math.floor(Math.random() * rep.length)];
        if(rep && !Array.isArray(rep) && typeof rep === 'object'){
            lines = (rep.拍 || []).slice();
            st.chainVarOpts = rep.选 || null;   // 这个回复自己的全新选项组
        } else {
            lines = Array.isArray(rep) ? rep.slice() : [rep];
            st.chainVarOpts = null;
        }
        st.chainNode = xb;
    } else {
        // 链走尽：落入状态矩阵 + 微拍库（组合生长），再回本场景续杯节点
        st.chainNode = xb;
        st.chainVarOpts = null;
        lines = Engine._pickCell(data, opt.意, st, id);
        // 续杯枢纽也抽一个变体：只取它的专属选项组（台词不播），菜单次次不同
        var hub = xb && chains.节点[xb];
        if(hub && !hub.静默) Engine._chainVariant(chains, st, xb);
    }

    // 人格守卫：链回复也不能丢她的性格
    var gd = PERSONA_GUARD[id];
    if(gd){
        var spoken = lines.filter(function(l){ return l.charAt(0) !== '#'; }).join('');
        if(!gd.mark.test(spoken)){
            var pool = gd.patch[Engine.affTier(st.aff).id] || gd.patch.normal;
            lines.push(pool[Math.floor(Math.random() * pool.length)]);
        }
    }
    // 世界插曲：链上同样"世界是活的"
    if(st.msgCount >= st.interludeAt){
        st.interludeAt = st.msgCount + 5 + Math.floor(Math.random() * 6);
        var il = H3Narrator.interlude(data); if(il) lines.push(il);
    }
    persist();
    var ending = Engine.checkEndings(id);
    return { lines: lines, aff: dA, mood: dM, ending: ending };
},

// 换话题：退出对话链，回 12 意图矩阵
chainExit: function(id){
    var st = Engine.state(id);
    st.chainNode = null; st.chainVarOpts = null; st.chainScene = null;
    persist();
},

// ---------- 玩家发言 → 她的完整反应（连拍 + 世界插曲 + 内心独白 + 反向表白） ----------
react: function(id, intent, variant){
    var data = Engine.data(id); if(!data) return { lines:['……'], aff:0, mood:0, ending:null };
    var st = Engine.state(id);
    variant = variant || {};
    var dA = variant.aff || 0, dM = variant.mood || 0;

    H3_TRACES.record(st, intent);                 // 记痕迹
    st.aff  = clamp(st.aff + dA, -100, 100);      // 调好感
    st.mood = clamp(st.mood + dM, 0, 100);        // 调心情
    st.lastChat = Date.now();                     // 记录互动时间（"想念"入口用）
    if(dA > 0) st.courage += 2;                   // 你对她好，勇气涨
    else if(dA < 0) st.courage = Math.max(0, st.courage - 1); // 你冷落她，勇气停滞
    st.msgCount++;

    var lines = Engine._pickCell(data, intent, st, id);

    // 人格守卫②：整条回复仍没有一个性格标记 → 按好感档补一拍招牌语气
    var gd = PERSONA_GUARD[id];
    if(gd){
        var spoken = lines.filter(function(l){ return l.charAt(0) !== '#'; }).join('');
        if(!gd.mark.test(spoken)){
            var pool = gd.patch[Engine.affTier(st.aff).id] || gd.patch.normal;
            lines.push(pool[Math.floor(Math.random()*pool.length)]);
        }
    }

    // 上一幕情境被无视（比如她表白了，你却聊起别的）→ 她装作什么都没发生
    if(st.scene){
        st.scene = null;
        lines.push('（她装作什么都没发生，耳朵还红着）');
    }


    // 世界插曲：每隔 5~10 条对话插一次，让世界"活着"
    if(st.msgCount >= st.interludeAt){
        st.interludeAt = st.msgCount + 5 + Math.floor(Math.random()*6);
        var il = H3Narrator.interlude(data); if(il) lines.push(il);
    }
    // 内心独白：心扉档以上有概率偷看到她的心思
    var tierId = Engine.affTier(st.aff).id;
    if(['open','clingy','hidden','destined'].indexOf(tierId) >= 0 && Math.random() < 0.35){
        var inner = H3Narrator.innerLine(data); if(inner) lines.push(inner);
    }
    // 生活细节：低概率穿插，让她像个活人
    if(Math.random() < 0.12){
        var life = H3Narrator.lifeLine(data); if(life) lines.push(life);
    }
    // 反向表白：勇气攒满 + 藏心档，她主动开口（优先用女主数据的五心情专属版）
    // 被拒绝过的她不会再轻易开口（除非好感重新拉满且勇气翻倍增）
    var canConfess = !st.rejected;
    if(!st.confessed && canConfess && st.aff >= CONFESS_AFF && st.courage >= CONFESS_COURAGE){
        st.confessed = true;
        st.scene = { type:'confession' };          // 进入情境：玩家可接受/调戏/拖着/拒绝
        var confSrc = data.反向表白 || REVERSE_CONFESS[id] || [];
        var conf = Array.isArray(confSrc) ? confSrc
                 : (confSrc[Engine.moodTier(st.mood).id] || confSrc.calm || []);
        for(var i=0;i<conf.length;i++) lines.push(conf[i]);
        setTimeout(function(){
            if(typeof showCheatToast === 'function') showCheatToast('💞 她鼓起了一生的勇气……', 5000);
        }, 1500);
    }
    persist();
    var ending = Engine.checkEndings(id);         // 痕迹判定
    return { lines:lines, aff:dA, mood:dM, ending:ending, scene:st.scene };
},

// ---------- 情境系统：特殊时刻的自由分支（目前：她的反向表白） ----------
getSceneOptions: function(id){
    var st = Engine.state(id);
    if(st.scene && st.scene.type === 'confession'){
        return [
            { key:'accept', say:'我也喜欢你。',        t:'❤️ 接受她："我也喜欢你。"' },
            { key:'tease',  say:'你刚才说什么？没听清。', t:'😏 调戏她："你刚才说什么？没听清。"' },
            { key:'delay',  say:'让我想想。',          t:'🌙 先不回答："让我想想。"' },
            { key:'reject', say:'我们还是做朋友吧。',   t:'🧊 拒绝她："我们还是做朋友吧。"' },
        ];
    }
    return [];
},

respondToScene: function(id, key){
    var data = Engine.data(id); if(!data) return { lines:[], aff:0, mood:0, ending:null };
    var st = Engine.state(id);
    st.scene = null;
    var dA = 0, dM = 0;
    var addT = function(t, n){ st.traces[t] = (st.traces[t] || 0) + n; };
    if(key === 'accept'){          // 接受：直接认定
        dA = 100 - st.aff; dM = 20;
        st.aff = 100; st.mood = clamp(st.mood + 20, 0, 100);
        addT('直球', 2); addT('走心', 2); addT('温柔', 2);
    } else if(key === 'tease'){    // 调戏：她炸毛，但更爱你了
        dA = 2; dM = 5;
        st.aff = clamp(st.aff + 2, -100, 100); st.mood = clamp(st.mood + 5, 0, 100);
        addT('越界', 1); addT('傲娇', 1);
    } else if(key === 'delay'){    // 拖着：她的勇气腰斩，她嘴硬说不急
        dA = -5; dM = -15;
        st.aff = clamp(st.aff - 5, -100, 100); st.mood = clamp(st.mood - 15, 0, 100);
        st.courage = Math.floor(st.courage / 2);
        addT('逃避', 1); addT('试探', 1);
    } else if(key === 'reject'){   // 拒绝：好感暴跌，她不会再主动开口
        dA = -30; dM = -30;
        st.aff = clamp(st.aff - 30, -100, 100); st.mood = clamp(st.mood - 30, 0, 100);
        st.courage = 0; st.rejected = true;
        addT('冷淡', 2); addT('冲突', 1);
    }
    persist();
    var ending = Engine.checkEndings(id);
    return { lines:(CONFESS_REPLY[id] || {})[key] || [], aff:dA, mood:dM, ending:ending };
},

// ---------- 结局判定：不看走了哪条路，看痕迹组合。同一时刻只解锁一个（优先级从前往后） ----------
checkEndings: function(id){
    var data = Engine.data(id); if(!data || !data.结局) return null;
    var st = Engine.state(id);
    for(var i=0;i<data.结局.length;i++){
        var e = data.结局[i];
        if(st.endings[e.id]) continue;
        if(H3_TRACES.parseCond(e.cond, st.traces)){
            st.endings[e.id] = true; persist();
            var cnt = Object.keys(st.endings).length;
            setTimeout(function(){
                if(typeof showCheatToast === 'function')
                    showCheatToast('🏆 解锁新结局「' + e.name + '」· 图鉴 ' + cnt + '/' + data.结局.length, 5000);
            }, 1200);
            if(typeof dlog === 'function') dlog('H3', '结局：' + e.name + ' traces=' + JSON.stringify(st.traces));
            if(window.H3 && typeof H3.onEnding === 'function') H3.onEnding(e);
            return e;
        }
    }
    return null;
},

// ---------- 对局结算：胜负自然增减好感/心情，并做痕迹结局判定 ----------
onBattleEnd: function(winnerId){
    var id = Engine.activeId(); if(!Engine.has(id)) return;
    var st = Engine.state(id);
    st.aff  = clamp(st.aff  + (winnerId === 'p1' ? 2 : 1), -100, 100);
    st.mood = clamp(st.mood + (winnerId === 'p1' ? 4 : -5), 0, 100);
    st.courage++;
    persist();
    Engine.checkEndings(id);
},

};

window.H3Engine = Engine;

// ---------- 对外门面：旧系统（story.js）预留的两个钩子都从这里取数据 ----------
window.H3 = {
    // 打开聊天：60% 概率进对话链（她的第一句话就是链的根节点），否则旧开场白
    get 开场白(){
        var d = Engine.data(); if(!d) return null;
        try{
            var id = Engine.activeId();
            var chainLines = Engine.chainEntry(id);
            if(chainLines && chainLines.length) return [chainLines];
        }catch(e){}
        return d.开场白 || null;
    },
    active: function(){ return Engine.has(Engine.activeId()); },
    // 蓝图改动5 · 对外 4 接口
    open:   function(){ if(typeof openStoryChat === 'function') openStoryChat(); },
    say:    function(intent, variant){ return Engine.react(Engine.activeId(), intent, variant); },
    close:  function(){ if(typeof closeAiChat === 'function') closeAiChat(); },
    status: function(){
        var st = Engine.state();
        return { 好感:st.aff, 心情:st.mood, 痕迹:Object.assign({}, st.traces),
                 勇气:st.courage, 结局:Object.keys(st.endings).length + '/' + Engine.endingTotal() };
    },
    onEnding: null   // 06_ui.js 挂回调：聊天窗口开着时把结局写进聊天记录
};

// ---------- 旧系统钩子 1：evalEnding 预留的 h3CheckEndings() ----------
window.h3CheckEndings = function(){
    try{
        var id = Engine.activeId();
        if(Engine.has(id)) Engine.checkEndings(id);
    }catch(e){}
};

// ---------- 旧系统钩子 2：包装 evalEnding，战斗结算同步 v3 状态 ----------
if(typeof window.evalEnding === 'function'){
    var _oldEvalEnding = window.evalEnding;
    window.evalEnding = function(winnerId){
        _oldEvalEnding(winnerId);
        try{ Engine.onBattleEnd(winnerId); }catch(e){}
    };
}

})();
