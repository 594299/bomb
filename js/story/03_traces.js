// =====================================================================
// 03_traces.js · 痕迹层（v3 剧情系统 · 第 6 层）
// =====================================================================
// 玩家每次发言都会留下"痕迹"。结局不看走了哪条路，看痕迹组合。
// 10 个核心痕迹：温柔 / 直球 / 傲娇 / 冷淡 / 抽象 / 走心 / 关心 / 试探 / 越界 / 守护
// 外加数据文件结局条件里用到的：逃避 / 冲突 / 热血（回避 归一为 逃避）
// =====================================================================
window.H3_TRACES = {

// 别名归一：数据文件里 cond 用了"回避"，与"逃避"同义
alias: { '回避': '逃避' },

// 意图 → 痕迹映射：玩家说一句该意图的话，对应痕迹各 +1
byIntent: {
    '问候': ['温柔'],
    '关心': ['关心', '守护'],
    '调戏': ['越界', '直球'],
    '表白': ['直球', '走心'],
    '走心': ['走心', '温柔'],
    '热血': ['热血', '抽象'],
    '冷淡': ['冷淡', '傲娇'],
    '试探': ['试探', '傲娇'],
    '抽象': ['抽象'],
    '逃避': ['逃避', '冷淡'],
    '冲突': ['冲突', '越界'],
    '哲学': ['走心', '抽象'],
},

norm: function(name){ return this.alias[name] || name; },

// 记录一次发言的痕迹
record: function(st, intent){
    var list = this.byIntent[intent] || [];
    for(var i=0;i<list.length;i++){
        var t = list[i];
        st.traces[t] = (st.traces[t] || 0) + 1;
    }
},

// 解析结局条件：['温柔>=3','走心>=2'] 全部满足才命中
parseCond: function(conds, traces){
    if(!Array.isArray(conds) || !conds.length) return false;
    for(var i=0;i<conds.length;i++){
        var m = /^\s*(.+?)\s*(>=|<=|==|>|<)\s*(\d+)\s*$/.exec(conds[i]);
        if(!m) return false;
        var v = traces[this.norm(m[1])] || 0, n = +m[3];
        switch(m[2]){
            case '>=': if(!(v>=n)) return false; break;
            case '<=': if(!(v<=n)) return false; break;
            case '>':  if(!(v>n))  return false; break;
            case '<':  if(!(v<n))  return false; break;
            case '==': if(!(v===n)) return false; break;
        }
    }
    return true;
},

};
