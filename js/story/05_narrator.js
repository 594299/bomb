// =====================================================================
// 05_narrator.js · 旁白层（v3 剧情系统 · 第 5 层）
// =====================================================================
// 三层旁白：
//   场景旁白（地点+时间+环境）：#【教室 · 黄昏】……
//   人物旁白（周围有谁）：小奈从门口探进头来……（世界插曲）
//   内心旁白（她心里在想什么）：*……*
// 数据来源：女主文件（场景旁白 / 世界插曲 / 内心独白 / 档案.生活细节）
// 渲染约定：'#' 开头 → 旁白气泡；'*…*' 前补 '#' → 旁白样式的内心独白
// =====================================================================
window.H3Narrator = {

_pick: function(arr){
    return (arr && arr.length) ? arr[Math.floor(Math.random()*arr.length)] : null;
},

// 场景旁白：从女主的场景库随机抽一格（地点·时间），格内再随机抽一条
sceneLine: function(hero){
    var bag = (hero && hero.场景旁白) || {};
    var keys = Object.keys(bag);
    if(!keys.length){
        var fb = window.H3_WORLD ? this._pick(H3_WORLD.通用场景) : null;
        return fb;
    }
    var k = this._pick(keys);
    return this._pick(bag[k]);
},

// 人物旁白 / 世界插曲：让世界"活着"
interlude: function(hero){
    var l = this._pick(hero && hero.世界插曲);
    if(l) return l;
    if(window.H3_WORLD){
        var npc = this._pick(Object.keys(H3_WORLD.配角));
        if(npc) return this._pick(H3_WORLD.配角[npc].台词);
        return this._pick(H3_WORLD.广播);
    }
    return null;
},

// 内心独白：*…* 包住的独白，前缀 '#' 按旁白渲染
innerLine: function(hero){
    var l = this._pick(hero && hero.内心独白);
    return l ? ('#' + l) : null;
},

// 她的生活细节：让她像个活人
lifeLine: function(hero){
    var d = hero && hero.档案 && hero.档案.生活细节;
    var l = this._pick(d);
    return l ? ('#' + l) : null;
},

};
