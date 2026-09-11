// =====================================================================
// 06_ui.js · 界面层（v3 剧情系统 · 第 7 层）
// =====================================================================
// 复用 story.js 的聊天窗口（气泡/打字机/连拍/选项渲染），
// 只接管三件事：
//   1. hubOptions    → v3 女主时，中转站选项换成 12 意图发言矩阵
//   2. chatChoose    → 拦截带 h3 标记的选项，走 v3 引擎
//   3. renderAffBar  → v3 女主时，好感条显示 9 档/5 档与痕迹结局图鉴
// 其余（物语模式 / 章节树 / 猜拳 / 送礼 / 画廊）完全不动。
// =====================================================================
(function(){
'use strict';
if(!window.H3Engine || !window.H3) return;

var scenePending = true;   // 每次打开聊天，第一条回复前补一条场景旁白

// ---------- 洗牌袋：每个意图的变体抽完一轮前不重复；补袋时排除上一屏刚抽过的（保证每屏选项全新） ----------
var optionBags = {}, lastPicked = {};
function drawVariants(intentKey, n){
    var intents = window.H3_INTENTS || {};
    var vs = (intents[intentKey] || {}).variants || [];
    if(!optionBags[intentKey] || optionBags[intentKey].length < n){
        var rest = optionBags[intentKey] || [];
        var prev = lastPicked[intentKey] || [];
        var bag = vs.filter(function(v){ return rest.indexOf(v) < 0 && prev.indexOf(v) < 0; });
        for(var i = bag.length - 1; i > 0; i--){
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
        }
        optionBags[intentKey] = rest.concat(bag);
    }
    var picked = optionBags[intentKey].splice(0, n);
    lastPicked[intentKey] = picked;
    return picked;
}

// ---------- v3 中转站选项：对话链优先 → 情境分支 → 12 意图 × 3 变体 + 互动入口 ----------
function buildOptions(){
    var opts = [];
    var id = H3Engine.activeId();
    // 情境选项（如她刚反向表白：接受 / 调戏 / 拖着 / 拒绝）
    var scene = (H3Engine.getSceneOptions) ? H3Engine.getSceneOptions(id) : [];
    scene.forEach(function(s){
        opts.push({ t:s.t, h3:{ sceneKey:s.key, say:s.say } });
    });
    if(scene.length) return finishOpts(opts);

    // 对话链：她说一句，挂一整屏语气各异的选项（最多 35 个），选了选项跟着刷新
    if(H3Engine.chainOptions){
        var chain = H3Engine.chainOptions(id);
        if(chain && chain.length){
            chain.forEach(function(c, i){
                opts.push({ t:c.t, h3:{ chainIdx:i } });
            });
            opts.push({ t:'（换个话题）', h3:{ chainExit:true } });
            return finishOpts(opts);
        }
    }

    // 12 个意图 × 3 条变体 = 36 条发言选择
    // 洗牌袋机制：每个意图的 30 条变体抽完一轮前绝不重复 → 每屏都是全新选项
    var intents = window.H3_INTENTS || {};
    Object.keys(intents).forEach(function(k){
        drawVariants(k, 3).forEach(function(v){
            var defAff = (v.aff  != null) ? v.aff  : intents[k].aff;
            var defMood= (v.mood != null) ? v.mood : intents[k].mood;
            opts.push({ t:(intents[k].icon ? intents[k].icon + ' ' : '') + v.t,
                        h3:{ intent:k, variant:{ t:v.t, aff:defAff, mood:defMood } } });
        });
    });
    return finishOpts(opts);
}
function finishOpts(opts){
    opts.push({ t:'✊ 猜拳', next:'rps' });
    opts.push({ t:'🎁 送她礼物', next:'gift' });
    opts.push({ t:'🏆 她的结局图鉴', h3:{ gallery:true } });
    opts.push({ t:'（结束聊天）', end:true, final:true });
    return opts;
}

// ---------- 结局图鉴：200 个专属结局，痕迹达成自动解锁 ----------
function showGallery(){
    var data = H3Engine.data(), st = H3Engine.state();
    chatAddMsg('sys', '— 🏆 结局图鉴 · ' + Object.keys(st.endings).length + '/' + H3Engine.endingTotal() + '（痕迹达成自动解锁）—');
    var box = document.getElementById('ai-chat-options');
    box.innerHTML = '';
    box.classList.add('expanded');
    (data.结局 || []).forEach(function(e){
        var got = !!st.endings[e.id];
        var d = document.createElement('div');
        d.className = 'chat-opt' + (got ? '' : ' end locked');
        d.textContent = got ? ('🏆 ' + e.name + ' — ' + e.desc)
                            : ('🔒 ？？？（需要：' + e.cond.join('，') + '）');
        box.appendChild(d);
    });
    var back = document.createElement('button');
    back.className = 'chat-opt end';
    back.textContent = '▴ 返回聊天';
    back.addEventListener('click', function(){ chatRenderOptions(buildOptions()); });
    box.appendChild(back);
}

// ---------- 情境分支处理：她的关键时刻，你的自由回应 ----------
function chooseScene(o){
    if(typeof chatTyping !== 'undefined' && chatTyping) return;
    var id = H3Engine.activeId();
    chatRenderOptions([]);
    chatTyping = true;
    chatAddMsg('me', o.h3.say || o.t);
    var r = H3Engine.respondToScene(id, o.h3.sceneKey);
    if(r.aff || r.mood)
        chatAddMsg('sys', '— 好感' + (r.aff >= 0 ? '+' : '') + r.aff + ' · 心情' + (r.mood >= 0 ? '+' : '') + r.mood + ' —');
    sayTimer = setTimeout(function(){
        chatSayLines(r.lines, function(){
            renderAffBar();
            chatRenderOptions(buildOptions());
        });
    }, 600 + Math.random()*500);
}

// ---------- 对话链选项处理：玩家选择 → 她接话（截然不同）→ 选项刷新 ----------
function chooseChain(o){
    if(typeof chatTyping !== 'undefined' && chatTyping) return;
    var id = H3Engine.activeId();
    chatAddMsg('me', o.t);
    chatRenderOptions([]);
    chatTyping = true;
    var r = H3Engine.chainSay(id, o.h3.chainIdx);
    if(!r){ chatTyping = false; chatRenderOptions(buildOptions()); return; }
    if(r.aff || r.mood)
        chatAddMsg('sys', '— 好感' + (r.aff >= 0 ? '+' : '') + r.aff + ' · 心情' + (r.mood >= 0 ? '+' : '') + r.mood + ' —');
    sayTimer = setTimeout(function(){
        chatSayLines(r.lines.length ? r.lines : ['……'], function(){
            renderAffBar();
            chatRenderOptions(buildOptions());
        });
    }, 500 + Math.random()*500);
}

// ---------- v3 选项处理：玩家发言 → 引擎反应 → 连拍输出 ----------
function chooseH3(o){
    if(typeof chatTyping !== 'undefined' && chatTyping) return;
    if(o.h3.gallery){ showGallery(); return; }
    if(o.h3.sceneKey){ chooseScene(o); return; }
    if(o.h3.chainExit){ H3Engine.chainExit(H3Engine.activeId()); chatRenderOptions(buildOptions()); return; }
    if(o.h3.chainIdx != null){ chooseChain(o); return; }
    var id = H3Engine.activeId();
    chatAddMsg('me', o.t);
    chatRenderOptions([]);
    chatTyping = true;
    var r = H3Engine.react(id, o.h3.intent, o.h3.variant);
    var lines = [];
    if(scenePending){
        scenePending = false;
        var sc = H3Narrator.sceneLine(H3Engine.data(id));
        if(sc) lines.push(sc);
    }
    lines = lines.concat(r.lines);
    if(r.aff || r.mood)
        chatAddMsg('sys', '— 好感' + (r.aff >= 0 ? '+' : '') + r.aff + ' · 心情' + (r.mood >= 0 ? '+' : '') + r.mood + ' —');
    sayTimer = setTimeout(function(){
        chatSayLines(lines, function(){
            renderAffBar();
            chatRenderOptions(buildOptions());
        });
    }, 500 + Math.random()*500);
}

// ---------- 接管 1：中转站选项 ----------
if(typeof window.hubOptions === 'function'){
    var _oldHubOptions = window.hubOptions;
    window.hubOptions = function(){
        if(window.H3 && H3.active()) return buildOptions();
        return _oldHubOptions();
    };
}

// ---------- 接管 2：选项点击 ----------
if(typeof window.chatChoose === 'function'){
    var _oldChatChoose = window.chatChoose;
    window.chatChoose = function(o){
        if(o && o.h3){ chooseH3(o); return; }
        _oldChatChoose(o);
    };
}

// ---------- 接管 2b：选项渲染 ----------
// v3 女主时 ≥35 条选项全部平铺直接显示（expanded 区域可滚动），
// 不再折叠成"展开全部"两步操作；其他女主保持旧渲染。
if(typeof window.chatRenderOptions === 'function'){
    var _oldChatRenderOptions = window.chatRenderOptions;
    window.chatRenderOptions = function(opts){
        if(!(window.H3 && H3.active())){ _oldChatRenderOptions(opts); return; }
        var box = document.getElementById('ai-chat-options');
        box.innerHTML = '';
        box.classList.add('expanded');   // max-height:42% + 滚动，全部直接可点
        (opts || []).forEach(function(o){
            var b = document.createElement('button');
            b.className = 'chat-opt' + (o.end ? ' end' : '');
            b.textContent = o.t;
            b.addEventListener('click', function(){ chatChoose(o); });
            box.appendChild(b);
        });
    };
}

// ---------- 接管 3：好感条（9 档好感 / 5 档心情 / 痕迹结局图鉴） ----------
if(typeof window.renderAffBar === 'function'){
    var _oldRenderAffBar = window.renderAffBar;
    window.renderAffBar = function(){
        if(window.H3 && H3.active()){
            var el = document.getElementById('ai-chat-affinity'); if(!el) return;
            var st = H3Engine.state();
            var t = H3Engine.affTier(st.aff), mt = H3Engine.moodTier(st.mood);
            var pct = (st.aff + 100) / 2;
            el.innerHTML = '好感度 <b style="color:' + t.color + '">' + st.aff + '</b>（' + t.name + '）'
                + ' · 心情 <b style="color:' + mt.color + '">' + mt.name + '</b>'
                + ' · 结局图鉴 <b>' + Object.keys(st.endings).length + '</b>/' + H3Engine.endingTotal()
                + '<div class="aff-bar"><div class="aff-fill" style="width:' + pct + '%"></div></div>';
            var hm = document.getElementById('hero-mood');
            if(hm) hm.textContent = t.name;
            return;
        }
        _oldRenderAffBar();
    };
}

// ---------- 名字下方的关系档，同步成 v3 档位 ----------
if(typeof window.updateHeroName === 'function'){
    var _oldUpdateHeroName = window.updateHeroName;
    window.updateHeroName = function(){
        _oldUpdateHeroName();
        if(window.H3 && H3.active()){
            var hm = document.getElementById('hero-mood');
            if(hm) hm.textContent = H3Engine.affTier(H3Engine.state().aff).name;
        }
    };
}

// ---------- 每次打开聊天：重置场景旁白标记 ----------
if(typeof window.openStoryChat === 'function'){
    var _oldOpenStoryChat = window.openStoryChat;
    window.openStoryChat = function(){
        scenePending = true;
        _oldOpenStoryChat();
    };
}

// ---------- 结局解锁回调：聊天窗口开着时写进聊天记录 ----------
H3.onEnding = function(e){
    try{
        var ov = document.getElementById('ai-chat-overlay');
        if(ov && !ov.classList.contains('hidden')){
            chatAddMsg('sys', '— 🏆 解锁新结局「' + e.name + '」 —');
            chatAddMsg('narr', e.desc);
        }
    }catch(err){}
};

})();
