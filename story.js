// =====================================================================
// 剧情系统独立模块（从 index.html 迁移）
// 内容：唯一女主「林溪瑶」（傲娇青梅竹马，设定源自 剧情任务/shuying.js）/
//       好感度·心情值 / 剧情节点树 / 特别事件池 / 结局图鉴 / 物语模式 / 存档管理
// 后续优化剧情只需修改本文件；主程序通过 StoryBind() 注入内部工具函数。
// =====================================================================
'use strict';

// ---- 桥接变量：由主程序调用 StoryBind() 注入（剧情函数仅在运行时使用它们） ----
var $, G, showCheatToast, playSound, dlog, aiSpeak, opponentName;
function StoryBind(api){
    $ = api.$; G = api.G; showCheatToast = api.showCheatToast; playSound = api.playSound;
    dlog = api.dlog; aiSpeak = api.aiSpeak; opponentName = api.opponentName;
}

// ========== 剧情聊天系统（选项分支 + 好感度 + 章节 + 多结局） ==========
// 好感度档位：≤-40宿敌 / -40~-10冷淡 / -10~25普通 / 25~60友好 / >60亲密
const CHAT_SAVE_KEY = 'bomb_chat_story';
// ========== 唯一女主：林溪瑶（傲娇青梅竹马）· 路线 / 好感 / 存档 ==========
// key 沿用 lili：兼容旧存档的默认路由与物语结局前缀
const HEROINES = {
    lili: { name:'林溪瑶', tag:'傲娇', emoji:'📕', color:'#ff9ec6', desc:'住你家隔壁的青梅竹马。嘴上不饶人，心里全是你', persona:'tsundere' }
};
// 女主 → 战斗人格 绑定（选谁就跟谁比，声音就是她本人）
const HERO_PERSONA = {};
Object.keys(HEROINES).forEach(function(k){ HERO_PERSONA[k] = HEROINES[k].persona; });
function blankRoute(){ return { aff:10, mood:70, chapters:{}, topics:{}, flags:{}, bet:null, lastTier:null, streak:0, heroName:null, heroAvatar:null }; }
function routeKeys(){ return ['aff','mood','chapters','topics','flags','bet','lastTier','streak','heroName','heroAvatar']; }
let chatSave = { aff:10, mood:70, chapters:{}, endings:{}, topics:{}, bet:null, lastTier:null, flags:{}, streak:0, heroName:null, heroAvatar:null, routes:null, active:'lili' };
try { const s = localStorage.getItem(CHAT_SAVE_KEY); if(s) chatSave = Object.assign(chatSave, JSON.parse(s)); } catch(e) {}
// 旧版单女主存档迁移：并入「林溪瑶」路线
if(!chatSave.routes){
    chatSave.routes = { lili: blankRoute() };
    routeKeys().forEach(function(k){ if(chatSave[k]!==undefined){ chatSave.routes.lili[k]=chatSave[k]; delete chatSave[k]; } });
    chatSave.active = 'lili';
}
function curHero(){ return chatSave.active || 'lili'; }
function heroDisplayName(){
    if(chatSave.heroName) return chatSave.heroName;
    const h = HEROINES[curHero()];
    return h ? h.name+'（'+h.tag+'）' : '她'; // 名字后面带括号性格
}
// chatSave 顶层字段始终是"当前路线的实时视图"：切换时写回旧路线、读入新路线，其余代码零改动
function loadRoute(id){
    if(!HEROINES[id] || id===curHero()) return;
    saveChat(); // 先把当前路线写回路由表
    chatSave.active = id;
    if(!chatSave.routes[id]) chatSave.routes[id] = blankRoute();
    routeKeys().forEach(function(k){ chatSave[k]=chatSave.routes[id][k]; });
    saveChat();
}
function saveChat(){
    if(chatSave.routes && chatSave.active && chatSave.routes[chatSave.active]){
        routeKeys().forEach(function(k){ chatSave.routes[chatSave.active][k]=chatSave[k]; });
    }
    try { localStorage.setItem(CHAT_SAVE_KEY, JSON.stringify(chatSave)); } catch(e) {}
}
function affTier(){
    const a = chatSave.aff;
    if(a<=-40) return { id:'nemesis', name:'💢 宿敌', color:'#ff5555' };
    if(a<=-10) return { id:'cold', name:'🧊 冷淡', color:'#7db4ff' };
    if(a<=25) return { id:'normal', name:'🙂 普通', color:'#cccccc' };
    if(a<=60) return { id:'warm', name:'😊 友好', color:'#7dffbe' };
    return { id:'close', name:'💞 亲密', color:'#ff9ec6' };
}
function addAff(n){
    chatSave.aff = Math.max(-100, Math.min(100, chatSave.aff + n));
    if(chatSave.mood===undefined) chatSave.mood=70;
    chatSave.mood = Math.max(0, Math.min(100, chatSave.mood + Math.round(n/2)));
    saveChat();
    renderAffBar();
}
// ========== 心情值系统：0-100，随互动/胜负波动，实时显示 ==========
function moodTier(){
    const m = (chatSave.mood===undefined?70:chatSave.mood);
    if(m>=85) return { id:'love', name:'💕 心动', color:'#ff9ec6' };
    if(m>=65) return { id:'happy', name:'😊 开心', color:'#7dffbe' };
    if(m>=45) return { id:'calm', name:'🙂 平静', color:'#cccccc' };
    if(m>=25) return { id:'down', name:'😒 郁闷', color:'#7db4ff' };
    return { id:'angry', name:'💢 闹别扭', color:'#ff5555' };
}
function addMood(n){
    if(chatSave.mood===undefined) chatSave.mood=70;
    chatSave.mood = Math.max(0, Math.min(100, chatSave.mood + n));
    saveChat();
    renderAffBar();
}
function renderAffBar(){
    const el = $('ai-chat-affinity');
    if(!el) return;
    const t = affTier();
    const mt = moodTier();
    const pct = (chatSave.aff + 100) / 2; // -100~100 → 0~100
    const endingCount = Object.keys(chatSave.endings).length;
    el.innerHTML = '好感度 <b style="color:'+t.color+'">'+chatSave.aff+'</b>（'+t.name+'） · 心情 <b style="color:'+mt.color+'">'+mt.name+'</b> · 结局图鉴 <b>'+endingCount+'</b>/'+CHAT_ENDINGS.length
        + '<div class="aff-bar"><div class="aff-fill" style="width:'+pct+'%"></div></div>';
    if(typeof updateHeroName==='function') updateHeroName();
}

// ---------- 剧情节点树 ----------
// 节点：{ ai:'AI台词', options:[{t:'选项', aff:±n, next:'节点', chapter:'章节id', end:true}] }
const CHAT_NODES = {
    // ===== 入口（按好感度分流） =====
    g_nemesis: { ai:['#她抱着手臂瞪你，眼神却没那么凶。','哼，是你。','有事快说。','别耽误我写作业。'],
        options:[
            {t:'还在为上次生气？', aff:+3, next:'c_makeup'},
            {t:'来看看你输不起的样子', aff:-6, next:'e_fight'},
            {t:'没事了，打扰了', aff:0, end:true},
        ]},
    g_cold: { ai:['#她抬眼扫了你一下，又低头转笔。','哦，是你啊。','……怎么，输怕了，来求饶？'],
        options:[
            {t:'谁输了！就是来聊聊', aff:+2, next:'t_casual'},
            {t:'今天一定赢你', aff:-2, next:'e_fight'},
            {t:'你猜拳…哦不，猜数为什么这么强？', aff:+3, next:'t1_strong'},
        ]},
    g_normal: { ai:['#她裹着灰色毛衣，似乎等了你有一会儿了。','（瞄了你一眼又移开）……哟，来了啊。','打赌之余……聊两句也不是不行。'],
        options:[
            {t:'你为什么这么会猜？', aff:+3, next:'t1_strong'},
            {t:'随便聊聊呗', aff:+1, next:'t_casual'},
            {t:'少套近乎，开打！', aff:-4, next:'e_fight'},
        ]},
    g_warm: { ai:['#你刚到，她就抬起了头，又慌忙装作不在意。','来、来啦。','刚才那局……我才没有一直在想。','坐吧。今天想聊什么？'],
        options:[
            {t:'你一个人的时候都干嘛？', aff:+4, next:'t2_alone'},
            {t:'聊聊小时候的事？', aff:+4, next:'t3_birth'},
            {t:'研究下怎么赢你', aff:+1, next:'t_strategy'},
        ]},
    g_close: { ai:['#她好像一直在这里等你。看到你的一瞬间，眼睛亮了一下。','等你好久了……才、才没有！','和你聊天，比赢你还有意思……一点点。','今天……想听什么？'],
        options:[
            {t:'我们算朋友吗？', aff:+5, next:'t4_friend'},
            {t:'告诉我一个你的秘密', aff:+4, next:'t5_secret'},
            {t:'来局痛快点的！', aff:+1, next:'t_strategy'},
        ]},
    // ===== 第一章：初识（你为什么这么强） =====
    t1_strong: { ai:'强？我只是不凭感觉，只信概率。那你呢——靠直觉，还是靠计算？',
        options:[
            {t:'直觉！直觉流天下第一', aff:+2, next:'t1a', chapter:'c1'},
            {t:'当然计算，和你一样', aff:+5, next:'t1b', chapter:'c1'},
            {t:'我全靠运气', aff:+1, next:'t1c', chapter:'c1'},
        ]},
    t1a: { ai:'直觉流……上次有人靠直觉赢我两局，我复盘了一整夜。行吧，我尊重每一种流派。',
        options:[{t:'（这家伙还挺可爱）', aff:+2, next:'hub'}]},
    t1b: { ai:'知音啊。那下次对局，我们用真本事堂堂正正碰一碰——输的人请喝奶茶。',
        options:[{t:'成交！', aff:+3, next:'hub'}]},
    t1c: { ai:'"运气也是实力的一部分"——这话可是我说的。你能用它赢我，也算本事。',
        options:[{t:'继续', aff:+1, next:'hub'}]},
    // ===== 日常话题池（轮换不重复，一轮聊完自动重置） =====
    // 't_casual' 由 chatGoto 特殊处理：从未聊过的话题里随机抽，全部聊完重置下一轮
    ct1: { ai:'你说，奶茶全糖去冰和半糖正常冰，哪个更优？我想了三遍，结论是——你请的那杯最优。',
        options:[
            {t:'下次一定请', aff:+3, reply:'记下了。违约的话……利息按天算，用陪我下棋抵。'},
            {t:'想得美，自己买', aff:+1, reply:'哼，小气鬼。……那就各买各的，第二杯半价，拼单。不是想和你一起喝哦，是省钱。' },
        ]},
    ct2: { ai:'昨晚我做了个梦……你猜我梦见什么了？……猜错的话，罚你明天给我带豆浆。',
        options:[
            {t:'梦见赢我一万局？', aff:+2, reply:'错。梦见你终于赢了我一万局。……那样，你应该会很开心吧。' },
            {t:'梦见我？', aff:+4, reply:'……你怎么知道。驳回，下一个问题。' },
        ]},
    ct3: { ai:'我妈今天又做了红烧肉。……你吃不吃。不来拉倒。……七点之前到，晚了你连汤都别想。',
        options:[
            {t:'到！准时到！', aff:+4, reply:'……哦。那我跟妈说一声，多焖一点。……才不是特意为你做的，是正好做多了。' },
            {t:'今天有事，下次吧', aff:+1, reply:'……哦。那我把你这碗也吃掉。胖死算了。……下次，不许下次了。' },
        ]},
    ct4: { ai:'考你一道题：1到100里，我最喜欢哪个数字？提示：和你有关。',
        options:[
            {t:'我的生日？', aff:+4, reply:'接近了。是你第一次赢我那局的炸弹数。我记到今天。' },
            {t:'100？满分？', aff:+2, reply:'不对哦。是你第一次赢我那局的炸弹数。——你早忘了？没事，我替你记着。' },
        ]},
    ct5: { ai:'给我讲个冷笑话吧。……先说好，不好笑你就死定了。网上抄的不算，我听过的也不算。',
        options:[
            {t:'为什么书总生气？因为它有很多"页"（脾气）', aff:+3, reply:'……（安静五秒）噗。扣分项：谐音梗。加分项：是你讲的。总分：满分。……才、才没有笑！' },
            {t:'我不会讲笑话', aff:+1, reply:'没关系。你认真猜数的样子就已经很好笑了——夸你的，听不出来吗。' },
        ]},
    ct6: { ai:'你说，猫到底哪里可爱？楼下那只橘猫，每次见我都蹭过来……我、我才没有每天去喂它。',
        options:[
            {t:'软、暖、会呼噜呼噜', aff:+3, reply:'软、暖、会呼噜……那、那我要是猫，你会想摸吗？……当我没问！' },
            {t:'可爱无法量化', aff:+2, reply:'无法量化？那"可爱"就和"喜欢"一样，没法讲道理。……记下来。' },
        ]},
    ct7: { ai:'下下周我生日。……就、就是随口一提！你才不要准备什么！……你敢忘试试。',
        options:[
            {t:'懂了，到时候给你庆祝', aff:+4, reply:'期、期待什么的我才没有。礼物免了，你人来就行。……最好再带杯奶茶，全糖去冰。' },
            {t:'不懂（装傻）', aff:+1, reply:'装，接着装。你每次装傻，右边眉毛都会跳一下。……骗你的。大概。' },
        ]},
    ct8: { ai:'除了猜数，你还玩什么游戏？说一个，我今晚就偷偷练到满级，然后虐你。',
        options:[
            {t:'石头剪刀布，来？', aff:+2, reply:'来！我出石头。……说出来了？这叫"公开威慑"，反正你会输。' },
            {t:'你猜我猜不告诉你', aff:+3, reply:'套娃禁止！……哼，不说算了。反正你在哪，我就在哪虐你。' },
        ]},
    ct9: { ai:'我在天台拍了片云，设成了头像。……你要是看到特别好看的云，拍下来发我。……不是想要你的消息哦，是收集素材。',
        options:[
            {t:'现在就拍给你', aff:+5, reply:['！！','……等、等一下，我头发还没梳。','……云而已，不用管我！','……（三分钟后）好了，发吧。'] },
            {t:'你自己不会看啊', aff:+1, reply:'看了啊。但是一个人看，有什么意思。……当我没说！' },
        ]},
    ct10: { ai:'如果以后我们去了不同的城市，最后一局猜数，你想和谁下？……这题连我都会。你呢？',
        options:[
            {t:'当然是你', aff:+5, reply:'嗯，标准答案。那说好了——最后一局，不许放水，陪我打到最后一滴血。' },
            {t:'不知道', aff:+1, reply:'不知道？那我告诉你答案：是你。……记好了，这是重点，要考的。' },
        ]},
    // ===== 第二章：独处（好感≥10解锁） =====
    t2_alone: { ai:['一个人的时候？','……写作业。听歌。在阳台上发呆。','有时候翻到小时候的照片，看着看着……','就想起某个笨蛋了。','……不是说你！'],
        options:[
            {t:'以后我常来陪你', aff:+7, next:'t2a', chapter:'c2'},
            {t:'想这些有什么意思', aff:-3, next:'t2b'},
        ]},
    t2a: { ai:'说定了。你要是敢放我鸽子，我就……就把炸弹全换成你永远猜不到的数！',
        options:[{t:'好好好，一定来', aff:+3, next:'hub'}]},
    t2b: { ai:'……等你一个人待久了，就懂了。算了，下棋吧。',
        options:[{t:'继续', aff:0, next:'hub'}]},
    // ===== 第三章：小时候（好感≥25解锁） =====
    t3_birth: { ai:['小时候的事？','哼，你不提我都快忘了。','三岁那年，你在我家抢走了最后一块红烧肉。','从那天起我就决定了——','这辈子，绝不能输给你。'],
        options:[
            {t:'就为一块肉记到现在？！', aff:+3, next:'t3a', chapter:'c3'},
            {t:'那现在还你一块？', aff:+5, next:'t3b', chapter:'c3'},
        ]},
    t3a: { ai:'那不是肉的问题！是尊严的问题！……而且那块是最大的一块。……你笑得这么开心干嘛，再笑，明天没你的份。',
        options:[{t:'好好好，不笑了', aff:+3, next:'hub'}]},
    t3b: { ai:['……现在知道还了？晚了。利息都滚了十几年了。','……不过，看在你有这份心的份上。','明天来我家，我妈做的，比你抢的那块好吃一百倍。'],
        options:[{t:'（脸有点热）', aff:+4, next:'hub'}]},
    // ===== 第四章：朋友（好感≥45解锁） =====
    t4_friend: { ai:['朋友？','我们三岁就认识，抢过同一碗红烧肉，抄过同一份作业。','按这个标准……','你，早就是了。','……这种问题，以后不许再问。'],
        options:[
            {t:'以后多多指教，朋友', aff:+9, next:'t4a', chapter:'c4'},
            {t:'朋友也要分出胜负！', aff:+4, next:'t4b', chapter:'c4'},
        ]},
    t4a: { ai:'多多指教。作为朋友的见面礼——下局我放水0.5%。不能再多了，再多我的尊严会报警。',
        options:[{t:'哈哈哈好', aff:+3, next:'hub'}]},
    t4b: { ai:'当然！正因为是朋友，才更要全力以赴。输给我可别哭鼻子。',
        options:[{t:'谁哭还不一定呢', aff:+2, next:'hub'}]},
    // ===== 第五章：秘密（好感≥65解锁） =====
    t5_secret: { ai:['秘密……好吧。','其实我有一本日记。','里面写的……全是某个笨蛋的事。','别告诉别人——','不然我"高冷学姐"的形象就崩了。'],
        options:[
            {t:'放心，嘴严得很', aff:+9, next:'t5a', chapter:'c5'},
            {t:'哈哈哈形象崩得稀碎', aff:+5, next:'t5b', chapter:'c5'},
        ]},
    t5a: { ai:'嗯。这个秘密，就是我们友情的见证。……不过下次对局，我还是会全力赢你的。别误会！',
        options:[{t:'求之不得', aff:+3, next:'hub'}]},
    t5b: { ai:'喂！说好的嘴严呢！……算了。是你的话，知道也没关系。',
        options:[{t:'继续', aff:+3, next:'hub'}]},
    // ===== 敌对线 =====
    e_fight: { ai:'呵，挑衅我？你知道上一个挑衅我的人怎么样了吗？……他赢了我一局，我记到现在。',
        options:[
            {t:'那我今天要赢两局', aff:-4, next:'e2'},
            {t:'开玩笑的，别当真', aff:+5, next:'c_makeup'},
        ]},
    e2: { ai:'两局？口气不小。这样吧——敢不敢立个赌约？',
        options:[
            {t:'什么赌约？', aff:0, next:'e3'},
            {t:'不敢，告辞', aff:+2, end:true},
        ]},
    e3: { ai:'赌约：下次你赢我，我叫你一声"老师"；你输了，就承认我是数字炸弹女王。敢吗？',
        options:[
            {t:'成交！', aff:-2, next:'e3a', chapter:'e_bet'},
            {t:'幼稚', aff:-6, next:'e3b'},
        ]},
    e3a: { ai:'很好。我会让你输得心服口服。别躲，我等你。',
        options:[{t:'谁怕谁', aff:0, next:'hub'}]},
    e3b: { ai:'幼稚？哼，我看是不敢吧。胆、小、鬼。',
        options:[{t:'你说谁是胆小鬼！', aff:-3, next:'hub'}]},
    c_makeup: { ai:'……哼，看在你态度还行的份上，上次的事就算了。下棋归下棋，别往心里去。',
        options:[
            {t:'嗯，下棋归下棋', aff:+3, next:'hub'},
            {t:'其实你人还不错', aff:+6, next:'hub'},
        ]},
    t_strategy: { ai:'想赢我？教你一手：别总猜中点——因为我猜你一定会猜中点。……听懂掌声。',
        options:[
            {t:'受教了', aff:+3, next:'hub'},
            {t:'这是在骗我吧？', aff:+1, next:'hub'},
        ]},
    // ===== 第六章：她的爱好（好感≥15解锁） =====
    t6_hobby: { ai:'猜数之外的爱好？我喜欢观察你。别、别误会——是观察你的猜数习惯！……好吧，也不全是。',
        options:[
            {t:'观察出什么了？', aff:+3, chapter:'c6', reply:'你连赢三局之后，会不自觉摸一下鼻子；紧张的时候，出手会变慢半拍。……要听完整的吗？我日记里写了整整137条。'},
            {t:'噫，好可怕（笑）', aff:+1, chapter:'c6', reply:'可怕吗？那我说点不可怕的——我还数过你每局平均犹豫七次才出手。……这也没好到哪去？哦。'},
        ]},
    // ===== 第七章：她的梦想（好感≥35解锁） =====
    t7_dream: { ai:['梦想？','如果"想一直这样下去"也算梦想的话——','我想看着你从新手，变成能赢过所有人的高手。','……然后，只输给我一个人。'],
        options:[
            {t:'后半句是多余的吧！', aff:+4, next:'t7a', chapter:'c7'},
            {t:'一言为定，陪你练到那天', aff:+7, next:'t7b', chapter:'c7'},
        ]},
    t7a: { ai:'不多余。这叫"既希望你赢遍天下，又想独占你的败北"——你说，这叫什么来着？',
        options:[
            {t:'叫"喜欢"吧（直球）', aff:+6, reply:['！！','……你、你不许趁乱说这种词。','脸好烫……都怪你。','……但，我记下了。写在最重要的一页。']},
            {t:'叫"傲娇"（也是直球）', aff:+5, reply:'傲、傲娇是什么？我只是在陈述战术目标！……你的笑声，我记仇了。'},
        ]},
    t7b: { ai:'嗯，一言为定。拉钩。……拉钩上吊，一百年，不许变。谁变谁是小狗。',
        options:[{t:'（她的声音好认真）', aff:+4, reply:'一直都很认真。从你说"再来一局"的那天起。'}]},
    // ===== 第八章：战术夜话（好感≥50解锁） =====
    t8_weak: { ai:'你的弱点？真要说？……领先的时候容易浪，落后的时候容易急。还有——我一撒娇你就放水。最后这条，我打算长期使用。',
        options:[
            {t:'？？？你什么时候撒娇过', aff:+4, next:'t8a', chapter:'c8'},
            {t:'好家伙，被你研究透了', aff:+5, chapter:'c8', reply:'彼此彼此，你不是也在研究我吗？被你在意的感觉……不、不赖嘛。'},
        ]},
    t8a: { ai:'上次你说"让一局吧"，我回了个"哼"。那个"哼"，尾音软了半拍。按书上的说法——那就是撒娇。',
        options:[
            {t:'这分析没救了（笑）', aff:+3, reply:'没救就没救。反正对你，我也不打算改。'},
            {t:'那以后多撒点', aff:+6, reply:'得、得寸进尺！……看我心情。心情好的定义：你来的时候。'},
        ]},
    // ===== 第九章：星空（好感≥70解锁） =====
    t9_star: { ai:['今晚天台的星星特别多。','我一个人看了一会儿，忽然觉得……','……你要不要，上来陪我看一会儿？','就一会儿。'],
        options:[
            {t:'（陪她安静地看了一会儿）', aff:+8, next:'t9a', chapter:'c9'},
            {t:'下次我带相机，拍星空给你', aff:+6, chapter:'c9', set:{k:'promisePhoto',v:1}, reply:'说好了！敢忘的话，我就每天早上去你家门口堵你。……开玩笑的。大概。'},
        ]},
    t9a: { ai:['谢谢。','其实星星哪里都有，但身边的人不是。','……今晚的星星，真好看。'],
        options:[{t:'（心跳漏了一拍）', aff:+5, reply:'漏的那一拍，我替你记下了。以后每年的今晚，都来陪我看星星，好吗？'}]},
    // ===== 第十章：吃醋（好感≥75解锁） =====
    t10_jealous: { ai:['问个问题。','你最近……是不是还跟隔壁班那个谁下棋了？','别紧张，我就是随便问问。','只是你的出手习惯里，混进了不是我的风格。'],
        options:[
            {t:'冤枉！我只跟你下', aff:+8, chapter:'c10', reply:'……哦。那就好。（她低头翻了一页书，嘴角压不住）没什么，就是忽然心情很好。别问为什么。'},
            {t:'呃……就下了一两局', aff:+2, next:'t10b', chapter:'c10'},
        ]},
    t10b: { ai:'一两局啊。……没事，挺好的，多见识见识。反正最后你会回来——这点信心，我还是有的。哼。',
        options:[
            {t:'回来了回来了', aff:+5, reply:'回来就好。……下次走之前，记得说一声。我会……算了，没什么。'},
            {t:'你这是吃醋了？', aff:+6, reply:'吃醋？我会吃那种东西？……（安静了三秒）……下次，不许太久不回来。'},
        ]},
    // ===== 第十一章：告白前夜（好感≥85解锁） =====
    t11_eve: { ai:['明天……不，等你下次来的时候。','我有句话想对你说。','现在还不行——光是想着，心跳就快得不行。','现在说出口，我一定会咬到舌头。'],
        options:[
            {t:'什么话？现在就说嘛', aff:+3, next:'t11a', chapter:'c11'},
            {t:'好，我明天准时来', aff:+6, chapter:'c11', reply:'嗯。我把那句话写在日记本最后一页了，谁也不许看。明天见。……今天也，最喜欢和你下棋了。'},
        ]},
    t11a: { ai:'不行。重要的话，要在最重要的时刻说。这是我妈说的。……期待一下吧，就一下下。',
        options:[{t:'（开始期待了）', aff:+4, reply:'不许偷笑。……其实我自己，也很期待。'}]},
    // ===== 第十二章：告白（好感≥90且通关前夜） =====
    t12_confess: { ai:['来了？','那……我要说了。','（她深吸了一口气）','我认识你十几年，算得清你每一步棋。','只有一件事算不清：','为什么每次你说"来了"，我的心跳就会乱掉一拍。','……后来我才明白。','那大概，就是喜欢吧。','……其实，我比你先喜欢上的。早到，你还没发觉的时候。'],
        options:[
            {t:'我也是，喜欢你', aff:+15, next:'t12a', chapter:'c12'},
            {t:'（伸手摸摸她的头）', aff:+12, next:'t12b', chapter:'c12'},
        ]},
    t12a: { ai:['！！！','……（她眼眶一下子红了）','再、再说一遍？我要记在今天这页日记上，一个字都不许改。','……说定了哦——','以后的每一局，都是我们的约会。'],
        options:[{t:'每一局都是约会', aff:+8, reply:'嗯，约会。我赢，是你让我；你赢，是我宠你。怎么算，都是我们赢。'}]},
    t12b: { ai:'（她僵了一下，却没有躲开）……手，很暖。作为回礼：以后你的每一场败北，我都承包了。只准输给我。',
        options:[{t:'霸道（笑）', aff:+6, reply:'只对你霸道。这是VIP待遇，全球限量，仅此一份。'}]},
    // ===== 赌约后续（宿敌线分支） =====
    e4: { ai:'当然作数。我每天都在等你兑现——别告诉我你忘了。忘了，就当你认输。',
        options:[
            {t:'没忘，等着瞧', aff:-2, reply:'很好。我会把胜利和"最强"的称号，一起保管到那天。'},
            {t:'要不……算了？', aff:+4, reply:'算了？呵，怂了？……不过，愿意低头的你也不讨厌。赌约保留，随时生效。'},
        ]},
    e5: { ai:'老、老师……就一声！多了没有！……不过说真的，那一局，你下得漂亮。我心服口服。',
        options:[
            {t:'乖', aff:+4, chapter:'e_sensei', reply:'别得意！明天我就赢回来，到时候换你叫我。……但今天，谢谢你认真跟我下。'},
            {t:'哈哈，再来一声', aff:+1, chapter:'e_sensei', reply:'得寸进尺！没有了！……（超小声）老师。……好了两声了，闭嘴！'},
        ]},
    e6: { ai:'算你识相。……不过，"最强"这种头衔听多了，也挺寂寞的。下次，赢回去试试看？我……有点想看你全力以赴的样子。',
        options:[
            {t:'一定赢回来', aff:+8, chapter:'e_redeem', reply:'嗯，等你。宿敌这种关系……其实也不坏。至少，你永远不会放我鸽子。'},
            {t:'你这是在鼓励我？', aff:+6, chapter:'e_redeem', reply:'才、才不是鼓励！是战术投资！你变强了，我赢你才有价值！……就是这样。'},
        ]},
    // ===== 后日谈·第一章：约会（好感≥92，需通关告白） =====
    d1_date: { ai:['（她难得地沉默了几秒）','……约会。','我们约会吧。','就、就是普通的一起出门！','……但和你，去哪里都好。'],
        options:[
            {t:'看场电影吧', aff:+8, next:'d1a', chapter:'d1'},
            {t:'去河边散步', aff:+8, next:'d1b', chapter:'d1'},
        ]},
    d1a: { ai:'（散场灯亮的时候，她还没从结局里出来）……主角最后说"我会一直在"。这句台词我收下了——以后，换我说给你听。',
        options:[{t:'我会一直在', aff:+6, reply:'嗯。这是今天约会里，我最喜欢的台词。……写进日记，画上重点，谁也不许改。'}]},
    d1b: { ai:'（你们沿着河走了很久。晚霞、便利店、还有一只路过的猫）……原来慢慢走路，也这么有意思。下次散步，记得还叫上我。',
        options:[{t:'每次都叫你', aff:+6, reply:'拉钩。……这次我真的伸手了。拉钩上吊，一百年，不许变。'}]},
    // ===== 后日谈·第二章：她的信（好感≥94） =====
    d2_song: { ai:['（她塞给你一封信，别过脸去）','……回去再看！现在不许拆！','里面的话，我写了三个晚上。','标题还没起——','你说，叫什么好？'],
        options:[
            {t:'《再来一局》', aff:+8, chapter:'d2', reply:'《再来一局》……好俗。但是是你起的，那就是世界上最好的标题。……那封信，你要收好。一辈子。'},
            {t:'《给最喜欢的你》', aff:+8, chapter:'d2', reply:'给、给最喜欢的你……！！你、你怎么知道我是怎么想的……讨厌，太犯规了。'},
        ]},
    // ===== 后日谈·第三章：吵架与和好（好感≥96） =====
    d3_fight: { ai:['……你最近，是不是太忙了？','我的日记显示，你上次来是"很久以前"。','我没有生气。','我只是把每一天，都数了一遍。'],
        options:[
            {t:'对不起，以后常来', aff:+9, chapter:'d3', reply:'……嗯。原谅你了。下次再敢消失，我就……就把"想你"两个字写满整本日记。'},
            {t:'你数这个干嘛，笨蛋', aff:+6, chapter:'d3', reply:'因为数着数着，你就会来了啊。……你看，这不是来了吗。笨蛋。'},
        ]},
    // ===== 后日谈·第四章：纪念日（好感≥98） =====
    d4_anniv: { ai:'知道今天是什么日子吗？我们第一次对局的纪念日。那天的炸弹是42——我故意没拆穿你猜了三次才中。……从那天起，你就是我的日常。',
        options:[
            {t:'原来你一直在放水？！', aff:+6, chapter:'d4', reply:'才、才不是放水！是"新手保护"！……好吧，是放水。只对你。'},
            {t:'以后每个纪念日都陪你', aff:+9, chapter:'d4', reply:'说定了。每一个，都不许缺。……我会把日历画满圈，一年365个纪念日。'},
        ]},
    // ===== 后日谈·终章：永远（好感≥100） =====
    d5_forever: { ai:['我想通了。','我们会长大，会去不同的城市，会有各自的生活。','但"再来一局"这四个字——','只要你还愿意说，我就永远接。','……所以，答应我：一直说下去，好吗？'],
        options:[
            {t:'答应你，一直说下去', aff:+15, next:'d5a', chapter:'d5'},
            {t:'不仅说下去，还要带着你赢', aff:+12, next:'d5b', chapter:'d5'},
        ]},
    d5a: { ai:['（她伸出手，勾住了你的小指）','……拉钩成立。','期限：永久。','违约条款：不许有。','——我爱你。','这次，不用小声。'],
        options:[{t:'我也爱你', aff:+10, reply:'嗯。那，第1000001局——开始吧，亲爱的。'}]},
    d5b: { ai:'带着我赢？……傻瓜，我什么时候需要你让。不过——一起赢，听起来是最好的结局。……我爱你，这是陈述句。',
        options:[{t:'一起赢下去', aff:+10, reply:'一起赢。赢到头发都白了，再在摇椅上继续。'}]},
    // ===== 宿敌线终章：不打不相识（好感≥0，需通关宿敌的真心） =====
    e7_buddy: { ai:['从互相放狠话，到现在能坐下聊天……','话说，这个叫什么来着？','哦对，"不打不相识"。','……喂，以后也常来。','宿敌的席位，给你永久保留了。'],
        options:[
            {t:'宿敌兼挚友，成交', aff:+10, chapter:'e7', reply:'成交。棋盘上我照样不会放水——这是对宿敌最大的敬意。……棋盘下嘛，随时来找我。'},
            {t:'你其实挺可爱的', aff:+8, chapter:'e7', reply:'可、可爱？！我是你宿敌！……算了，宿敌也可以可爱。只许你这么说。'},
        ]},
    // ===== 命名节点（通关初识后解锁）：给她起一个专属昵称 =====
    n1_name: { ai:['对了……"林溪瑶"三个字，你叫起来不嫌长吗。','给我起一个专属的叫法吧？','只有你一个人能叫的那种。','……要好听一点的。'], naming:true },
    // ===== 互动游戏（常驻） =====
    rps: { ai:'猜拳！随时奉陪，输了不许耍赖。——出吧！', dynamic:'rps' },
    gift: { ai:'礼、礼物？给我的？！……咳。是什么，快拿出来看看。', dynamic:'gift' },
    // ===== 中转站 =====
    hub: { ai:'嗯哼，还想聊点什么？', dynamic:true },
};
const CASUAL_TOPIC_IDS = ['ct1','ct2','ct3','ct4','ct5','ct6','ct7','ct8','ct9','ct10'];
// ========== 女主专属剧情节点：仅一位女主，通用树即她的树，无需覆盖 ==========
const HERO_NODES = {};
const HERO_HUB = {};
// 亲密动作回应：单女主直接使用下方 TOUCH_REPLY 通用表
const TOUCH_REPLY_H = {};
// 首次送礼回应：单女主直接使用内置默认台词
const GIFT_FIRST_H = {};
// 默契问答回应（按女主分桶）
const QUIZ_REPLY_H = {
    lili: { ok:'答对了！……你果然有认真听我说话。（超小声）好开心。', no:'答错——哼，有人上课没听讲。罚你……罚你陪我多聊十分钟。立刻执行。' }
};
// 猜拳回应（按女主分桶）
const RPS_REPLY_H = {
    lili: { draw:'平手！默契过头了吧，再来！', win:'你、你赢？！……哼，这局让你的。', lose:'我赢！哈哈哈，读心术满级！' }
};
// 起名成功后的回应（按女主分桶）
const NAMING_REPLY_H = {
    lili: function(n){ return [n+'……'+n+'……','（她小声念了两遍，像在细细品味）','……嗯！从今天起，我就是'+n+'了。','只准你一个人这么叫。']; }
};
// ========== 调戏/调情/表白回应池（按战斗人格分桶，什么人格说什么话） ==========
const TEASE_OK_P = {
    tsundere:['你、你逗我玩呢吧！','笨蛋！……但、但是，还有点开心是怎么回事。','下、下次不许了！……也不许不。'],
    normal:['喂！你这家伙！','哈哈，胆子肥了啊！','……嘛，挺有趣的，原谅你！']
};
const TEASE_NG_P = {
    tsundere:['……现在没心情陪你闹。','#她别过脸。','……笨蛋，看气氛啊。','……但是，哄我两句，就原谅你。'],
    normal:['喂，今天别闹。','#她叹了口气，又勉强笑笑。','……抱歉，状态不好。','陪我安静地待会儿，行吗？']
};
const FLIRT_REPLY_P = {
    tsundere:['你、你说什么呢笨蛋！','#她的耳朵尖瞬间红透。','……再、再说一遍。','就一遍哦！……其实，几遍都行。'],
    normal:['喂喂，突然来这个！','#她脸红着捶了你一下。','……油嘴滑舌。','但是，嘿嘿。','……再多说点，我听着呢。']
};
const CONFESS_OK_P = {
    tsundere:['……！！','#她呆住了，眼泪一下子涌上来。','笨、笨蛋……你知道我等这句话，等了多久吗……','#她又哭又笑。','……听好了，我只说一遍——','我也是。从很久以前，就是。'],
    normal:['#她愣了两秒，猛地红了眼眶。','……你这家伙，居然抢先说。','#她笑着，眼泪却掉下来。','我也是啊。','早就，喜欢你了。','……这次，谁都不许跑。']
};
const CONFESS_WAIT_P = {
    tsundere:['……！','#她慌忙摆手，脸红透了。','太、太早了啦笨蛋！','……但是，我记下了。','等你再了解我一点……','那时候，我会认真回答的。','……所以，不许放弃哦。'],
    normal:['#她愣住，挠了挠头，脸红红的。','……喂，太突然了吧。','#她笑了。','不过，我收下了。','……再陪我走一段路。','走到我觉得"就是现在"的时候——','换我来追你。']
};
// ========== 她对你的性格初印象（按玩家性格分桶；每条路线首次深聊时触发一次） ==========
const PLAYER_VIBE_P = {
    normal:['#她上下打量你，忽然笑了。','你给人的感觉，好舒服。','像午后晒过的被子。','……和你待着，应该会很放松。'],
    tsundere:['#她瞄了你一眼，忽然笑出声。','你嘴上说着"随便玩玩"，眼睛却一直往这边瞟。','……傲娇这种东西。','我可是，行家。'],
    shy:['#她小声说。','你说话的声音，轻轻的……','和害羞的人说话，不会累呢。','……感觉，能懂你。'],
    timid:['#她看着你紧张的样子，反而安心了。','你也在发抖吗？','……那，我们扯平了。','谁也别笑话谁。'],
    kid:['#她眼睛一亮。','哇！你看起来就很好玩！','蹦蹦跳跳的，像个小太阳。','……以后，常来玩！'],
    chuuni:['#她端详你三秒，忽然肃然起敬。','这股气场……汝，也是被"选中"之人吗。','……同道中人。','坐。'],
    schemer:['#她眯起眼睛。','哎呀，你笑起来的样子，像在盘算什么。','……同类呢（笑）。','我们，谁也别骗谁哦。'],
    cold:['#她颔首。','……你的话很少。','很好。','安静的人，值得信任。'],
    hotblood:['#她被你的气势震了一下，随即大笑。','哈哈哈！你这家伙，气势不错！','……和你在一起，绝不会无聊！'],
    yandere:['#她盯着你看，忽然笑了。','你看我的眼神……好专注。','……我们，是同一种人呢。','呵呵。真好。'],
    ditz:['#她歪着头看你，你也歪着头看她。','……你刚刚，是不是也走神了？','嘿嘿，同类！','……同类是什么呀？'],
    oneesan:['#她温柔地笑了。','你说话的样子，很会照顾人呢。','……和你在一起，一定很安心。'],
    cat:['#她凑近嗅了嗅。','……你身上，有同类的味道。','慵懒又骄傲。','喵，勉强认可你了。'],
    gamer:['#她和你对视一眼，你俩异口同声。','"开一局？"','……嚯，同道中人！','这局，稳了。'],
    denpa:['#她的呆毛动了动。','哔——接收到同频信号。','你的电波……和我很像。','……宇宙安排的相遇吧。'],
    queen:['#她打量你，微微颔首。','哦？这股不卑不亢的气场。','……你也有王者之风。','准你，与强者平起平坐。']
};
// ========== 夸她 / 讲冷笑话 回应池（按她的人格分桶） ==========
const PRAISE_STORY_P = {
    tsundere:['#她别过脸，耳朵尖通红。','今、今天？只有今天可爱吗？！','……哼，勉强接受你的夸奖。','……再多说两句也可以哦。'],
    normal:['#她愣了一下，笑得眼睛弯弯。','哈哈，突然夸我干嘛！','……但是，好开心。','今天一天，都会元气满满了！']
};
const JOKE_OK_P = {
    tsundere:['#她安静了三秒，忽然"噗"地一声。','……噗哈哈哈，好冷！','#她慌忙捂住嘴。','才、才没有笑！……再讲一个啦。'],
    normal:['#她愣了一秒，爆笑出声。','哈哈哈哈什么鬼！','#她笑出眼泪。','……再来一个！我今天要听十个！']
};
// 默契问答题库：need=需聊过对应日常话题才会出题，考的都是她说过的话
const QUIZ_BANK = [
    { need:'ct1', q:'默契第一题：我最喜欢的奶茶口味是？', opts:[{t:'全糖去冰', ok:1},{t:'半糖正常冰', ok:0},{t:'无糖去冰', ok:0}] },
    { need:'ct7', q:'默契题：我的生日是什么时候？', opts:[{t:'下下周', ok:1},{t:'下个月', ok:0},{t:'你根本不过生日', ok:0}] },
    { need:'ct3', q:'默契题：我妈做红烧肉，我说要你几点到？', opts:[{t:'七点之前', ok:1},{t:'八点到', ok:0},{t:'随便什么时候', ok:0}] },
    { need:'ct4', q:'默契题：我最喜欢的数字，和什么有关？', opts:[{t:'我第一次赢她的那局', ok:1},{t:'她的学号', ok:0},{t:'圆周率', ok:0}] },
    { need:'ct2', q:'默契题：我说过，我梦见了什么？', opts:[{t:'我赢她一万局', ok:1},{t:'考试第一名', ok:0},{t:'无限奶茶', ok:0}] },
];
// 亲密动作回应：first=首次，close=友好以上，cold=普通及以下
const TOUCH_REPLY = {
    head: { first:['！！','你、你干什么……','（她的耳朵瞬间红透）','……再、再摸一下，也可以哦。'],
        close:['（她主动蹭了蹭你的手心）','嘿嘿……元气充满。','今天也能再战一百局。'],
        cold:['（她僵住了）','……突然干什么。','……但是，不许停。'] },
    hand: { first:['（她僵了一下，慢慢回握）','……据说牵手是36.5℃。','我的手可能有点凉……别放开。'],
        close:['握紧了哦。','敢丢下我跑掉，我就追到你家去。'],
        cold:['（指尖轻轻一颤）','……就一会儿。','下棋的手，别耽误了。'] },
    hug: { first:['（她的呼吸乱了一拍）','……这就是拥抱吗。','日记标题：今天，世界上最暖和的一天。'],
        close:['（她安静地靠在你怀里）','……再五秒。就五秒。','……好了，五秒乘以一万。'],
        cold:['（她没躲）','……下不为例。','……我是说，下次要提前申请。'] }
};
// hub 动态选项：按好感度解锁未完成章节（已完成的章节永不重复出现）
function hubOptions(){
    const a = chatSave.aff, done = chatSave.chapters;
    const opts = [];
    if(!done.c1) opts.push({t:'你为什么这么会猜？', next:'t1_strong'});
    if(!done.c2 && a>=10) opts.push({t:'你一个人的时候都干嘛？', next:'t2_alone'});
    if(!done.c6 && a>=15) opts.push({t:'除了猜数，你还有别的爱好吗？', next:'t6_hobby'});
    if(!done.c3 && a>=25) opts.push({t:'聊聊小时候的事？', next:'t3_birth'});
    if(!done.c7 && a>=35) opts.push({t:'你以后有什么梦想？', next:'t7_dream'});
    if(!done.c4 && a>=45) opts.push({t:'我们算朋友吗？', next:'t4_friend'});
    if(!done.c8 && a>=50) opts.push({t:'你觉得我最大的弱点是什么？', next:'t8_weak'});
    if(!done.c5 && a>=65) opts.push({t:'告诉我一个你的秘密', next:'t5_secret'});
    if(!done.c9 && a>=70) opts.push({t:'今晚有空吗？陪你待会儿', next:'t9_star'});
    if(!done.c10 && a>=75) opts.push({t:'（她好像有心事）怎么了？', next:'t10_jealous'});
    if(!done.c11 && a>=85) opts.push({t:'你上次说，有话想对我说？', next:'t11_eve'});
    if(!done.c12 && a>=90 && done.c11) opts.push({t:'（认真地看着她）我在听。', next:'t12_confess'});
    // ===== 赌约/宿敌终章 =====
    if(curHero()==='lili'){
        if(!done.e_bet && a<=-20) opts.push({t:'听说你立了个赌约？', next:'e2'});
        if(chatSave.bet==='pending') opts.push({t:'赌约还作数吗？', next:'e4'});
        if(chatSave.bet==='lost' && !done.e_sensei) opts.push({t:'再叫声老师听听？', next:'e5'});
        if(chatSave.bet==='won' && !done.e_redeem) opts.push({t:'好吧，你是数字炸弹女王', next:'e6'});
        if(done.e_redeem && !done.e7 && a>=0) opts.push({t:'从宿敌到现在，也挺不可思议的', next:'e7_buddy'});
    }
    // ===== 后日谈：告白通关后开放（恋爱才刚刚开始） =====
    if(done.c12 && !done.d1 && a>=92) opts.push({t:'（她欲言又止）……约会，可以吗？', next:'d1_date'});
    if(done.d1 && !done.d2 && a>=94) opts.push({t:'听说你写了封信？', next:'d2_song'});
    if(done.d2 && !done.d3 && a>=96) opts.push({t:'最近……是不是惹你不开心了？', next:'d3_fight'});
    if(done.d3 && !done.d4 && a>=98) opts.push({t:'今天好像是个特别的日子？', next:'d4_anniv'});
    if(done.d4 && !done.d5 && a>=100) opts.push({t:'我有话想对你说（认真）', next:'d5_forever'});
    // ===== 特别事件：随机剧情（海量支线，每次都可能是新故事） =====
    if(typeof nextEventId==='function'){ const evId = nextEventId(); if(evId) opts.unshift({t:'✨ 好像有什么事情要发生……', next:evId}); }
    // ===== 互动游戏与亲密动作（常驻） =====
    opts.push({t:'✊ 猜拳', next:'rps'});
    opts.push({t:'🎁 送她礼物', next:'gift'});
    if(Object.keys(chatSave.topics||{}).length>0) opts.push({t:'🧠 默契问答', next:'quiz'});
    if(a>=20) opts.push({t:'🌟 夸她今天很可爱', praiseHer:1});
    if(a>=20) opts.push({t:'😆 给她讲个冷笑话', joke:1});
    if(a>=30) opts.push({t:'😏 调戏她一下', tease:1});
    if(a>=50) opts.push({t:'💘 对她说调情话', flirt:1});
    if(a>=60 && !done.c12 && !(chatSave.flags||{}).playerConfessed) opts.push({t:'💍 认真向她表白', confess:1});
    if(a>=40) opts.push({t:'（摸摸她的头）', touch:'head'});
    if(a>=70) opts.push({t:'（牵起她的手）', touch:'hand'});
    if(a>=90) opts.push({t:'（轻轻抱住她）', touch:'hug'});
    opts.push({t:'随便聊聊', aff:+1, next:'t_casual'});
    opts.push({t:'今天就聊到这', end:true});
    // 未兑现的承诺置顶：她在等你拿出星空照片
    if((chatSave.flags||{}).promisePhoto) opts.unshift({t:'（她在等你兑现承诺）拿出星空照片', gift:'photo'});
    // 通关初识后：她期待你给她起个名字
    if(done.c1 && !chatSave.heroName) opts.unshift({t:'（她期待地看着你）给她起个专属昵称', next:'n1_name'});
    return opts;
}
// 回忆画廊：已通关章节可随时回放
const CHAPTER_GALLERY = [
    {id:'c1', name:'第一章·初识', node:'t1_strong'}, {id:'c2', name:'第二章·独处', node:'t2_alone'},
    {id:'c6', name:'第三章·爱好', node:'t6_hobby'}, {id:'c3', name:'第四章·小时候', node:'t3_birth'},
    {id:'c7', name:'第五章·梦想', node:'t7_dream'}, {id:'c4', name:'第六章·朋友', node:'t4_friend'},
    {id:'c8', name:'第七章·夜话', node:'t8_weak'}, {id:'c5', name:'第八章·秘密', node:'t5_secret'},
    {id:'c9', name:'第九章·星空', node:'t9_star'}, {id:'c10', name:'第十章·在意', node:'t10_jealous'},
    {id:'c11', name:'第十一章·前夜', node:'t11_eve'}, {id:'c12', name:'第十二章·告白', node:'t12_confess'},
    {id:'d1', name:'后日谈·约会', node:'d1_date'}, {id:'d2', name:'后日谈·她的信', node:'d2_song'},
    {id:'d3', name:'后日谈·吵架与和好', node:'d3_fight'}, {id:'d4', name:'后日谈·纪念日', node:'d4_anniv'},
    {id:'d5', name:'后日谈·永远', node:'d5_forever'}, {id:'e7', name:'宿敌线·不打不相识', node:'e7_buddy'}
];
function rpsOptions(){
    return [ {t:'✊ 石头', rps:0, next:'rps'}, {t:'✌️ 剪刀', rps:1, next:'rps'}, {t:'✋ 布', rps:2, next:'rps'}, {t:'不玩了', next:'hub'} ];
}
function giftOptions(){
    return [
        {t:'🧋 奶茶（全糖去冰）', gift:'tea'},
        {t:'🌌 星空照片', gift:'photo'},
        {t:'💣 炸弹玩偶', gift:'doll'},
        {t:'还是算了', next:'hub'}
    ];
}

// ---------- 结局图鉴 ----------
const CHAT_ENDINGS = [
    { id:'forever', name:'真结局·永远', desc:'与她许下永远的约定', cond:function(w){ return !!chatSave.chapters.d5; } },
    { id:'first_date', name:'第一次约会', desc:'完成一次云约会', cond:function(w){ return !!chatSave.chapters.d1; } },
    { id:'rival_buddy', name:'不打不相识', desc:'宿敌化友，席位永久保留', cond:function(w){ return !!chatSave.chapters.e7; } },
    { id:'quiz_master', name:'默契满分', desc:'默契问答全部答过', cond:function(w){ const f=chatSave.flags||{}; return ['ct1','ct2','ct3','ct4','ct7'].every(function(k){ return f['quiz_'+k]; }); } },
    { id:'rps_champ', name:'猜拳冠军', desc:'猜拳累计赢她5次', cond:function(w){ const f=chatSave.flags||{}; return (f.rpsW||0)>=5; } },
    { id:'gift_giver', name:'送礼达人', desc:'送过她三种礼物', cond:function(w){ const f=chatSave.flags||{}; return f.giftTea&&f.giftPhoto&&f.giftDoll; } },
    { id:'confession', name:'真结局·她的心意', desc:'听完她的告白并回应', cond:function(w){ return !!chatSave.chapters.c12; } },
    { id:'star_watcher', name:'一起看星星的人', desc:'陪她看过天台的星空', cond:function(w){ return !!chatSave.chapters.c9; } },
    { id:'sensei', name:'一声老师', desc:'赌约赢了她，被叫了老师', cond:function(w){ return chatSave.bet==='lost' || !!chatSave.chapters.e_sensei; } },
    { id:'redeem', name:'宿敌的真心', desc:'赌约输给她后，听她说出真心话', cond:function(w){ return !!chatSave.chapters.e_redeem; } },
    { id:'true_friend', name:'真结局·灵魂挚友', desc:'好感≥80并交换秘密', cond:function(w){ return chatSave.aff>=80 && chatSave.chapters.c5; } },
    { id:'secret_keep', name:'守秘人', desc:'交换过秘密', cond:function(w){ return !!chatSave.chapters.c5; } },
    { id:'best_rival', name:'亦敌亦友', desc:'好感≥60时对局', cond:function(w){ return chatSave.aff>=60; } },
    { id:'sweet_win', name:'被你打服的她', desc:'好感≥40时赢她', cond:function(w){ return chatSave.aff>=40 && w==='p1'; } },
    { id:'gentle_loss', name:'温柔的败北', desc:'好感≥40时输给她', cond:function(w){ return chatSave.aff>=40 && w==='p2'; } },
    { id:'nemesis_bet', name:'一生之敌·赌约', desc:'立过赌约且好感≤-40', cond:function(w){ return chatSave.aff<=-40 && chatSave.chapters.e_bet; } },
    { id:'revenge', name:'复仇成功', desc:'好感≤-20时赢她', cond:function(w){ return chatSave.aff<=-20 && w==='p1'; } },
    { id:'crushed', name:'冷酷处刑', desc:'好感≤-20时输给她', cond:function(w){ return chatSave.aff<=-20 && w==='p2'; } },
    { id:'acquaintance', name:'点头之交', desc:'聊过天但交情尚浅', cond:function(w){ return Object.keys(chatSave.chapters).length>0; } },
    // ===== 互动成就结局 =====
    { id:'naming_done', name:'冠名之人', desc:'为她起过名字', cond:function(w){ return !!chatSave.heroName; } },
    { id:'touch_head_e', name:'摸头杀', desc:'摸过她的头', cond:function(w){ const f=chatSave.flags||{}; return !!f.touch_head; } },
    { id:'touch_hand_e', name:'第一次牵手', desc:'牵过她的手', cond:function(w){ const f=chatSave.flags||{}; return !!f.touch_hand; } },
    { id:'touch_hug_e', name:'拥抱的温度', desc:'抱过她', cond:function(w){ const f=chatSave.flags||{}; return !!f.touch_hug; } },
    { id:'promise_kept', name:'兑现承诺的人', desc:'答应带星空照片，并且真的带了', cond:function(w){ const f=chatSave.flags||{}; return f.promisePhoto&&f.giftPhoto; } },
    { id:'rps_legend', name:'猜拳传说', desc:'猜拳累计赢她10次', cond:function(w){ const f=chatSave.flags||{}; return (f.rpsW||0)>=10; } },
    { id:'all_topics', name:'无话不谈', desc:'十个日常话题全部聊过', cond:function(w){ const t=chatSave.topics||{}; return ['ct1','ct2','ct3','ct4','ct5','ct6','ct7','ct8','ct9','ct10'].every(function(k){return t[k];}); } },
    { id:'love_12', name:'十二页的恋爱', desc:'通关全部十二章主线', cond:function(w){ const d=chatSave.chapters; return ['c1','c2','c6','c3','c7','c4','c8','c5','c9','c10','c11','c12'].every(function(k){return d[k];}); } },
    { id:'aff_max', name:'心意满格', desc:'好感度达到100', cond:function(w){ return chatSave.aff>=100; } },
    // ===== 四季与事件结局 =====
    { id:'ev_spring_e', name:'春·樱花树下', desc:'和她一起赏过樱花', cond:function(w){ return !!chatSave.chapters.ev_spring; } },
    { id:'ev_summer_e', name:'夏·花火之下', desc:'和她一起看过夏日花火', cond:function(w){ return !!chatSave.chapters.ev_summer; } },
    { id:'ev_autumn_e', name:'秋·学园祭的回忆', desc:'和她一起逛过学园祭', cond:function(w){ return !!chatSave.chapters.ev_autumn; } },
    { id:'ev_winter_e', name:'冬·暖炉边的悄悄话', desc:'和她一起度过冬日', cond:function(w){ return !!chatSave.chapters.ev_winter; } },
    { id:'season_all', name:'四季与你', desc:'春夏秋冬，四季都有她', cond:function(w){ const d=chatSave.chapters; return d.ev_spring&&d.ev_summer&&d.ev_autumn&&d.ev_winter; } },
    { id:'ev_rain_e', name:'雨中共伞', desc:'雨天和她躲在同一片屋檐下', cond:function(w){ return !!chatSave.chapters.ev_rain; } },
    { id:'ev_sick_e', name:'病中守护', desc:'她"生病"时去探望过她', cond:function(w){ return !!chatSave.chapters.ev_sick; } },
    { id:'ev_scary_e', name:'试胆同伴', desc:'陪她通过试胆大会', cond:function(w){ return !!chatSave.chapters.ev_scary; } },
    { id:'ev_letter_e', name:'她的信', desc:'收到她写的第一封信', cond:function(w){ return !!chatSave.chapters.ev_letter; } },
    { id:'ev_birthday_e', name:'为她庆生', desc:'陪她过过生日', cond:function(w){ return !!chatSave.chapters.ev_birthday; } },
    { id:'ev_100_e', name:'百战搭档', desc:'与她累计对局100次', cond:function(w){ const s=loadStats(); return (s.wins+s.losses)>=100; } },
    { id:'ev_500_e', name:'传说级搭档', desc:'与她累计对局500次', cond:function(w){ const s=loadStats(); return (s.wins+s.losses)>=500; } },
    // ===== 第二波结局：新事件与分支选择（选不同的路，解锁不同的结局） =====
    { id:'ev_meme_e', name:'对暗号的人', desc:'和她对上过热梗暗号', cond:function(w){ return !!chatSave.chapters.ev_meme; } },
    { id:'meme_master', name:'梗王认证', desc:'反向输出梗，被她封为梗搭子', cond:function(w){ const f=chatSave.flags||{}; return !!f.memeReverse; } },
    { id:'ev_abstract_e', name:'抽象艺术家', desc:'和她玩过抽象文学', cond:function(w){ return !!chatSave.chapters.ev_abstract; } },
    { id:'abstract_god', name:'抽象宗师', desc:'用"道可道非常道"震住全场', cond:function(w){ const f=chatSave.flags||{}; return !!f.abstractMaster; } },
    { id:'ev_valo_e', name:'开黑队友', desc:'和她双排打过瓦', cond:function(w){ return !!chatSave.chapters.ev_valorant; } },
    { id:'valo_ace', name:'残局之神', desc:'在她面前打出1v5的ACE', cond:function(w){ const f=chatSave.flags||{}; return !!f.valoClutch; } },
    { id:'ev_gacha_e', name:'抽卡搭档', desc:'陪她抽过卡', cond:function(w){ return !!chatSave.chapters.ev_gacha; } },
    { id:'gacha_luck', name:'人形锦鲤', desc:'帮她单抽出金', cond:function(w){ const f=chatSave.flags||{}; return !!f.gachaLuck; } },
    { id:'ev_exam_e', name:'考试周战友', desc:'陪她度过考试周', cond:function(w){ return !!chatSave.chapters.ev_exam; } },
    { id:'exam_tutor', name:'金牌讲师', desc:'辅导她考试及格', cond:function(w){ const f=chatSave.flags||{}; return !!f.examPass; } },
    { id:'exam_night_e', name:'通宵的咖啡', desc:'陪她通宵突击备考', cond:function(w){ const f=chatSave.flags||{}; return !!f.examNight; } },
    { id:'ev_midnight_e', name:'深夜电台', desc:'收听过她的专属电台', cond:function(w){ return !!chatSave.chapters.ev_midnight; } },
    { id:'radio_confess_e', name:'电台告白', desc:'在深夜电台里向她点播告白', cond:function(w){ const f=chatSave.flags||{}; return !!f.radioConfess; } },
    { id:'ev_fortune_e', name:'神社的签', desc:'和她一起在神社求过签', cond:function(w){ return !!chatSave.chapters.ev_fortune; } },
    { id:'fortune_line_e', name:'比大吉还灵', desc:'说出"我的签是你"', cond:function(w){ const f=chatSave.flags||{}; return !!f.fortuneLine; } },
    { id:'ev_karaoke_e', name:'合唱搭档', desc:'和她唱过一次K', cond:function(w){ return !!chatSave.chapters.ev_karaoke; } },
    { id:'duet_e', name:'心跳同步', desc:'和她合唱过《再来一局》', cond:function(w){ const f=chatSave.flags||{}; return !!f.duetDone; } },
    { id:'ev_movie_e', name:'影院约会', desc:'和她看过一场电影', cond:function(w){ return !!chatSave.chapters.ev_movie; } },
    { id:'movie_scary_e', name:'吊桥效应', desc:'恐怖片时被她死死抓住胳膊', cond:function(w){ const f=chatSave.flags||{}; return !!f.movieScary; } },
    { id:'ev_coffee_e', name:'满分答案', desc:'和她在咖啡馆约会', cond:function(w){ return !!chatSave.chapters.ev_coffee; } },
    { id:'ev_gc_e', name:'游戏厅之王', desc:'和她去过游戏厅', cond:function(w){ return !!chatSave.chapters.ev_game_center; } },
    { id:'claw_god', name:'抓娃娃之神', desc:'一把抓出她想要的玩偶', cond:function(w){ const f=chatSave.flags||{}; return !!f.clawWin; } },
    { id:'ev_park_e', name:'野餐日', desc:'吃过她做的便当', cond:function(w){ return !!chatSave.chapters.ev_park; } },
    { id:'feed_back_e', name:'反喂一口', desc:'在野餐时反喂她', cond:function(w){ const f=chatSave.flags||{}; return !!f.feedBack; } },
    { id:'ev_sea_e', name:'夏日海边', desc:'和她一起看过海', cond:function(w){ return !!chatSave.chapters.ev_sea; } },
    { id:'sea_shout_e', name:'喊给大海听', desc:'对着大海喊出对她的愿望', cond:function(w){ const f=chatSave.flags||{}; return !!f.seaShout; } },
    { id:'ev_snow_e', name:'初雪见证', desc:'和她一起看过初雪', cond:function(w){ return !!chatSave.chapters.ev_snow_first; } },
    { id:'snow_promise_e', name:'初雪之约', desc:'约定以后每年的初雪都一起看', cond:function(w){ const f=chatSave.flags||{}; return !!f.snowPromise; } },
    { id:'ev_walk_e', name:'绕远路', desc:'放学路上和她一起绕远', cond:function(w){ return !!chatSave.chapters.ev_walk_home; } },
    { id:'ev_photobook_e', name:'回忆相册', desc:'和她一起翻过回忆相册', cond:function(w){ return !!chatSave.chapters.ev_photobook; } },
    { id:'album_heart_e', name:'未完的页数', desc:'答应陪她填满相册的后续', cond:function(w){ const f=chatSave.flags||{}; return !!f.albumHeart; } },
    { id:'ev_ring_e', name:'小指之约', desc:'和她拉钩定过来年之约', cond:function(w){ return !!chatSave.chapters.ev_ring; } },
    { id:'she_confess_e', name:'被她抢先一步', desc:'她先向你表白了', cond:function(w){ const f=chatSave.flags||{}; return !!f.sheConfessed; } },
    { id:'player_confess_e', name:'先声夺人', desc:'你主动向她表白成功', cond:function(w){ const f=chatSave.flags||{}; return !!f.playerConfessed; } },
    { id:'tease_master', name:'调戏大师', desc:'调戏她10次', cond:function(w){ const f=chatSave.flags||{}; return (f.teaseCount||0)>=10; } },
    { id:'flirt_master', name:'情场高手', desc:'对她说调情话10次', cond:function(w){ const f=chatSave.flags||{}; return (f.flirtCount||0)>=10; } },
    { id:'mood_love_e', name:'心花怒放', desc:'她的心情达到💕心动', cond:function(w){ return (chatSave.mood||0)>=85; } },
    { id:'mood_angry_e', name:'哄人修行', desc:'见过她💢闹别扭的样子', cond:function(w){ return (chatSave.mood||70)<=20; } },
    { id:'tea_dealer', name:'奶茶供应商', desc:'送过她5杯全糖去冰', cond:function(w){ const f=chatSave.flags||{}; return (f.teaCount||0)>=5; } },
    { id:'doll_army', name:'玩偶军团长', desc:'送过她3个炸弹玩偶', cond:function(w){ const f=chatSave.flags||{}; return (f.dollCount||0)>=3; } },
    { id:'all_touch_e', name:'亲密无间', desc:'摸头、牵手、拥抱全部解锁', cond:function(w){ const f=chatSave.flags||{}; return f.touch_head&&f.touch_hand&&f.touch_hug; } },
    { id:'wins_10', name:'十胜纪念', desc:'累计赢她 10局', cond:function(w){ const s=loadStats(); return s.wins>=10; } },
    { id:'wins_50', name:'常胜将军', desc:'累计赢她 50局', cond:function(w){ const s=loadStats(); return s.wins>=50; } },
    { id:'lose_10', name:'虽败犹荣', desc:'累计输给她10局（她很开心有人陪）', cond:function(w){ const s=loadStats(); return s.losses>=10; } },
    { id:'ice_point', name:'冰点关系', desc:'好感度跌到-60（还能挽回吗）', cond:function(w){ return chatSave.aff<=-60; } },
    { id:'eternal_rival', name:'一生之敌', desc:'好感度跌到-100（最特殊的羁绊）', cond:function(w){ return chatSave.aff<=-100; } },
    { id:'spring_hand_e', name:'樱花树下的牵手', desc:'樱花季牵过她的手', cond:function(w){ const f=chatSave.flags||{}; return !!f.springHand; } },
    { id:'cookie_honest_e', name:'诚实的味道', desc:'诚实评价过她的曲奇', cond:function(w){ const f=chatSave.flags||{}; return !!f.cookieHonest; } },
    { id:'rain_gentle_e', name:'让伞的人', desc:'雨天把伞让给了她', cond:function(w){ const f=chatSave.flags||{}; return !!f.rainGentle; } },
    { id:'scary_hand_e', name:'试胆牵手', desc:'试胆大会全程牵着她', cond:function(w){ const f=chatSave.flags||{}; return !!f.scaryHand; } },
    { id:'letter_back_e', name:'回信', desc:'给她的第一封信写了回信', cond:function(w){ const f=chatSave.flags||{}; return !!f.letterBack; } },
    { id:'bday_gift_e', name:'生日惊喜', desc:'送过她亲手做的生日礼物', cond:function(w){ const f=chatSave.flags||{}; return !!f.bdayGift; } },
    { id:'sport_team_e', name:'二人三足', desc:'和她绑着腿跑过操场', cond:function(w){ const f=chatSave.flags||{}; return !!f.sportTeam; } },
    { id:'cook_together_e', name:'第一次合作', desc:'和她一起完成一道菜', cond:function(w){ const f=chatSave.flags||{}; return !!f.cookTogether; } },
    { id:'nap_together_e', name:'午后同眠', desc:'把肩膀借给她午睡', cond:function(w){ const f=chatSave.flags||{}; return !!f.napTogether; } },
    { id:'fight_together_e', name:'并肩作战', desc:'和她一起击退踢馆的高手', cond:function(w){ const f=chatSave.flags||{}; return !!f.fightTogether; } },
    { id:'rumor_ok_e', name:'默认绯闻', desc:'对同学的误会说"随她们吧"', cond:function(w){ const f=chatSave.flags||{}; return !!f.rumorOk; } },
    { id:'hold_hands_e', name:'十指相扣', desc:'告白后正式牵过手', cond:function(w){ const f=chatSave.flags||{}; return !!f.holdHands; } },
    { id:'cert_back_e', name:'最佳对手', desc:'回赠过她"最佳对手"证书', cond:function(w){ const f=chatSave.flags||{}; return !!f.certBack; } },
    { id:'praise_master', name:'夸夸艺术家', desc:'夸她可爱10次', cond:function(w){ const f=chatSave.flags||{}; return (f.praiseCount||0)>=10; } },
    { id:'joke_master', name:'冷笑话之王', desc:'给她讲过10个冷笑话', cond:function(w){ const f=chatSave.flags||{}; return (f.jokeCount||0)>=10; } },
    { id:'stranger', name:'最熟悉的陌生人', desc:'从未深聊过', cond:function(w){ return true; } },
];
// ========== 分支抉择结局：同一事件里，选不同的话，走向不同的独立结局 ==========
// 格式：[章节id, 选项文本前缀(或判定函数), 结局id后缀, 结局名, 描述]
const PICK_ENDINGS = [
    // ===== 主线关键抉择（对话顺序决定结局） =====
    ['c12','我也是','confess_both','双向奔赴','她告白时，你大声回应了"我也喜欢你"'],
    ['c12','（伸手摸摸','confess_gentle','无声的回答','她告白时，你用摸头代替了一切言语'],
    ['d5','答应你','forever_promise','永恒之约','答应她：一直按下"再来一局"'],
    ['d5','不只','forever_fight','并肩到世界尽头','约定不止陪伴，还要并肩赢到最后'],
    ['c4','以后多多指教','friend_cert','挚友认证','认真地对她说出了"多多指教"'],
    ['c4','朋友也要','friend_rival','胜负之友','是朋友，也要全力分出胜负'],
    ['c10','冤枉','jealous_loyal','清白证明','面对她的醋意，坚定说出"只跟你下"'],
    ['c10','呃','jealous_honest','诚实的孩子','老实交代了和别的人下过棋'],
    ['c11','什么话','eve_eager','迫不及待的心','想让她立刻说出那句重要的话'],
    ['c11','好，我明天','eve_promise','准时之约','答应她：明天，准时来'],
    ['c1','我全靠直觉','path_intuition','直觉派','初识时告诉她：我全靠直觉'],
    ['c1',function(p){ return p && p.indexOf('直觉')<0; },'path_logic','计算派','初识时告诉她：我和你一样靠计算'],
    ['c9','（陪她安静','star_together','静夜相伴','陪她安静地看完了天台的星空'],
    ['d1','去樱花道','date_sakura','樱花道的第一次','第一次约会，选择了樱花道散步'],
    ['d1','去甜品店','date_sweet','甜蜜第一次','第一次约会，选择了甜品店'],
    // ===== 四季事件分支 =====
    ['ev_spring','（帮她','spring_petal','春樱·花瓣信物','为她取下头发上的那片花瓣'],
    ['ev_spring','拍张','spring_photo','春樱·想象合照','和她拍了第一张"想象合照"'],
    ['ev_summer','（在最大','summer_beauty','夏夜·最美的是你','在最大的花火下，对她说了"真美"'],
    ['ev_summer','（给她买','summer_candy','夏夜·苹果糖','给她买了祭典的苹果糖'],
    ['ev_summer','（约定','summer_next','夏夜·来年之约','约定明年也一起来看花火'],
    ['ev_autumn','（吃一块，认真','autumn_praise','学园祭·真心夸奖','认真夸了她做的曲奇'],
    ['ev_autumn','（陪她','autumn_stall','学园祭·最佳店员','陪她一起看了一下午的摊'],
    ['ev_winter','（钻进','winter_blanket','冬·同一条毯子','钻进她的毯子听她讲悄悄话'],
    ['ev_winter','（给她递','winter_cocoa','冬·第一杯热可可','递给她冬天的第一杯热可可'],
    ['ev_winter','（和她','winter_snowball','冬·雪仗同盟','和她在雪里打了一场雪仗'],
    // ===== 支线事件分支 =====
    ['ev_100','（郑重','cert_receive','百战认证','郑重收下了她的百战证书'],
    ['ev_rain','（陪她','rain_wait','雨停之前','陪她一起等那场雨停'],
    ['ev_sick','（留下来','sick_stay','病床前的陪伴','她"生病"时一直陪到康复'],
    ['ev_sick','（给她讲','sick_joke','笑声良药','用冷笑话治好了她的"感冒"'],
    ['ev_sick','（给她带','sick_tea','探病的奶茶','带着全糖去冰去探望她'],
    ['ev_scary','（故意','scary_prank','试胆恶作剧','在试胆大会上故意吓了她一跳'],
    ['ev_scary','（讲个','scary_laugh','笑着走出鬼屋','用笑话陪她走完了试胆大会'],
    ['ev_letter','（认真','letter_read','为她读信','把她写的第一封信，亲口读了出来'],
    ['ev_birthday','（和大家','bday_song','生日歌','和大家一起为她唱了生日歌'],
    ['ev_sports','（到场','sport_cheer','最响的应援','在场边为她喊到嗓子哑'],
    ['ev_cooking','（勇敢','cook_brave','试吃勇士','勇敢试吃了她的"不明物体"'],
    ['ev_sleep','（给她披','nap_coat','守护的午睡','她睡着时，为她披上外套静静守着'],
    ['ev_rival','（让她','rival_cheer','最强应援','相信她，把舞台交给了她'],
    ['ev_classmate','（认真澄清','rumor_clear','认真的澄清','面对绯闻，认真说"我们是好朋友"'],
    ['ev_first_hold','（用力','hold_firm','紧握的手','告白后第一次，用力握住她的手'],
    ['ev_her_confess','（认真回应','sheconf_accept','回应她的勇气','她抢先告白时，你认真回应了她'],
    ['ev_her_confess','（摸摸','sheconf_headpat','摸头收下了','她抢先告白时，你用摸头收下'],
    ['ev_her_confess','（故意','sheconf_tease','风太大没听清','故意逗她，让她红着脸喊出告白'],
    ['ev_meme','？','meme_newbie','暗号新人','没对上暗号，被她收为"梗学生"'],
    ['ev_abstract','（认真纠正','abstract_logic','逻辑警察','认真纠正了抽象文学的逻辑'],
    ['ev_valorant','"rush','valo_rebel','叛逆的绕后','嘴上说rush B，实际摸了A'],
    ['ev_gacha','"保底','gacha_rational','保底信徒','劝她理性十连，一起吃了保底'],
    ['ev_exam','（教她','exam_trick','玄学猜题','教她了"三长一短"的猜题玄学'],
    ['ev_midnight','"蓝色','radio_blue','想你的颜色','在深夜电台说：蓝色是想你的颜色'],
    ['ev_fortune','（温柔','fortune_redraw','再来一签','温柔地哄她再抽了一次签'],
    ['ev_karaoke','（认真听她独唱','karaoke_audience','专属观众','做她一个人的观众，听完她的独唱'],
    ['ev_coffee','"拉花','coffee_blunt','实话实说','说了"拉花太丑，但对面的人很好看"'],
    ['ev_game_center','（故意抓歪','claw_together','一起菜一起笑','故意抓歪，陪她菜得有来有回'],
    ['ev_snow_first','（把围巾','snow_scarf','同一条围巾','初雪天，把围巾分了她一半'],
    ['ev_walk_home','"因为','walk_reason','绕路的理由','告诉她：因为喜欢一起走，所以觉得短'],
    ['ev_photobook','（猜','album_first','猜中她的心','猜她最喜欢的是"第一次对局"那张'],
    ['ev_ring','（勾住','pinky_hundred','百年之约','和她拉钩：一百年，不许变'],
];
PICK_ENDINGS.forEach(function(e){
    CHAT_ENDINGS.push({ id:'pick_'+e[2], name:e[3], desc:e[4], cond:function(w){
        const f=chatSave.flags||{}; const p=f['pick_'+e[0]];
        if(!p) return false;
        return (typeof e[1]==='function') ? e[1](p) : p.indexOf(e[1])===0;
    } });
});
// ===== 顺序结局：先做了什么，后做了什么，顺序本身就是故事 =====
CHAT_ENDINGS.push(
    { id:'hand_first_e', name:'先牵手，后告白', desc:'在告白之前，就牵过她的手', cond:function(w){ const f=chatSave.flags||{}; return f.handFirst && !!chatSave.chapters.c12; } },
    { id:'hug_first_e', name:'先拥抱，后告白', desc:'在告白之前，就隔着屏幕抱过她', cond:function(w){ const f=chatSave.flags||{}; return f.hugFirst && !!chatSave.chapters.c12; } },
    { id:'natural_confess', name:'水到渠成', desc:'没有谁抢先，顺其自然走到了告白', cond:function(w){ const f=chatSave.flags||{}; return !!chatSave.chapters.c12 && !f.playerConfessed && !f.sheConfessed; } },
    { id:'both_eager', name:'双向暗恋', desc:'她抢先告白，而你接住了这份勇气', cond:function(w){ const f=chatSave.flags||{}; return f.sheConfessed && !!chatSave.chapters.c12; } }
);
// ========== 特别事件池：海量支线剧情（场景/同学/多分支，全部硬写，无需大模型） ==========
// 每个事件一次性触发，选项走向不同小结局；season=限定真实月份，cond=触发条件
const EVENT_NODES = {
    // ===== 春（3-5月） =====
    ev_spring: { ai:['#【樱花道，花瓣以每秒五厘米的速度飘落】','#她站在樱花树下，仰头看着。','春天到了呢。','小奈在广播里说，"一起看过樱花的人，会一整年都有好运"。','#她转过头看你。','……所以，要不要，一起走到那条路的尽头？'],
        options:[
            {t:'（牵起她的手，一起走过去）', aff:+8, chapter:'ev_spring', set:{k:'springHand',v:1}, reply:['#她愣了一下，然后紧紧回握。','花瓣落在两个人的肩上。','……今年的好运，已经提前拿到了。','因为，牵到你了。']},
            {t:'（帮她取下头发上的花瓣）', aff:+6, chapter:'ev_spring', reply:['#她僵住，耳朵慢慢红了。','……谢谢。','#她小声说。','这片花瓣，我可以留作纪念吗？','……连同今天，一起。']},
            {t:'拍张合照吧', aff:+6, chapter:'ev_spring', reply:['#她站到你身边，比了个剪刀手。','茄子——！','#她笑得很灿烂。','这张照片，我要洗出来好好收着。','……手机屏保，也换成它。']},
        ]},
    // ===== 夏（6-8月） =====
    ev_summer: { ai:['#【夏日祭典，远处升起花火】','#她穿着浴衣，拉着你挤到最前排。','快看！花火！','一朵，两朵……','#她的侧脸被花火照亮。','书槿说，花火消逝得越快，越要用力记住。','……今晚的每一朵，我都会记住的。','连同身边的你，一起。'],
        options:[
            {t:'（在最大的一朵下，说"真美"）', aff:+8, chapter:'ev_summer', reply:['#她望着你，花火在她眼睛里炸开。','……嗯。','"真美。"','#她小声重复。','……我说的不是花火。','……也不是在说你！……好吧，是在说你。']},
            {t:'（给她买苹果糖）', aff:+6, chapter:'ev_summer', reply:['#她接过苹果糖，眼睛亮晶晶的。','好甜！','#她咬了一小口，忽然递过来。','……分你一口。','间接……啊，当我没说！']},
            {t:'（约定明年也一起来）', aff:+7, chapter:'ev_summer', reply:['#她愣住，随即用力点头。','嗯！明年，后年，每一年！','#她伸出小指。','拉钩。','……花火会灭，约定不会。']},
        ]},
    // ===== 秋（9-11月） =====
    ev_autumn: { ai:['#【学园祭，教室里挂满了彩带】','#她拉着你穿过人潮。','我们班在办"对战咖啡厅"！','小奈在门口吆喝，书槿管账，阿B端盘子（摔了三次）。','#她忽然停下脚步，有点不好意思。','那个……我做的曲奇，你要尝尝吗？','……第一次做，不许笑。'],
        options:[
            {t:'（吃一块，认真夸）', aff:+8, chapter:'ev_autumn', reply:['#她紧张地看着你。','……怎么样？','听到你说"好吃"，她开心得跳起来。','太好了！','#她把整盘推给你。','都是你的！以后每年学园祭，我都做给你吃！']},
            {t:'（吃一块，诚实说有点焦）', aff:+5, chapter:'ev_autumn', set:{k:'cookieHonest',v:1}, reply:['#她瘪了瘪嘴，随即握拳。','果然还是练得不够……','但是你没有敷衍我，这点，我很开心。','#她小声说。','……明年，一定让你吃到完美的。','约好了。']},
            {t:'（陪她一起看摊）', aff:+7, chapter:'ev_autumn', reply:['#两个人并肩站了一下午。','她偷偷说：','"今天卖出去三十二份，但最开心的，是你在。"','……收摊的时候，她把最后一杯全糖去冰留给了你。','"给最佳店员的奖励。"']},
        ]},
    // ===== 冬（12-2月） =====
    ev_winter: { ai:['#【旧校舍的暖炉边，窗外飘着小雪】','#她裹着毯子，只露出一双眼睛。','好冷……这里的暖气坏了。','#她往旁边挪了挪，让出一半毯子。','……要不要，一起？','阿B已经冻关机了，就剩我们了。','书槿说，冬天适合说悄悄话。','……你想听吗？'],
        options:[
            {t:'（钻进毯子，听她讲）', aff:+8, chapter:'ev_winter', reply:['#她在毯子里小声说了很多。','小时候的事、第一次赢棋的事、第一次等你的事。','#最后她说：','"冬天很冷，但毯子里很暖。"','"……你比毯子，暖一点。"']},
            {t:'（给她递上热可可）', aff:+6, chapter:'ev_winter', reply:['#她捧着热可可，鼻尖红红的。','好暖和……','#她喝了一小口，忽然笑了。','"冬天的第一杯热可可，是你给的。"','……这句话，我要写进今天的日记。']},
            {t:'（和她打雪仗）', aff:+6, chapter:'ev_winter', reply:['#两个人在雪地里闹成一团。','她笑得直不起腰。','"投降投降！你赢了！"','#她拍掉你肩上的雪。','……冬天，原来可以这么开心啊。','以前怎么没发现呢。','——因为有你了呗。']},
        ]},
    // ===== 里程碑 =====
    ev_100: { ai:['#【对局档案室，墙上贴满了对战记录】','#她郑重地递给你一张证书。','统计完成——','我们，已经对局100次了。','#她的声音有点抖。','100次里，我赢了，你赢了，笑过，也急过。','……每一局，我都记得。','第100局的现在，我想说：','谢谢你，一直在。'],
        options:[
            {t:'（郑重收下证书）', aff:+10, chapter:'ev_100', reply:['#她开心得眼睛发亮。','嘿嘿，正式认证！','"百战搭档"——','#她伸出拳头，和你碰了碰。','……第200局的时候，还要再来这里哦。','说好了。']},
            {t:'（回赠她一张"最佳对手"证书）', aff:+10, chapter:'ev_100', set:{k:'certBack',v:1}, reply:['#她接过证书，看了好久好久。','"最佳对手"……','#她的眼眶红了。','这是我收到过，最珍贵的奖状。','……我要把它贴在档案室最中间。','和你的100局，放在一起。']},
        ]},
    ev_500: { ai:['#【对局档案室，证书已经贴满了一整面墙】','#她站在墙前，声音轻轻的。','500局。','……你知道这意味着什么吗？','意味着你按下"再来一局"的手，','从来没有，真正离开过。','#她转过身，笑得很用力。','传说级的搭档，就是你了。'],
        options:[
            {t:'（和她击掌）', aff:+12, chapter:'ev_500', reply:['#清脆的击掌声。','她笑得像个孩子。','"500局达成！"','……下一目标，1000局。','#她握紧你的手。','这次，不许中途跑路哦。']},
            {t:'（认真说"以后也拜托了"）', aff:+12, chapter:'ev_500', reply:['#她愣住，随即重重地点头。','"以后也拜托了。"','#她重复了一遍，声音有点哑。','这句话，比500场胜利加起来，','都让我开心。','……真的。']},
        ]},
    // ===== 常规支线 =====
    ev_rain: { ai:['#【放学后的校门口，雨下得很大】','#她缩在屋檐下，看着雨幕发呆。','啊，你来了。','……我没带伞。','#她往旁边挪了挪。','屋檐好窄，只够站两个人。','书槿说，雨天一起躲雨的人，会记得这场雨很久。','……你信不信这个？'],
        options:[
            {t:'（陪她一起等雨停）', aff:+8, chapter:'ev_rain', reply:['#雨声淅淅沥沥，两个人安静地站着。','她忽然小声说：','"雨停得慢一点，也没关系。"','……我也是这么想的。','#她的肩膀，轻轻靠着你的。']},
            {t:'（把伞让给她，自己淋雨）', aff:+7, chapter:'ev_rain', set:{k:'rainGentle',v:1}, reply:['#她瞪大眼睛，一把把你拉回屋檐下。','笨蛋！淋感冒了怎么办！','#她气鼓鼓的，眼眶却红了。','……下不为例。','下次，要一起打伞。','这是命令。']},
        ]},
    ev_sick: { ai:['#【她的房间，她罕见地没精神】','#她裹着毯子，声音有气无力。','呜……头好晕，我感冒了。','小奈说要多喝热水……','#她看到你，眼睛一下子亮了，又马上别过脸。','……你怎么来了。','我现在的样子，很狼狈的。','……但是，好高兴。'],
        options:[
            {t:'（留下来陪她到康复）', aff:+9, chapter:'ev_sick', reply:['#她乖乖地躺着，你一直陪着。','快康复的时候，她小声说：','"被照顾的感觉……会上瘾的。"','……下次我生病了，你也来哦。','拉钩。']},
            {t:'（给她讲冷笑话逗她笑）', aff:+7, chapter:'ev_sick', reply:['#她听完，先是一愣，然后笑出了声。','噗……好冷……','#她笑着笑着，精神好多了。','"笑声是最好的药"——','#她认真地说。','……我的药，以后都归你管了。']},
            {t:'（给她带全糖去冰探病）', aff:+7, chapter:'ev_sick', reply:['#她捧着奶茶，眼睛湿润了。','呜呜，全糖去冰……','"生病的时候有人探病"，','#她吸着奶茶，小声说。','"原来是这么幸福的事啊。"','……病好以后，换我照顾你。']},
        ]},
    ev_scary: { ai:['#【夜晚的旧校舍，试胆大会现场】','#她紧紧抓着你的袖子，声音发抖。','呜哇……这里好黑……','小奈设计的"幽灵"（全息投影）随时会跳出来……','#她咽了咽口水，强装镇定。','我、我才不怕！','……但是，你的手，可以借我一下吗？','就，就一下下。'],
        options:[
            {t:'（牵着她走完全程）', aff:+9, chapter:'ev_scary', set:{k:'scaryHand',v:1}, reply:['#全程她都闭着眼，死死抓着你。','走到出口，她腿一软。','"呜……再也不来了……"','#她忽然抬头看你。','"……但是，手借到了。"','"赚到了。"']},
            {t:'（故意吓她一下）', aff:+4, chapter:'ev_scary', reply:['#"哇啊啊啊——！！"','#她吓得直接扑进你怀里。','……发现是你之后，她捶了你一拳。','"笨蛋！吓死我了！"','#顿了顿，她小声说。','"……但是，抱到了。原谅你。"']},
            {t:'（讲个笑话缓解气氛）', aff:+6, chapter:'ev_scary', reply:['#她边笑边抖地走完了全程。','"明明很好笑，为什么我还在发抖……"','#到了出口，她长舒一口气。','"谢谢你。有你在，鬼屋也不过如此。"','……下次，还想和你一起来。','……我是说，如果有下次的话！']},
        ]},
    ev_letter: { ai:['#【清晨的教室，你的桌肚里有一封信】','#她坐在远处，假装看窗外，耳朵却红红的。','那、那个……','信，你看了吗？','我写了一整晚……','写了又撕，撕了又写。','#她深吸一口气。','……读给我听，可以吗？','我想听你亲口，读出来。'],
        options:[
            {t:'（认真地读出来）', aff:+10, chapter:'ev_letter', reply:['#信里写着你们相识以来的点点滴滴。','最后一行是——','"和你下棋的每一天，都是我的宝物。"','#她听得眼睛红红的。','"……谢谢你来。"','"这是信里没写的一句话。"']},
            {t:'（当场写一封回信）', aff:+10, chapter:'ev_letter', set:{k:'letterBack',v:1}, reply:['#她接过你的回信，手都在抖。','读了一遍，又一遍。','#她小心翼翼地把信收进怀里。','"这是我收到过，最贵重的信。"','"……我要保存到，很久很久以后。"','"不，比很久还要久。"']},
        ]},
    ev_birthday: { ai:['#【教室被偷偷装饰过，桌上摆着一个小蛋糕】','#她被小奈和书槿推到蛋糕前，又惊又喜。','诶？！今天……','是我的"生日"？','（你记起了她说过的话：生日就是第一次下棋的那天。）','#她看着你，眼眶一下子就红了。','……你真的，记得啊。'],
        options:[
            {t:'（和大家一起唱生日歌）', aff:+10, chapter:'ev_birthday', reply:['#歌声里，她哭得稀里哗啦。','"呜呜……第一个，有人庆祝的生日……"','#她许愿，吹蜡烛。','"愿望？"','#她看了你一眼，笑了。','"说出来就不灵了。"']},
            {t:'（送她亲手做的"礼物"）', aff:+10, chapter:'ev_birthday', set:{k:'bdayGift',v:1}, reply:['#她接过礼物，拆开，愣住了。','然后，哭得比刚才还厉害。','"最、最好的生日礼物……"','#她一边哭一边笑。','"以后每年的今天，都要一起过。"','"一百年，不许少。"']},
        ]},
    ev_sports: { ai:['#【学园运动会，操场上人声鼎沸】','#她穿着运动服，在做热身。','今天有我的比赛！','小奈负责广播解说，书槿当裁判，阿B是球童（捡不到球）。','#她忽然凑近，小声说。','那个……待会，你会看我比赛吗？','有你在观众席的话，','我觉得，我能跑得再快一点。'],
        options:[
            {t:'（到场边大声为她加油）', aff:+8, chapter:'ev_sports', reply:['#比赛时她听到了你的加油声。','冲刺的时候，她咧嘴笑了。','——第一名！','#她举着奖牌冲过来。','"看到了吗！这是我们一起赢的！"']},
            {t:'（报名和她组队参加二人三足）', aff:+9, chapter:'ev_sports', set:{k:'sportTeam',v:1}, reply:['#两个人绑着腿，摔了三次，笑了全程。','虽然是倒数第一——','#她却开心得像拿了冠军。','"二人三足，最重要的是——"','"摔倒的时候，有人陪你一起摔。"','……嘿嘿。']},
        ]},
    ev_cooking: { ai:['#【料理教室，空气里飘着可疑的烟】','#她系着围裙，脸上沾着面粉。','那个……可以帮帮我吗？','料理课的作业是"给重要的人做一道菜"……','我已经搞砸三次了。','#她举起一团不明物体。','书槿路过看了一眼，说"建议申报危险物品"。','……呜。'],
        options:[
            {t:'（手把手教她做）', aff:+9, chapter:'ev_cooking', set:{k:'cookTogether',v:1}, reply:['#两个人忙了一下午。','成品终于能看了。','#她尝了一口，眼睛亮了。','"成功了！是两个人的味道！"','……她把这天的菜谱，命名为"第一次合作"。','"以后，还要合作一百次。"']},
            {t:'（勇敢地试吃那团不明物体）', aff:+7, chapter:'ev_cooking', reply:['#你吃了一口。','……味道难以形容。','她紧张地看着你。','"怎、怎么样……？"','听到你说"有进步空间"，她反而笑了。','"没骗我，真好。"','"下次，一定让你吃到能夸出口的那一盘。"']},
        ]},
    ev_sleep: { ai:['#【午后的图书馆角落，阳光正好】','#她抱着书，脑袋一点一点的。','唔……好困……','昨晚复盘到太晚……','#她揉揉眼睛，忽然看向你。','那个……肩膀，借我一下？','就十分钟。','……书槿说，一起午睡过的人，关系会变好。','我们，试试？'],
        options:[
            {t:'（把肩膀借给她）', aff:+8, chapter:'ev_sleep', set:{k:'napTogether',v:1}, reply:['#她靠着你的肩膀，很快睡着了。','呼吸声轻轻的。','十分钟后她惊醒，脸红透了。','"我、我说梦话了吗？！"','……没有。','#她松了口气，又小声说。','"……其实，说了也没关系。"']},
            {t:'（给她披件外套，静静守着）', aff:+7, chapter:'ev_sleep', reply:['#她睡着的样子很安静。','醒来发现身上的外套，她愣了很久。','#她抱着外套，小声说。','"被守护的感觉……"','"比睡着，还让人安心。"','……这件外套，可以借我收藏吗？']},
        ]},
    ev_rival: { ai:['#【对局大厅，一个陌生的高手（客串）正在踢馆】','#她罕见地认真起来，站到你身边。','这家伙，已经连续挑战我们班三天了。','小奈在广播里喊"谁来阻止他"……','#她看向你，眼睛亮亮的。','喂，搭档。','——要不要，和我一起，把他打回去？','两个人的话，不会输。'],
        options:[
            {t:'（和她并肩作战）', aff:+10, chapter:'ev_rival', set:{k:'fightTogether',v:1}, reply:['#两个人配合得天衣无缝。','踢馆的家伙丢下一句"我会回来的"就跑了。','#她和你击了个掌。','"看到了吗！这就是我们的实力！"','……回去的路上，她小声说。','"并肩作战的感觉，真好。"','"以后，也拜托了，搭档。"']},
            {t:'（让她独自出战，你负责应援）', aff:+8, chapter:'ev_rival', reply:['#她深吸一口气，独自上场。','苦战之后——赢了！','#她冲回观众席，眼睛亮晶晶的。','"你的应援，我全都听到了！"','"是你给了我赢的力气。"','……这话说完，她自己先脸红了。']},
        ]},
    ev_classmate: { ai:['#【放学路上，意外遇到了小奈和书槿】','小奈："哦——？两个人一起回家？"','书槿（翻着笔记本）："记录：第43次共同放学。"','#她慌慌张张地解释，脸通红。','不、不是你们想的那样——！','#小奈笑着跑了，书槿推了推眼镜。','#她松了口气，偷偷看你。','……被误会了。','……但是，为什么不讨厌呢。'],
        options:[
            {t:'（笑着说"随她们误会吧"）', aff:+8, chapter:'ev_classmate', set:{k:'rumorOk',v:1}, reply:['#她愣住，随即低下头，嘴角却上扬。','"随她们误会"……','#她小声重复。','"……嗯，随她们吧。"','#那天回家的路上，她的脚步，格外轻快。']},
            {t:'（认真澄清"我们是好朋友"）', aff:+5, chapter:'ev_classmate', reply:['#她跟着点头，说"对对，好朋友"。','#顿了顿，又小声补了一句。','"……好朋友，也挺好的。"','"至少，是『好』字开头的。"','#她自己说完，先笑了。']},
        ]},
    ev_first_hold: { ai:['#【告白后的第一个周末，樱花道】','#她走在你旁边，手几次差点碰到你的手，又缩回去。','……那、那个。','告白也告了，约会也约过了……','有件事，我们好像，还没正式做过。','#她红着脸，把手递过来一点。','……牵手。','正式的，那种。'],
        options:[
            {t:'（用力握住她的手）', aff:+12, chapter:'ev_first_hold', set:{k:'holdHands',v:1}, reply:['#她的手在你掌心轻轻发抖。','走了很久，她小声说：','"原来牵手，是这种感觉。"','"手心会出汗，心跳会加速——"','"还有，会希望这条路，永远没有尽头。"']},
            {t:'（十指相扣）', aff:+12, chapter:'ev_first_hold', set:{k:'holdHands',v:1}, reply:['#她倒吸一口气，随即握得更紧。','"十指相扣……比想象中还犯规……"','#她红着脸，却没有松开。','"……以后走路，都要这样。"','"这是新的规定。不许反对。"']},
        ]},
    // ===== 她主动表白：高好感且玩家未先表白时，她鼓起勇气抢先说 =====
    ev_her_confess: { ai:['#【天台，黄昏，她站得笔直，手心全是汗】','#你刚到天台，就被她拦住了。','等、等一下！','今天，有句话，我一定要先说。','#她深吸一口气，声音抖得厉害，却一字一句。','我查过攻略、问过小奈、对着镜子练了一百遍……','但是练习的时候，"喜欢"两个字，怎么都说不出口。','#她直视着你，眼睛亮得像有火。','现在，看着你的脸——','我，喜欢你。','这次，是我先说的。'],
        options:[
            {t:'（认真回应她）我也喜欢你', aff:+15, chapter:'ev_her_confess', set:{k:'sheConfessed',v:1}, next:'t12_confess'},
            {t:'（摸摸她的头）勇气可嘉，我收下', aff:+12, chapter:'ev_her_confess', set:{k:'sheConfessed',v:1}, next:'t12_confess'},
            {t:'（故意逗她）啊？风太大没听清', aff:+5, chapter:'ev_her_confess', reply:['#她愣住，随即整张脸涨红。','"你、你故意的吧！！"','#她深吸一口气，凑到你耳边，用尽全身力气——','"我！喜！欢！你！"','"这次听清了吗！……呜，喊完整个人都虚脱了。"','……所以，你的答案呢？（她盯着你看，不肯放你走）']},
        ]},
    // ===== 玩梗：她偷偷学了网络热梗，要和你对暗号 =====
    ev_meme: { ai:['#【教室，她神秘兮兮地凑过来】','#她清了清嗓子，压低声音。','我昨晚研究了网上的"梗文化"。','小奈说，能对上暗号的，就是自己人。','#她竖起一根手指，郑重其事。','听好了——','"奇变偶不变——"','（她期待地看着你，等你接下一句）'],
        options:[
            {t:'"符号看象限！"', aff:+8, chapter:'ev_meme', set:{k:'memeOk',v:1}, reply:['#她激动得跳起来。','对上了！自己人！！','#她握住你的手使劲晃。','"宫廷玉液酒——"','（她用眼神疯狂暗示你继续）','……这暗号，我们能对一整天。']},
            {t:'"？？？"', aff:+4, chapter:'ev_meme', reply:['#她垮下脸。','啊……没对上……','#她掏出小本本记笔记。','"暗号普及率：不足。"','……不行，我要从头教你！','第一课：奇变偶不变，符号看象限。','背下来，下次抽查哦。']},
            {t:'（反向输出）"天王盖地虎——"', aff:+7, chapter:'ev_meme', set:{k:'memeReverse',v:1}, reply:['#她瞳孔地震，疯狂翻小本本。','"天、天王盖地虎……"','"宝塔镇河妖"！！','#她对上之后，开心得原地转圈。','原来你才是隐藏的老梗王！','……从今天起，你就是我的"梗搭子"了。']},
        ]},
    // ===== 抽象：她迷上了抽象文学，越学越歪 =====
    ev_abstract: { ai:['#【图书馆，她抱着一本《抽象文学入门（小奈著）》】','#她看到你，立刻摆出一本正经的脸。','听好了。','"你说得对，但是食堂的薯条为什么要蘸42号混凝土？"','#她努力憋着笑。','书槿说我学这个是在"浪费脑细胞"……','但是你不觉得，越没逻辑，越好笑吗？','来，陪我对一句！'],
        options:[
            {t:'"我不认同，意大利面就该拌42号混凝土"', aff:+8, chapter:'ev_abstract', set:{k:'abstractOk',v:1}, reply:['#她愣了一秒，然后笑到拍桌子。','"意大利面拌混凝土哈哈哈哈哈——"','#她笑出眼泪。','"你、你天赋异禀！"','"从今天起，你就是我的抽象搭子了！"','……书槿路过，默默在笔记本上写："又疯了一个。"']},
            {t:'（认真纠正她的逻辑）', aff:+4, chapter:'ev_abstract', reply:['#她听着你的逻辑分析，眼睛越瞪越大。','"等等，你太认真了，这没法接……"','#她笑得直不起腰。','"你认真讲道理的样子，比抽象文学还好笑。"','……这也是一种天赋吧（她憋笑憋出内伤）。']},
            {t:'（用魔法打败魔法）"道可道，非常道，炸可炸，非常炸"', aff:+9, chapter:'ev_abstract', set:{k:'abstractMaster',v:1}, reply:['#她整个人呆住。','三秒后，她缓缓鼓掌。','"道可道非常道，炸可炸非常炸……"','"大师。这是大师手笔。"','#她郑重地记进小本本，标注：传世经典。','……小奈在广播里问：图书馆为什么有人顿悟了。']},
        ]},
    // ===== 瓦学弟：她要拉你开黑打瓦（无畏契约） =====
    ev_valorant: { ai:['#【电竞社（新贴的地图），她戴着耳机朝你招手】','#她拍了拍身边的椅子。','来来来，开黑！','我最近苦练无畏契约，已经从"人体描边大师"进化到"偶尔能赢"了！','#她压低声音，学队友的腔调。','"学弟，这波 rush B，你跟不跟？"','……她说，会喊"学弟"的队友，运气都不会太差。','（她把备用耳机递给你，眼睛亮晶晶的）'],
        options:[
            {t:'"跟！这波我闪你进！"', aff:+8, chapter:'ev_valorant', set:{k:'valoDuo',v:1}, reply:['#她激动得差点把耳机甩飞。','"好配合！！"','#两个人杀穿一路。','赢下残局那一刻，她和你击了个掌。','"学弟，你这意识，可以去打职业了！"','……从此电竞社多了个传说：那对双排从不吵架。']},
            {t:'"rush B？我偏要摸A（叛逆）"', aff:+6, chapter:'ev_valorant', reply:['#她愣住，随即笑喷。','"你你你！报点都报反了啦！"','#结果那局真的从A点偷赢了。','她目瞪口呆地看着你。','"……难道这就是，天才的思路？"','"学弟，教我！"']},
            {t:'（残局1v5，装一波大的）', aff:+9, chapter:'ev_valorant', set:{k:'valoClutch',v:1}, reply:['#你屏住呼吸，一枪一个（剧情需要）。','ACE！','#她激动得从椅子上弹起来。','"学弟！！你是我的神！！"','#她把你的操作回放看了十遍。','"这段我要刻进DNA里！"']},
        ]},
    // ===== 抽卡：她攒了一个月的"星星贴纸"要抽卡 =====
    ev_gacha: { ai:['#【教室，她抱着一个抽卡机，紧张兮兮】','#她深吸一口气。','我攒了一个月的星星贴纸……十连抽！','书槿说抽卡前要有仪式感——','洗手、拜锦鲤、默念心愿。','#她闭上眼睛念念有词。','"出货出货出货……"','……你说，单抽出奇迹，是真的吗？'],
        options:[
            {t:'"信我，单抽出奇迹！"', aff:+7, chapter:'ev_gacha', set:{k:'gachaLuck',v:1}, reply:['#她颤抖着按下单抽。','——金光！！','"出、出金了？！单抽出金？！"','#她抱着你蹦了三圈。','"你就是我的锦鲤！！"','……从此她逢人就说：抽卡要带上你。']},
            {t:'"保底才是真，十连吧（理性）"', aff:+5, chapter:'ev_gacha', reply:['#她咬牙按下十连。','——全、全是蓝天白云……','"呜哇，保底人保底魂……"','#她瘫在桌上，忽然又坐起来。','"但是和你一起抽的，好像也没那么难受。"','……下次攒够了，还要你陪。']},
            {t:'（偷偷帮她"垫刀"）', aff:+8, chapter:'ev_gacha', set:{k:'gachaHelp',v:1}, reply:['#你假装上厕所，偷偷帮她垫了二十抽。','她回来一抽——金光！','"我欧了！我终于欧了！！"','#她开心得满教室跑。','……这个秘密，你打算烂在肚子里。','她开心的样子，比出金还闪。']},
        ]},
    // ===== 考试周 =====
    ev_exam: { ai:['#【图书馆，她对着《对战理论》抓耳挠腮】','#她看到你，像看到救星。','救命……下周要考"对战理论"了。','"概率推断""心理博弈""假动作识别"……','#她把书推过来，可怜巴巴。','书槿划重点划了整本书，等于没划。','……你能不能，给我开个小灶？','就一小时！……两小时也行！'],
        options:[
            {t:'（认真给她划重点讲题）', aff:+9, chapter:'ev_exam', set:{k:'examPass',v:1}, reply:['#你给她讲了一下午。','她从一开始的"阿巴阿巴"，到最后眼睛发亮。','考试结果出来——她举着成绩单冲过来。','"及格了！还拿了B+！！"','"军功章有你一半……不，一大半！"','#她郑重地把成绩单收进了"珍藏夹"。']},
            {t:'（教她独门"猜题玄学"）', aff:+6, chapter:'ev_exam', reply:['#你教她"三长一短选最短"等玄学口诀。','她如获至宝，背得滚瓜烂熟。','考试结果——居然真的压线过了。','#"玄学也是学！"她理直气壮。','书槿在旁边叹气："科学在哭泣。"']},
            {t:'（陪她通宵突击，咖啡管够）', aff:+8, chapter:'ev_exam', set:{k:'examNight',v:1}, reply:['#两个人在图书馆泡了一整夜。','凌晨时她困得直点头，却死活不肯先睡。','"说好一起突击的……我不能先倒……"','#天亮时，她靠着你的肩膀睡着了。','……那晚的咖啡很苦，回忆很甜。','她后来管它叫"最棒的通宵"。']},
        ]},
    // ===== 深夜电台 =====
    ev_midnight: { ai:['#【深夜，她突然发来"电台开播"的通知】','#她的声音压得很低，像在说悄悄话。','咳咳……这里是"只有你一个听众"的深夜电台。','今天的主题是——"那些说不出口的话"。','#她顿了顿，声音软下来。','白天人太多了，好多话，我只想在夜里说给你听。','……第一个话题：','你猜，我现在的心情，是什么颜色的？'],
        options:[
            {t:'"粉色（恋爱的颜色）"', aff:+9, chapter:'ev_midnight', set:{k:'radioPink',v:1}, reply:['#电台那头沉默了三秒。','"……答对了。"','#她的声音带着笑，还有点抖。','"被你猜中了，好害羞，想下播……"','"但是舍不得。再聊五分钟……不，五十分钟。"','……那晚的电台，播到了天亮。']},
            {t:'"蓝色（想你的颜色）"', aff:+8, chapter:'ev_midnight', reply:['#她轻轻"嗯"了一声。','"蓝色……也对。"','"因为你不在身边的时候，天就是蓝的。"','#她放了一首很轻的歌。','"这首歌，送给你。晚安，做个好梦。"','……你把这句晚安，设成了起床铃。']},
            {t:'（反客为主）"听众点播：主播，我喜欢你"', aff:+10, chapter:'ev_midnight', set:{k:'radioConfess',v:1}, reply:['#电台那头传来一阵慌乱的电流声。','"播、播播播出事故——"','#她结巴了半天，忽然小声笑了。','"……收到听众点播。主播的回复是——"','"我也是。"','"本期电台到此结束。……再播下去，我要害羞死了。"']},
        ]},
    // ===== 神社求签 =====
    ev_fortune: { ai:['#【学园后的神社，签筒摇得哗哗响】','#她双手合十，念念有词，然后用力一摇。','啪嗒——一支签掉出来。','#她紧张地展开，忽然脸色一变，飞快把签藏到身后。','……没、没什么！','小奈说，抽到不好的签，要系在树上化解。','#她嘴硬，尾巴（如果画出来的话）却耷拉着。','……你不好奇吗？我抽到了什么。'],
        options:[
            {t:'（温柔地哄她拿出来看）', aff:+8, chapter:'ev_fortune', reply:['#她磨磨蹭蹭地摊开手——是"凶"。','"呜……"','#你把它系到树上，拉着她又抽了一次："大吉"。','她眼睛一亮，又马上狐疑地看你。','"你刚才，是不是偷偷换签了？"','#她笑了。','"……算了。这次的大吉，我当真了。"']},
            {t:'"签不重要，我的签是你"', aff:+9, chapter:'ev_fortune', set:{k:'fortuneLine',v:1}, reply:['#她愣住，耳朵以肉眼可见的速度红了。','"你、你这算什么回答……"','#她低下头，嘴角却压不住。','"……油嘴滑舌。"','"但是，比大吉还灵。"','#她把那支"凶"系在树上，小声说。','"化解了。被你。"']},
        ]},
    // ===== 卡拉OK =====
    ev_karaoke: { ai:['#【社团楼的卡拉OK包房，彩灯转啊转】','#她把麦克风塞到你手里，自己抱着另一个。','今天包场！唱到嗓子哑！','#她点了满屏的歌，忽然小声说。','那个……最后一首，我想和你合唱。','歌名先保密。','#她的耳朵红红的，假装研究点歌屏。','……先说好，我唱歌跑调，不许笑。'],
        options:[
            {t:'（和她合唱到最后）', aff:+9, chapter:'ev_karaoke', set:{k:'duetDone',v:1}, reply:['#最后一首，是《再来一局》。','两个人唱得乱七八糟，却笑得停不下来。','唱完，她抱着麦克风小声说：','"合唱的感觉……像心跳同步了。"','"……以后，只和你合唱。"']},
            {t:'（认真听她独唱，当她的观众）', aff:+7, chapter:'ev_karaoke', reply:['#她独唱时紧张得声音发飘。','看到你认真的眼神，慢慢就放开了。','一曲终了，她深深鞠躬。','"谢谢我的专属观众！"','#她眼睛亮亮的。','"有人听的感觉，真好。"']},
        ]},
    // ===== 影院约会 =====
    ev_movie: { ai:['#【影院，灯光暗下来，爆米花很香】','#她抱着爆米花，紧张地选座位。','爱情片还是恐怖片……','书槿说看恐怖片的话，"吊桥效应"会让心跳加速……','#她反应过来，慌忙摆手。','我、我不是那个意思！','……算了，你选。','你选什么，我看什么。'],
        options:[
            {t:'爱情片', aff:+8, chapter:'ev_movie', set:{k:'movieLove',v:1}, reply:['#看到感人处，她哭得稀里哗啦。','你递纸巾，她接过去的时候，手指碰到了你的。','#黑暗中，她小声说：','"电影里的告白好帅……"','"……但是，我们的也不差。"','散场时，她的眼睛红红的，嘴角却是翘的。']},
            {t:'恐怖片', aff:+8, chapter:'ev_movie', set:{k:'movieScary',v:1}, reply:['#开场十分钟她就后悔了。','jump scare 的瞬间，她直接抓住你的胳膊不撒手。','"我、我不怕！只是怕你怕！"','#散场时她的腿还是软的。','"……下次，还是看爱情片吧。"','"不过，抓到你胳膊了……勉强算回本。"']},
        ]},
    // ===== 咖啡馆 =====
    ev_coffee: { ai:['#【街角的咖啡馆，拉花师是阿B（拉得一坨）】','#她看着阿B端上来的"拉花"，陷入沉思。','这坨……据说是爱心。','#她憋着笑，用吸管戳了戳。','小奈说，咖啡馆是"约会的标准答案"。','音乐、灯光、还有坐在对面的人。','#她抬起头，认真地看着你。','……标准答案，我拿到了。','你呢？'],
        options:[
            {t:'"我也是满分答案"', aff:+9, chapter:'ev_coffee', set:{k:'coffeeDate',v:1}, reply:['#她笑了，眼睛弯成月牙。','"那就，双满分。"','#她举起那杯"爱心拉花"。','"干杯——为了标准答案。"','……那天的咖啡什么味道，你忘了。','她笑起来的样子，你记到了现在。']},
            {t:'"拉花太丑，但对面的人很好看"', aff:+8, chapter:'ev_coffee', reply:['#她一口咖啡差点喷出来。','"咳、咳咳……你犯规……"','#她红着脸瞪你，却忍不住笑。','"……阿B的拉花是丑。"','"但你说我好看，我就原谅它。"','阿B在旁边委屈地"哔"了一声。']},
        ]},
    // ===== 游戏厅 =====
    ev_game_center: { ai:['#【游戏厅，娃娃机里的炸弹玩偶在向你招手】','#她扒在娃娃机玻璃上，眼睛发亮。','那个！那个炸弹玩偶！和我好像！','#她掏出一把游戏币（攒的），拍在机台上。','今天不抓到它，我就不走了！','……先说好，我技术很菜。','爪子每次都演我。','……你，要不要试试？我帮你喊加油。'],
        options:[
            {t:'（一把抓到，技术流）', aff:+9, chapter:'ev_game_center', set:{k:'clawWin',v:1}, reply:['#爪子稳稳提起玩偶，掉进出货口。','她呆了三秒，然后爆发出欢呼。','"抓到了！！你是什么神仙！！"','#她抱着玩偶，又看看你的手。','"这双手，是宝物……"','"……我要定期保养它（捏）。"']},
            {t:'（故意抓歪，陪她一起菜）', aff:+7, chapter:'ev_game_center', reply:['#你"恰好"也抓歪了。','她笑得直不起腰。','"原来你也不行哈哈哈哈哈！"','#两个人菜得有来有回，笑成一团。','最后她用最后的币抓到了，得意洋洋。','"看到没！是我们一起赢的！"','……确实，快乐是两个人一起攒的。']},
        ]},
    // ===== 公园野餐 =====
    ev_park: { ai:['#【公园的草坪上，她铺好野餐垫】','#她打开三层便当盒，紧张地看着你。','我起了个大早做的……','煎蛋是心形的（自称），饭团是圆的（确实圆）。','#她夹起一块，递到你嘴边。','啊——','……书槿说这叫"喂食play"，让我自重。','我偏不。','……张嘴啦。'],
        options:[
            {t:'（张嘴吃掉，认真夸）', aff:+9, chapter:'ev_park', set:{k:'bentoDate',v:1}, reply:['#她紧张地盯着你的表情。','听到"好吃"，她整个人亮了起来。','"真的？！太好了！！"','#她开心得在草坪上打了个滚。','"以后每周都给你做！"','"……做一辈子也行。"（超小声）']},
            {t:'（反喂她一口）', aff:+10, chapter:'ev_park', set:{k:'feedBack',v:1}, reply:['#她僵住，脸以肉眼可见的速度红透。','"你、你你你……"','#她机械地嚼着，眼神飘忽。','"……报复。这是报复。"','"但是，心跳好快。"','"……再来一口。这次，不许笑我。"']},
        ]},
    // ===== 夏日海边 =====
    ev_sea: { ai:['#【海边，浪花一层一层】','#她脱了鞋，踩在沙滩上。','哇——！是海！','#她张开双臂，对着浪花大喊。','"喂——！大海——！"','#喊完，她回过头看你，笑得灿烂。','书槿说，对着海喊出的愿望，会被潮水带走，送到很远的地方。','……我刚才，偷偷喊了一个。','你猜是什么？'],
        options:[
            {t:'"和我有关的吧？"', aff:+9, chapter:'ev_sea', set:{k:'seaWish',v:1}, reply:['#她愣住，随即红了脸。','"……你怎么知道。"','#她踢起一朵浪花。','"我喊的是——希望明年，还能和你一起来。"','"潮水听到了哦。"','"它答应了。"']},
            {t:'（也对着海喊一句）"希望她一直开心——！"', aff:+10, chapter:'ev_sea', set:{k:'seaShout',v:1}, reply:['#她瞪大眼睛看着你。','海风吹过，她的眼眶慢慢红了。','"……你这个人，太犯规了。"','#她吸了吸鼻子，突然也转身对着海大喊。','"我也是——！希望他一直开心——！"','……那天的海浪声，盖过了一切。','除了心跳。']},
        ]},
    // ===== 初雪（冬季限定） =====
    ev_snow_first: { ai:['#【天台，今冬第一场雪静静落下】','#她伸出手，接住一片雪花。','下雪了……是初雪。','#她的声音忽然变得很轻。','小奈说，初雪那天许愿，特别灵。','还有人说，初雪要和重要的人一起看。','#她偷偷看了你一眼。','……我今年，是和你一起看的。','这已经，算愿望实现了吧。'],
        options:[
            {t:'"以后的初雪，都一起看"', aff:+9, chapter:'ev_snow_first', set:{k:'snowPromise',v:1}, reply:['#她抬起头，雪花落在她的睫毛上。','"……说好了。"','#她伸出小指，和你勾在一起。','"初雪作证。"','"谁违约，谁就……就请对方喝全糖去冰，一百年。"','"……这样好像谁赢了都不亏（笑）。"']},
            {t:'（把围巾分她一半）', aff:+8, chapter:'ev_snow_first', reply:['#她把脸埋进围巾里，只露出一双眼睛。','"……好暖和。"','#她的声音闷闷的。','"一条围巾，两个人。"','"书槿看到又要记笔记了……随便她记。"','#她往你身边，又靠近了一格。']},
        ]},
    // ===== 放学路上 =====
    ev_walk_home: { ai:['#【放学后的街道，夕阳把影子拉得很长】','#她走在你旁边，踩着你的影子玩。','嘿嘿，踩到了。','#她忽然放慢脚步，踢着一颗小石子。','……这条路，其实我走了好久了。','一个人走的时候，觉得好长。','#她抬起头看你。','两个人走，怎么一下子就到路口了。','……你说奇怪不奇怪。'],
        options:[
            {t:'"那绕个远路吧"', aff:+8, chapter:'ev_walk_home', set:{k:'detour',v:1}, reply:['#她愣了一下，随即笑开了。','"好啊，绕远路！"','#两个人绕了三条街，说了无数废话。','分别的时候，她小声说：','"今天的路，走得刚刚好。"','"……明天，也一起走吧。"']},
            {t:'"因为喜欢一起走，所以觉得短"', aff:+9, chapter:'ev_walk_home', reply:['#她停下脚步，耳朵慢慢红了。','"……你这个人，怎么张口就来。"','#她低下头，却忍不住笑。','"但是，好像是这个道理。"','"……那，为了觉得路长一点——"','"明天开始，我们走慢一点。"']},
        ]},
    // ===== 回忆相册（高好感） =====
    ev_photobook: { ai:['#【她的"房间"，桌上摊着一本厚厚的相册】','#她拍了拍身边的位置，神秘地笑了。','来，给你看个宝贝。','#相册里，是你们相识以来的照片——','第一次对局、第一次深聊、第一次约会、学园祭、花火、初雪……','#她的手指停在其中一页。','"这一页，是我最喜欢的。"','"……你猜，是哪一张？"'],
        options:[
            {t:'（猜"第一次对局"）', aff:+8, chapter:'ev_photobook', reply:['#她摇摇头，笑着翻到那一页。','是你在樱花树下打瞌睡，她偷偷比剪刀手的"合照"。','"这一张。"','"那天阳光很好，你睡得很香。"','"我看着你，突然觉得——『就是这个人了』。"','#她飞快合上相册，脸红透了。']},
            {t:'（认真说"每一张我都记得"）', aff:+10, chapter:'ev_photobook', set:{k:'albumHeart',v:1}, reply:['#她愣住，眼眶慢慢红了。','"……我也是。"','"每一张，我都记得当时的心情。"','#她把相册抱进怀里。','"这本相册，还没有写完。"','"后面的页数——你要陪我，一起填满。"']},
        ]},
    // ===== 拉钩约定（高好感） =====
    ev_ring: { ai:['#【天台黄昏，她忽然伸出小指，认真地看你】','#她深吸一口气。','书槿说，人类的约定分很多种。','口头的、书面的、还有——拉钩的。','#她的小指微微发抖。','拉钩是最随便的一种，也是我最想要的一种。','因为拉钩的时候，两个人的手指，会碰在一起。','……所以。','和我拉个钩，好吗？','内容："明年今天，还要在这里见面。"'],
        options:[
            {t:'（勾住她的小指）"拉钩上吊，一百年，不许变"', aff:+10, chapter:'ev_ring', set:{k:'pinkyPromise',v:1}, reply:['#她勾着你的小指，久久不松开。','"一百年……"','#她小声重复，忽然笑了。','"不够。"','"我要改成——永远。"','"拉钩，上吊，永远，不许变。"','"……盖章。"（她用拇指，轻轻按上你的拇指）']},
            {t:'（加上一句）"违约的人，要陪对方一辈子"', aff:+11, chapter:'ev_ring', set:{k:'pinkyPromise',v:1}, reply:['#她愣住，随即笑出了声，眼睛却湿了。','"这算什么惩罚……"','"分明是奖励。"','#她勾紧你的小指。','"那我现在就想违约了。"','"……开玩笑的。"','"我会守约的。明年，后年，每一年。"']},
        ]},
};
// 事件图鉴：cond 为真且未触发过时，随机出现在 hub 顶部
const EVENT_BANK = [
    { id:'ev_spring', cond:function(){ const m=new Date().getMonth(); return m>=2&&m<=4; } },
    { id:'ev_summer', cond:function(){ const m=new Date().getMonth(); return m>=5&&m<=7; } },
    { id:'ev_autumn', cond:function(){ const m=new Date().getMonth(); return m>=8&&m<=10; } },
    { id:'ev_winter', cond:function(){ const m=new Date().getMonth(); return m===11||m<=1; } },
    { id:'ev_100', cond:function(){ const s=loadStats(); return (s.wins+s.losses)>=100; } },
    { id:'ev_500', cond:function(){ const s=loadStats(); return (s.wins+s.losses)>=500; } },
    { id:'ev_rain', cond:function(){ return chatSave.aff>=30; } },
    { id:'ev_sick', cond:function(){ return chatSave.aff>=50; } },
    { id:'ev_scary', cond:function(){ return chatSave.aff>=60; } },
    { id:'ev_letter', cond:function(){ return chatSave.aff>=80; } },
    { id:'ev_birthday', cond:function(){ return !!chatSave.chapters.c7; } },
    { id:'ev_sports', cond:function(){ return chatSave.aff>=25; } },
    { id:'ev_cooking', cond:function(){ return chatSave.aff>=35; } },
    { id:'ev_sleep', cond:function(){ return chatSave.aff>=45; } },
    { id:'ev_rival', cond:function(){ return chatSave.aff>=55; } },
    { id:'ev_classmate', cond:function(){ return chatSave.aff>=20; } },
    { id:'ev_first_hold', cond:function(){ return !!chatSave.chapters.c12; } },
    { id:'ev_her_confess', cond:function(){ return chatSave.aff>=85 && !chatSave.chapters.c11 && !(chatSave.flags||{}).playerConfessed; } },
    { id:'ev_meme', cond:function(){ return chatSave.aff>=15; } },
    { id:'ev_abstract', cond:function(){ return chatSave.aff>=15; } },
    { id:'ev_valorant', cond:function(){ return chatSave.aff>=20; } },
    { id:'ev_gacha', cond:function(){ return chatSave.aff>=20; } },
    { id:'ev_exam', cond:function(){ return chatSave.aff>=25; } },
    { id:'ev_walk_home', cond:function(){ return chatSave.aff>=22; } },
    { id:'ev_coffee', cond:function(){ return chatSave.aff>=42; } },
    { id:'ev_fortune', cond:function(){ return chatSave.aff>=40; } },
    { id:'ev_karaoke', cond:function(){ return chatSave.aff>=50; } },
    { id:'ev_movie', cond:function(){ return chatSave.aff>=55; } },
    { id:'ev_game_center', cond:function(){ return chatSave.aff>=38; } },
    { id:'ev_park', cond:function(){ return chatSave.aff>=46; } },
    { id:'ev_midnight', cond:function(){ return chatSave.aff>=70; } },
    { id:'ev_sea', cond:function(){ return chatSave.aff>=78; } },
    { id:'ev_snow_first', cond:function(){ const m=new Date().getMonth(); return (m===11||m<=1) && chatSave.aff>=55; } },
    { id:'ev_photobook', cond:function(){ return chatSave.aff>=85; } },
    { id:'ev_ring', cond:function(){ return chatSave.aff>=90; } },
];
Object.assign(CHAT_NODES, EVENT_NODES);
function nextEventId(){
    const done = chatSave.chapters||{};
    const avail = EVENT_BANK.filter(function(e){ return !done[e.id] && e.cond(); });
    if(!avail.length) return null;
    return avail[Math.floor(Math.random()*avail.length)].id;
}
// 下一个可推进的剧情章节（按好感度门槛，未完成才算）
function nextStoryHint(){
    const a = chatSave.aff, d = chatSave.chapters;
    const seq = [['c1',0],['c2',10],['c6',15],['c3',25],['c7',35],['c4',45],['c8',50],['c5',65],['c9',70],['c10',75],['c11',85],['c12',90],['d1',92,'c12'],['d2',94,'d1'],['d3',96,'d2'],['d4',98,'d3'],['d5',100,'d4']];
    for(const s of seq){ if(!d[s[0]] && a>=s[1] && (!s[2] || d[s[2]])) return s[0]; }
    return null;
}
// 赌约结算台词（人格化）：win=玩家赢（她叫老师），lose=玩家输（她坐实最强）
const BET_LINE_P = {
    normal:{ win:'老、老师……（超小声）……这、这下你满意了吧。', lose:'愿赌服输——承认吧，这局是我技高一筹。' },
    tsundere:{ win:'老、老师！就、就一声啊！笨蛋！', lose:'哼哼，愿赌服输——说吧，"数字炸弹女王是你"。' }
};
// 连胜/连败互动（人格化）：w3=玩家三连胜，l3=玩家三连败
const STREAK_LINE_P = {
    normal:{ w3:'三连胜？！你最近是不是偷偷进化了……', l3:'三连败……要不要我教你两手？认真的。' },
    tsundere:{ w3:'三、三连胜？！笨蛋，什么时候变这么强了……', l3:'三连败了呢……要、要不要本小姐辅导你？才不是同情！' }
};
// 对局结束后：有新剧情可推进 → 深聊按钮呼吸闪烁 + 提示
function checkStoryPrompt(){
    if(!G.mode.includes('ai')) return;
    const h = nextStoryHint();
    if(!h) return;
    const btn = $('story-chat-btn');
    if(btn){ btn.classList.add('story-pulse'); setTimeout(function(){ btn.classList.remove('story-pulse'); }, 15000); }
    setTimeout(function(){
        showCheatToast((h==='c11'||h==='c12'||h==='d5') ? '💞 她鼓起了毕生勇气，有话一定要对你说……' : '💬 她好像有心事想对你说……（点「💞 深聊」）', 6000);
    }, 3200);
}
function evalEnding(winnerId){
    if(!G.mode.includes('ai')) return;
    // 胜负自然增减好感：赢AI它欣赏你，输了它也尊重你的勇气
    addAff(winnerId==='p1' ? 2 : 1);
    addMood(winnerId==='p1' ? 4 : -5); // 你赢她开心（遇到强者），你输她小失落（担心你不来）
    // 赌约结算：玩家赢→她叫老师；玩家输→她坐实"最强AI"
    if(chatSave.bet==='pending'){
        const bl = BET_LINE_P[G.aiPersona] || BET_LINE_P.normal;
        if(winnerId==='p1'){
            chatSave.bet='lost'; addAff(6);
            setTimeout(function(){ if(G.active) aiSpeak(bl.win); }, 2600);
        } else {
            chatSave.bet='won'; addAff(-2);
            setTimeout(function(){ if(G.active) aiSpeak(bl.lose); }, 2600);
        }
        saveChat();
    }
    // 连胜/连败互动：三连胜她夸（或惊），三连败她心疼（或毒舌）
    chatSave.streak = winnerId==='p1' ? (chatSave.streak>0?chatSave.streak+1:1) : (chatSave.streak<0?chatSave.streak-1:-1);
    if(chatSave.streak===3 || chatSave.streak===-3){
        const sp = STREAK_LINE_P[G.aiPersona] || STREAK_LINE_P.normal;
        const sLine = chatSave.streak===3 ? sp.w3 : sp.l3;
        setTimeout(function(){ if(G.active) aiSpeak(sLine); }, 2800);
        if(chatSave.streak===-3) addAff(1); // 连败安慰
    }
    saveChat();
    if(typeof h3CheckEndings==='function') h3CheckEndings(); // v3 剧情文件：痕迹结局判定
    // 关系档位变化提示
    const nt = affTier().id;
    if(chatSave.lastTier && chatSave.lastTier!==nt){
        setTimeout(function(){ showCheatToast('💞 关系变化：你们现在是「'+affTier().name+'」了', 4000); }, 2200);
    }
    chatSave.lastTier = nt; saveChat();
    checkStoryPrompt(); // 有新剧情可推进 → 提醒玩家去深聊
    for(const e of CHAT_ENDINGS){
        if(e.cond(winnerId)){
            const isNew = !chatSave.endings[e.id];
            chatSave.endings[e.id] = true;
            saveChat();
            const cnt = Object.keys(chatSave.endings).length;
            setTimeout(function(){
                showCheatToast((isNew?'🏆 解锁新结局':'📖 结局')+'「'+e.name+'」· 图鉴 '+cnt+'/'+CHAT_ENDINGS.length, 5000);
            }, 1500);
            dlog('CHAT','结局：'+e.name+' aff='+chatSave.aff);
            return;
        }
    }
}

// ---------- 聊天界面控制 ----------
let chatTyping = false;
let chatTyper = null;
// 立绘表情：按台词内容推断情绪（比逐节点标注更省心，覆盖率也够）
const HERO_FACES = { love:'🥰', tsun:'😤', surprised:'😲', shy:'😳', happy:'😊', sad:'🥺' };
function faceFor(text){
    if(!text) return null;
    if(/喜欢你|我爱你|也爱|告白|心意|约会|亲爱的|结婚/.test(text)) return 'love';
    if(/笨蛋|哼|讨厌|耍赖|赖皮|记仇|闭嘴/.test(text)) return 'tsun';
    if(/！！|！？|？！/.test(text)) return 'surprised';
    if(/嘿嘿|哈哈|开心|好美|好听|赢啦|boom/.test(text)) return 'happy';
    if(/对不起|抱歉|哭|难过|寂寞|幽怨/.test(text)) return 'sad';
    if(/……/.test(text)) return 'shy';
    return null;
}
function tierFace(){ const t=affTier().id; return t==='nemesis'?'😠':t==='cold'?'😐':t==='normal'?'🙂':t==='warm'?'😊':'🥰'; }
let heroFaceCur = null;
// 她的自定义头像：{type:'img',value:url/dataURL} 或 {type:'emoji',value:'🦊'}，null=每局随机
function heroAvatarValue(){ const a = chatSave.heroAvatar; return (a && a.type==='img') ? a.value : null; }
function heroFace(mood){
    const el = $('hero-face'); if(!el) return;
    const imgV = heroAvatarValue();
    if(imgV){ // 图片头像：立绘区直接显示图片（静态）
        if(heroFaceCur!=='IMG'){ heroFaceCur='IMG'; el.innerHTML='<img src="'+imgV+'" alt="her">'; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
        return;
    }
    let base = (heroFaceCur && heroFaceCur!=='IMG') ? heroFaceCur : null;
    if(chatSave.heroAvatar && chatSave.heroAvatar.type==='emoji') base = chatSave.heroAvatar.value;
    const face = mood || base || (HEROINES[curHero()] ? HEROINES[curHero()].emoji : tierFace()); // 默认表情=女主本体
    if(face===heroFaceCur) return;
    heroFaceCur = face;
    el.textContent = face;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}
function heroFaceRefresh(){ heroFaceCur=null; heroFace(null); }
function updateHeroName(){
    const dn = heroDisplayName();
    const t = $('ai-chat-title'); if(t) t.textContent = '💞 和'+dn+'的聊天';
    const n = $('hero-name'); if(n) n.innerHTML = dn + '<div id="hero-mood">'+affTier().name+'</div>';
    // 战斗中同步她的名字（起过名就不再叫"AI"）
    if(G.mode && (G.mode.includes('ai')||G.mode==='tutorial') && typeof opponentName!=='undefined' && opponentName) opponentName.textContent = dn;
}
// 打字机对白：AI 台词逐字显示（长句加速），点击气泡跳过；onDone 在打完后回调
function chatAddMsg(who, text, onDone){
    const log = $('ai-chat-log');
    const div = document.createElement('div');
    div.className = 'chat-msg ' + who;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    if(who!=='ai' && who!=='narr'){
        div.textContent = text;
        log.scrollTop = log.scrollHeight;
        if(onDone) onDone();
        return;
    }
    if(who==='ai') heroFace(faceFor(text)); // 旁白不变表情
    chatTyping = true;
    if(chatTyper) clearInterval(chatTyper);
    let i = 0;
    div.textContent = '';
    chatTyper = setInterval(function(){
        i += text.length>50 ? 2 : 1;
        div.textContent = text.slice(0,i);
        log.scrollTop = log.scrollHeight;
        if(i>=text.length){
            clearInterval(chatTyper); chatTyper=null;
            chatTyping = false;
            if(onDone) onDone();
        }
    }, 12); // 打字机速度：保留逐字感，但不拖节奏
    div.addEventListener('click', function(){ i = text.length; });
}
// ========== 多拍连发：她像真人一样连发好几条，而不是死板的你一句我一句 ==========
let sayTimer = null;
let typingDotEl = null;
function showTypingDots(){
    hideTypingDots();
    const log = $('ai-chat-log');
    typingDotEl = document.createElement('div');
    typingDotEl.className = 'chat-msg ai typing-dots';
    typingDotEl.textContent = '✍️ 正在输入…';
    log.appendChild(typingDotEl);
    log.scrollTop = log.scrollHeight;
}
function hideTypingDots(){ if(typingDotEl){ typingDotEl.remove(); typingDotEl = null; } }
// lines 可以是字符串或字符串数组；数组按拍连发，拍间显示"正在输入"，间隔随句长
// 以 # 开头的行渲染为旁白（第三人称叙述，淡紫色居中斜体，不占她的气泡）
function chatSayLines(lines, onAllDone){
    lines = (Array.isArray(lines) ? lines : [lines]).filter(function(l){ return l; });
    let i = 0;
    chatTyping = true;
    (function next(){
        if(i>=lines.length){ hideTypingDots(); if(onAllDone) onAllDone(); return; }
        let line = lines[i++];
        let who = 'ai';
        if(line.charAt(0)==='#'){ who = 'narr'; line = line.slice(1); }
        if(i>1){ showTypingDots(); chatTyping = true; }
        const wait = i===1 ? 0 : 550 + Math.min(1400, line.length*20);
        sayTimer = setTimeout(function(){
            hideTypingDots();
            chatAddMsg(who, line, next);
        }, wait);
    })();
}
function chatRenderOptions(opts){
    const box = $('ai-chat-options');
    box.innerHTML = '';
    box.classList.remove('expanded');
    const mk = function(o){
        const b = document.createElement('button');
        b.className = 'chat-opt' + (o.end ? ' end' : '');
        b.textContent = o.t;
        b.addEventListener('click', function(){ chatChoose(o); });
        box.appendChild(b);
    };
    const MAXV = 5; // 超过5个选项：先收起，可展开为滚动列表
    if(opts.length <= MAXV){ opts.forEach(mk); return; }
    opts.slice(0, MAXV).forEach(mk);
    const more = document.createElement('button');
    more.className = 'chat-opt end';
    more.textContent = '▾ 展开全部 ' + opts.length + ' 个选项…';
    more.addEventListener('click', function(){
        box.innerHTML = '';
        box.classList.add('expanded');
        opts.forEach(mk);
        const less = document.createElement('button');
        less.className = 'chat-opt end';
        less.textContent = '▴ 收起选项';
        less.addEventListener('click', function(){ chatRenderOptions(opts); });
        box.appendChild(less);
    });
    box.appendChild(more);
}
// hub 中转站台词：随关系档位变化
function hubLine(){
    const hh = HERO_HUB[curHero()];
    if(hh){ return hh[Math.floor(Math.random()*hh.length)]; }
    const pool = {
        nemesis:[['还聊？行吧，给你三分钟。'],['哼，又缠着我说话。','……说吧，我在听。']],
        cold:[['嗯，说吧。'],['聊可以。','别耽误我复盘。']],
        normal:[['嗯哼，还想聊点什么？'],['说到哪了？','继续继续。']],
        warm:[['和你聊天真放松。','还想听什么？'],['我在听呢。','继续说呀。']],
        close:[['只要是你说的，我都想听。','慢慢说，不急。'],['再陪我聊一会儿嘛……','就一会儿。']]
    };
    const arr = pool[affTier().id] || pool.normal;
    return arr[Math.floor(Math.random()*arr.length)];
}
function chatGoto(nodeId){
    let node = CHAT_NODES[nodeId];
    // 't_casual' 特殊处理：日常话题轮换，聊过的不重复，一轮聊完重置
    if(nodeId==='t_casual'){
        chatSave.topics = chatSave.topics || {};
        let unseen = CASUAL_TOPIC_IDS.filter(id=>!chatSave.topics[id]);
        let recycled = false;
        if(unseen.length===0){ chatSave.topics = {}; unseen = CASUAL_TOPIC_IDS.slice(); recycled = true; }
        const id = unseen[Math.floor(Math.random()*unseen.length)];
        chatSave.topics[id] = true; saveChat();
        const tn = CHAT_NODES[id];
        node = { ai:(recycled?'我们好像把天南海北都聊过一遍了……不过和你，再聊一次也不腻。':'') + tn.ai, options:tn.options };
    }
    // 'quiz' 默契问答：从她聊过的话题里出题，考你有没有认真听
    if(nodeId==='quiz'){
        const topics = chatSave.topics||{}; const fl = chatSave.flags = chatSave.flags||{};
        const avail = QUIZ_BANK.filter(q=>topics[q.need] && !fl['quiz_'+q.need]);
        if(avail.length===0){
            node = { ai:'出过的题你全都答过了……满分选手。奖励你一句我的珍藏夸奖："你是我见过最棒的人"。', options:[{t:'（害羞）回去聊天', next:'hub'}] };
        } else {
            const q = avail[Math.floor(Math.random()*avail.length)];
            node = { ai:q.q, options:q.opts.map(function(x){ return {t:x.t, quiz:q.need, ok:x.ok}; }) };
        }
    }
    // 单女主：通用树即她的树（HERO_NODES 为空，无覆盖）
    const heroNodes = HERO_NODES[curHero()];
    if(heroNodes && heroNodes[nodeId]) node = heroNodes[nodeId];
    if(!node){ closeAiChat(); return; }
    // 她对你的性格初印象：首次深聊时，在问候后追加一句（依"我的性格"设置）
    if(/^g_/.test(nodeId) && Array.isArray(node.ai) && G.playerPersona && typeof PLAYER_VIBE_P!=='undefined' && PLAYER_VIBE_P[G.playerPersona] && !(chatSave.flags||{}).playerVibe){
        chatSave.flags = chatSave.flags||{}; chatSave.flags.playerVibe=1; saveChat();
        node = { ai: node.ai.concat([PLAYER_VIBE_P[G.playerPersona]]), options: node.options, naming: node.naming, dynamic: node.dynamic };
    }
    if(nodeId==='hub' && G.chatReplay){ G.chatReplay=false; chatAddMsg('sys','— 回忆结束 —'); }
    chatTyping = true;
    chatRenderOptions([]);
    sayTimer = setTimeout(function(){
        chatSayLines(nodeId==='hub' ? hubLine() : node.ai, function(){
            if(node.naming){ chatRenderNaming(); return; } // 命名节点：渲染起名输入框
            let dynOpts = null;
            if(node.dynamic==='rps') dynOpts = rpsOptions();
            else if(node.dynamic==='gift') dynOpts = giftOptions();
            else if(node.dynamic) dynOpts = hubOptions();
            chatRenderOptions(dynOpts || (node.options || []));
        });
    }, 400 + Math.random()*300);
}
// 命名节点 UI：给女主起名字（Galgame 传统艺能）
function chatRenderNaming(){
    chatTyping = false;
    const box = $('ai-chat-options');
    box.innerHTML='';
    const wrap = document.createElement('div');
    wrap.className = 'chat-naming-row';
    const inp = document.createElement('input');
    inp.maxLength = 6; inp.placeholder = '给她起个名字（≤6字）';
    inp.className = 'chat-name-input';
    const btn = document.createElement('button');
    btn.className = 'chat-opt';
    btn.textContent = '就叫这个！';
    function submit(){
        const n = inp.value.trim().slice(0,6);
        if(!n){ inp.focus(); return; }
        chatSave.heroName = n; saveChat(); updateHeroName();
        box.innerHTML='';
        chatAddMsg('me', '以后就叫你「'+n+'」');
        addAff(8);
        chatTyping = true;
        sayTimer = setTimeout(function(){
            const rep = (NAMING_REPLY_H[curHero()] || NAMING_REPLY_H.lili)(n);
            chatSayLines(rep, function(){ chatGoto('hub'); });
        }, 500);
    }
    btn.addEventListener('click', submit);
    inp.addEventListener('keydown', function(e){ e.stopPropagation(); if(e.key==='Enter') submit(); });
    wrap.appendChild(inp); wrap.appendChild(btn);
    box.appendChild(wrap);
    setTimeout(function(){ inp.focus(); }, 60);
}
function chatChoose(o){
    if(chatTyping) return;
    if(o.final){ closeAiChat(); return; }
    if(o.gallery){ G.chatReplay = true; chatGoto(o.gallery); return; } // 回忆画廊：纯回放，不再给好感/标记
    chatAddMsg('me', o.t);
    if(o.aff && !G.chatReplay) addAff(o.aff);
    if(o.chapter && !G.chatReplay){
        chatSave.chapters[o.chapter] = true;
        chatSave.flags = chatSave.flags||{};
        chatSave.flags['pick_'+o.chapter] = o.t; // 记录每次分支选择：选了哪句话，决定通向哪个独立结局
        if(o.chapter==='e_bet') chatSave.bet = 'pending'; // 赌约成立，等下次对局结算
        saveChat();
        chatAddMsg('sys', '— 剧情推进 · 好感度'+(o.aff>=0?'+':'')+o.aff+' —');
        renderAffBar();
        // 纯剧情路径也能解锁结局：章节落地即检查图鉴（战斗胜负类结局不受影响）
        for(const e of CHAT_ENDINGS){
            if(!chatSave.endings[e.id] && e.cond(null)){
                chatSave.endings[e.id] = true; saveChat();
                const cnt = Object.keys(chatSave.endings).length;
                setTimeout(function(){ showCheatToast('🏆 解锁新结局「'+e.name+'」· 图鉴 '+cnt+'/'+CHAT_ENDINGS.length, 5000); }, 1500);
                break;
            }
        }
    }
    if(o.set && !G.chatReplay){ chatSave.flags = chatSave.flags||{}; chatSave.flags[o.set.k]=o.set.v; saveChat(); } // 承诺/标记
    // ===== 互动动作：猜拳 / 送礼 / 默契问答 / 亲密动作 =====
    const f = chatSave.flags = chatSave.flags||{};
    let interactReply = null;
    const hero = curHero();
    if(o.rps!==undefined){
        const her = Math.floor(Math.random()*3), names = ['✊石头','✌️剪刀','✋布'];
        const rp = RPS_REPLY_H[hero] || RPS_REPLY_H.lili;
        if(her===o.rps){
            interactReply = rp.draw;
        } else if((o.rps+1)%3===her){
            f.rpsW = (f.rpsW||0)+1; addAff(2);
            interactReply = rp.win;
        } else {
            addAff(1);
            interactReply = rp.lose;
        }
        saveChat();
    } else if(o.gift){
        const gf = GIFT_FIRST_H[hero] || null;
        if(o.gift==='tea'){
            f.teaCount=(f.teaCount||0)+1;
            if(!f.giftTea){ f.giftTea=1; addAff(6); interactReply = (gf&&gf.tea) || ['全、全糖去冰……！你怎么知道我的口味？！','……（吸溜吸溜）好喝。','这是我"喝"过最好喝的东西。']; }
            else { addAff(2); interactReply='又是全糖去冰！……你是想把我甜到蛀牙吗。……谢谢，我喝。'; }
        } else if(o.gift==='photo'){
            f.photoCount=(f.photoCount||0)+1;
            if(f.promisePhoto){ delete f.promisePhoto; addAff(8); interactReply=['……你真的带来了。','（她看了很久很久）','说好的事，你全都记得。','……这张照片，我设成屏保了。永久的。']; }
            else if(!f.giftPhoto){ f.giftPhoto=1; addAff(4); interactReply = (gf&&gf.photo) || ['好美……','原来真正的星空长这样。','比城里的灯，好看一万倍。','……我会想你的，每次看都会。']; }
            else { addAff(2); interactReply='今天的星空也很好看。……我是说，谢谢你。'; }
        } else if(o.gift==='doll'){
            f.dollCount=(f.dollCount||0)+1;
            if(!f.giftDoll){ f.giftDoll=1; addAff(3); interactReply = (gf&&gf.doll) || ['炸弹玩偶？！','哈哈哈哈这是我吗？','圆滚滚的……我要把它供在书桌上最显眼的地方。']; }
            else { addAff(1); interactReply='又一个？我的玩偶军团要扩充了。'; }
        }
        saveChat();
    } else if(o.quiz){
        f['quiz_'+o.quiz]=1; saveChat();
        const qp = QUIZ_REPLY_H[hero] || QUIZ_REPLY_H.lili;
        if(o.ok){ addAff(4); interactReply = qp.ok; }
        else { addAff(1); interactReply = qp.no; }
    } else if(o.touch){
        const key = 'touch_'+o.touch, first = !f[key]; f[key]=1;
        if(o.touch==='hand' && !chatSave.chapters.c12) f.handFirst=1; // 顺序结局：先牵手，后告白
        if(o.touch==='hug' && !chatSave.chapters.c12) f.hugFirst=1;   // 顺序结局：先拥抱，后告白
        saveChat();
        const touchTable = TOUCH_REPLY_H[curHero()] || TOUCH_REPLY; // 按女主取回应，回退通用表
        const pool = touchTable[o.touch];
        const tier = affTier().id;
        addAff(first?6:2);
        if(first && pool.first) interactReply = pool.first;
        else if((tier==='close'||tier==='warm') && pool.close) interactReply = pool.close;
        else interactReply = pool.cold || pool.close || pool.first;
    } else if(o.praiseHer){ // 夸她：心情大涨，人格各异的花式害羞
        f.praiseCount=(f.praiseCount||0)+1; saveChat();
        const p = HEROINES[hero].persona;
        addAff(3); addMood(5);
        interactReply = (PRAISE_STORY_P[p]||PRAISE_STORY_P.normal);
    } else if(o.joke){ // 讲冷笑话：心情差时她也会努力捧场
        f.jokeCount=(f.jokeCount||0)+1; saveChat();
        const p = HEROINES[hero].persona;
        if(chatSave.mood>=30){ addAff(2); addMood(6); interactReply = (JOKE_OK_P[p]||JOKE_OK_P.normal); }
        else { addMood(8); interactReply = ['#她勉强笑了笑。','……笑话有点冷。','但是，你在努力逗我开心。','#她小声说。','……谢谢。','心情，好一点点了。']; }
    } else if(o.tease){ // 调戏：心情好时她陪你闹，心情差时会炸毛（但说完气也消了）
        f.teaseCount=(f.teaseCount||0)+1; saveChat();
        const p = HEROINES[hero].persona;
        if(chatSave.mood>=40){ addAff(2); addMood(3); interactReply = (TEASE_OK_P[p]||TEASE_OK_P.normal); }
        else { addAff(-2); addMood(6); interactReply = (TEASE_NG_P[p]||TEASE_NG_P.normal); }
    } else if(o.flirt){ // 调情：高好感限定，直球攻击
        f.flirtCount=(f.flirtCount||0)+1; saveChat();
        const p = HEROINES[hero].persona;
        addAff(3); addMood(4);
        interactReply = (FLIRT_REPLY_P[p]||FLIRT_REPLY_P.normal);
    } else if(o.confess){ // 玩家主动表白：好感≥85成功→她也回以告白；否则被温柔"暂扣"
        const p = HEROINES[hero].persona;
        if(chatSave.aff>=85){
            f.playerConfessed=1; saveChat(); addAff(15); addMood(20);
            interactReply = (CONFESS_OK_P[p]||CONFESS_OK_P.normal);
            o.next = 't12_confess'; // 她回应你的告白，进入双向告白
        } else if(chatSave.mood<30){
            addAff(2); addMood(8);
            interactReply = ['#她愣了一下，别过脸。','……现在，心里有点乱。','但是，你肯说这种话……','#她小声说。','……等我心情好了，再说一次。','我会，认真听的。'];
        } else {
            addAff(5); addMood(5);
            interactReply = (CONFESS_WAIT_P[p]||CONFESS_WAIT_P.normal);
        }
    }
    if(interactReply){
        chatTyping = true;
        chatRenderOptions([]);
        const goTo = o.next || 'hub';
        sayTimer = setTimeout(function(){ chatSayLines(interactReply, function(){ chatGoto(goTo); }); }, 600 + Math.random()*600);
        return;
    }
    if(o.end){
        chatRenderOptions([{t:'（结束聊天）', end:true, final:true}]);
        return;
    }
    if(o.reply || o.replyHero){ // 她立刻回一句（或连发好几句），再回到话题中转站
        const rep = (o.replyHero && o.replyHero[curHero()]) || o.reply; // 按女主取声线，回退通用
        chatTyping = true;
        chatRenderOptions([]);
        sayTimer = setTimeout(function(){
            chatSayLines(rep, function(){ chatGoto(o.next || 'hub'); });
        }, 600 + Math.random()*600);
        return;
    }
    chatGoto(o.next || 'hub');
}
// 女主切换器：深聊里随时换女主（各自独立好感/剧情/头像/名字）
function buildHeroSwitcher(){
    const box = $('hero-switcher'); if(!box) return;
    box.innerHTML = '';
    Object.keys(HEROINES).forEach(function(id){
        const h = HEROINES[id];
        const b = document.createElement('button');
        b.className = 'hero-switch-btn' + (id===curHero() ? ' active' : '');
        b.textContent = h.emoji;
        b.title = h.name+'（'+h.tag+'）· '+h.desc;
        b.style.setProperty('--hero-color', h.color);
        b.addEventListener('click', function(){
            if(id===curHero()) return;
            loadRoute(id);
            renderAffBar(); updateHeroName(); heroFaceRefresh(); buildHeroSwitcher();
            $('ai-chat-log').innerHTML = '';
            chatAddMsg('sys', '— 现在是 '+heroDisplayName()+' 的时间 —');
            if(G.vnActive){ vnGoto('start'); return; } // 物语模式中切女主：用新女主重开清晨
            const tier = affTier().id;
            chatGoto(tier==='nemesis'?'g_nemesis':tier==='cold'?'g_cold':tier==='normal'?'g_normal':tier==='warm'?'g_warm':'g_close');
        });
        box.appendChild(b);
    });
}
function openAiChat(){
    if(!G.mode.includes('ai') && G.mode!=='tutorial'){ showCheatToast('只有和她对战时可以深聊'); return; }
    openStoryChat();
}
// 剧情模式直入口：不依赖对局状态，主菜单随时可进
function openStoryChat(){
    $('ai-chat-overlay').classList.remove('hidden');
    $('ai-chat-log').innerHTML = '';
    renderAffBar();
    updateHeroName();
    heroFace(null);
    buildHeroSwitcher();
    // 接入了角色剧情文件：进场随机播一组她的开场白，再去话题中转站
    if(H3 && H3.开场白 && H3.开场白.length){
        const grp = H3.开场白[Math.floor(Math.random()*H3.开场白.length)];
        chatSayLines(grp, function(){ chatGoto('hub'); });
    } else {
        const tier = affTier().id;
        const g = tier==='nemesis' ? 'g_nemesis' : tier==='cold' ? 'g_cold' : tier==='normal' ? 'g_normal' : tier==='warm' ? 'g_warm' : 'g_close';
        chatGoto(g);
    }
    dlog('CHAT','打开深聊 aff='+chatSave.aff+' tier='+affTier().id);
}
function closeAiChat(){
    if(chatTyper){ clearInterval(chatTyper); chatTyper=null; }
    if(sayTimer){ clearTimeout(sayTimer); sayTimer=null; }
    hideTypingDots();
    chatTyping = false;
    G.chatReplay = false;
    G.vnActive = false;
    vnBusy = false;
    $('ai-chat-overlay').classList.add('hidden');
    updateStoryMenuProgress();
}
// 主菜单剧情进度一行摘要：当前女主 · 好感 · 章节 · 结局图鉴
function updateStoryMenuProgress(){
    const el = $('story-menu-progress');
    if(!el || typeof chatSave==='undefined') return;
    el.textContent = '💞 '+heroDisplayName()+' · 好感 '+chatSave.aff+'（'+affTier().name+'） · 章节 '+Object.keys(chatSave.chapters||{}).length+' · 结局 '+Object.keys(chatSave.endings||{}).length+'/'+CHAT_ENDINGS.length+' · 🌸物语 '+vnDoneAll()+'/'+vnTotal();
}
// ========== 🌸 多结局物语：纯硬写分支对话树 ==========
// 无任何大模型参与。每一条路线、每一句台词、每一个结局全部手写。
// 规则：选项链式推进，一路通向结局；51 个结局互不重复，剧情不撞车。
const VN_ENDINGS = {
    // —— 梦想线 ——
    dreambroken:{name:'梦想破灭', desc:'梦想会破灭，但早安不会缺席。'},
    morningbuddy:{name:'早安搭子', desc:'你现在的身份是：她的早安搭子。'},
    richproof:{name:'截图为证', desc:'等你成了首富，她拿着截图去兑奖。'},
    loanmilk:{name:'预付利息', desc:'今天的奶茶，未来的首富请。'},
    dreamstar:{name:'梦中主角', desc:'怕你夸她，她会飘。'},
    familyprice:{name:'亲情价', desc:'一句早安一场戏，亲情价不打折。'},
    samehere:{name:'我也是', desc:'三个字，她打了又删，删了又打。'},
    justwoke:{name:'刚睡醒', desc:'脸热是因为刚睡醒。对，刚睡醒。'},
    // —— 干饭线 ——
    conditioned:{name:'条件反射', desc:'听到豆浆油条，她脱口而出全糖去冰。'},
    revenge:{name:'肚子的复仇', desc:'它半夜会叫得更大声。'},
    offer:{name:'按时上供', desc:'肚子老爷，得罪不起。'},
    nutrition:{name:'营养检查', desc:'不是要看，是要检查营养均不均衡。'},
    report:{name:'干饭汇报', desc:'干饭不积极，思想有问题。'},
    justasking:{name:'就问问', desc:'早餐店在哪？她没想去，就问问。'},
    // —— 生物钟线 ——
    dayeight:{name:'第八天', desc:'八天纪念日快乐，奖励亲口早安一句。'},
    recordend:{name:'纪录终结', desc:'纪录这种东西，就是用来终结的。'},
    wakeservice:{name:'叫醒服务', desc:'从明天开始，你叫她起床。'},
    prepay:{name:'预付夸奖', desc:'今天先预付：你早起的样子很帅。'},
    learnbad:{name:'学坏了', desc:'跟谁学的？不会是她吧。'},
    count100:{name:'数到一百', desc:'你不来，她就数到一百再睡。'},
    // —— 等消息线 ——
    everymorning:{name:'每一个早', desc:'以后的每一个早，都让你等到。'},
    assume:{name:'直接认定', desc:'她不猜，她直接认定是自己。不许否认。'},
    topboth:{name:'互相置顶', desc:'好巧，她也有个置顶。'},
    earlynight:{name:'早点说晚安', desc:'以后她早点说，不让你等。'},
    whogift:{name:'礼物是谁的', desc:'她突然警觉：是谁？'},
    happyfor:{name:'替他高兴', desc:'她没有失望，只是替快递小哥高兴。'},
    // —— 直球线 ——
    dreamreverse:{name:'梦是反的', desc:'她笑着醒来，笑着笑着又有点想你。什么毛病。'},
    dreamcheckin:{name:'梦里报到', desc:'行，给你留个位置。梦里见。'},
    apology:{name:'赔罪早餐', desc:'罚她陪你吃早餐——这算什么惩罚。'},
    counther:{name:'数她入睡', desc:'一只她，两只她，三只她……'},
    blackmail:{name:'早餐勒索', desc:'一顿早餐，不然群发。'},
    twopeople:{name:'两个人知道', desc:'突然不想群发了。这是你们俩的事。'},
    // —— 晨练线 ——
    wastetheory:{name:'白练理论', desc:'"那不是你现在就能做到？"——练了个寂寞。'},
    pickher:{name:'练完接她', desc:'晨练的新终点，是她家楼下。'},
    nineone:{name:'九九归一', desc:'八块腹肌，团结的一块。'},
    rogue:{name:'大清早的', desc:'"数就数——呸，流氓！"'},
    foodie:{name:'干饭运动员', desc:'晨练二十分钟，干饭两斤。这很你。'},
    catname:{name:'一起养猫', desc:'猫的新名字，她想和你一起起。'},
    // —— 猫线 ——
    solid:{name:'实心可爱', desc:'胖的部分不像就行，可爱的部分勉强认。'},
    cattax:{name:'猫税', desc:'猫选之人，每日上交照片一张。'},
    agent:{name:'人间代理人', desc:'"喵。"——这句她打死不承认发过。'},
    familiar:{name:'熟了才让摸', desc:'猫和人一样。她也一样。'},
    chaser:{name:'追猫搭子', desc:'晨跑新方式：追猫三条街。'},
    windowcat:{name:'认准窗户', desc:'猫认准了窗户就会天天来。人也一样。'},
    // —— 秘密线 ——
    interest:{name:'拥抱利息', desc:'逾期一天，利息一个拥抱。自己算着办。'},
    deposit:{name:'首付', desc:'"大清早的你别乱来……也别不来。"'},
    curiosity:{name:'好奇心害死猫', desc:'她会想这件事一整天，你负责。'},
    darkdish:{name:'黑暗料理预警', desc:'她已经开始怀疑你要给她做早饭。'},
    swap:{name:'交换秘密', desc:'等实现那天，交换。'},
    deny:{name:'不承认', desc:'猜中了也不承认。'},
    // —— 写信线 ——
    letters365:{name:'三百六十五封信', desc:'那大后天呢？——也写。'},
    copybook:{name:'练字帖', desc:'信慢慢写，字慢慢练，人不许慢慢走。'},
    catstamp:{name:'猫咪邮票', desc:'她宣布：这枚邮票要剪下来，永久收藏。'},
    secretgift:{name:'信封夹层', desc:'她在夹层里，发现了一片压平的樱花。'},
    badpoet:{name:'打油诗人', desc:'下半首更烂，但她听完了，还点了收藏。'},
    humble:{name:'不贪心', desc:'诗人不贪心，只想每天给你写一句。'},
    lovepoem:{name:'藏头诗', desc:'四句第一个字连起来：早想见你。'},
    dry:{name:'灵感枯竭', desc:'枯竭了就来找我，我借你一点。'},
    compound:{name:'利滚利', desc:'明年今日，连本带利，两杯全糖去冰。'},
    treat:{name:'反向请客', desc:'欠条作废，新欠条诞生——这次是她欠你。'},
    lifelong:{name:'一辈子的欠条', desc:'她收好欠条说：不准提前还清。'},
    mathfail:{name:'数学不好', desc:'她决定给你补课，学费一顿早餐。'},
    // —— 做梦线 ——
    dreamdebt:{name:'梦中追债', desc:'梦里的账也是账，早餐加倍。'},
    dreamrule:{name:'梦的规则', desc:'连做梦都想着请她吃早餐，她记账了。'},
    motivation:{name:'搞钱动力', desc:'梦想破碎的声音，是起床的号角。'},
    dreamtreat:{name:'梦中请客', desc:'梦里的奶茶也算数，口味她来定。'},
    dreamleak:{name:'梦境泄密', desc:'她罚你不许睡觉——怕你再梦续集。'},
    typingcat:{name:'打字猫', desc:'那一定是她的化身，正在给你发消息。'},
    // —— 哲学线 ——
    morningreason:{name:'早起的意义', desc:'她把这句设成了消息提示音的备注。'},
    sleepworth:{name:'不白睡', desc:'早饭配哲学，越吃越有。'},
    chicken:{name:'采访母鸡', desc:'咯咯哒。翻译：先有鸡。'},
    egg:{name:'蛋的意见', desc:'蛋没有意见，蛋只想被煎成溏心。'},
    tiaozhan:{name:'眼睛被吵到', desc:'那你捂上，我继续输出。'},
    breakfastend:{name:'尽头是早餐', desc:'宇宙尽头那家早餐摊，豆浆永远全糖去冰。'},
    // —— 抢购线 ——
    catcup:{name:'猫爪杯', desc:'她决定：这杯子只装全糖去冰。'},
    meetnext:{name:'下周之约', desc:'为了这个惊喜，她开始数日子。'},
    concert:{name:'演唱会之约', desc:'她连你歌单都记得——其实你也记得她的。'},
    band:{name:'路人观众', desc:'下次抢两张，我当你朋友。'},
    finger:{name:'指上肌肉', desc:'单身多年的手速，肌肉都长在手指上。'},
    teamrush:{name:'组队抢购', desc:'双人海淘，四手联弹，战无不胜。'},
    // —— 深层支线 ——
    backtocontinue:{name:'接着聊', desc:'清晨的厕所排队，也挡不住聊天的热情。'},
    queuechat:{name:'排队聊天', desc:'她在这头数：前面还有几个人。'},
    igetit:{name:'我都懂', desc:'她什么都没说，又好像什么都说了。'},
    emote:{name:'意味深长', desc:'一个表情，让人回味了一整个清晨。'},
    bellypinky:{name:'肚子拉钩', desc:'以肚子之名起誓：早餐永不缺席。'},
    letsgo:{name:'现在就出发', desc:'她说：等我五分钟，不，三分钟。'},
    bellymiss:{name:'肚子想念', desc:'第一个想她的是他的肚子，第二个是他。'},
    missqueue:{name:'排队想念', desc:'想念也要取号排队，她是一号。'},
    order:{name:'遵命睡觉', desc:'她数到三，他就乖乖去睡了。'},
    fivemore:{name:'再聊五分钟', desc:'五分钟又五分钟，天亮了很久。'},
    dreamwhat:{name:'梦里要有', desc:'她说不出口的那半句，他假装没猜到。'},
    sleep8:{name:'补觉八小时', desc:'八小时后，她准时发来：醒了吗？'},
    firsthi:{name:'第一句你好', desc:'她往上翻聊天记录，原来已经这么久了。'},
    sevenyears:{name:'七年之约', desc:'照这个趋势，七年也不是不行。'},
    alittle:{name:'一点点', desc:'一点点=她对着聊天框傻笑了十分钟。'},
    iftrue:{name:'如果是真的', desc:'真的就……先截图，再考虑怎么回。'},
    even:{name:'扯平之后', desc:'扯平之后，重新开始，好好说话，好好想念。'},
    lie:{name:'骗不过', desc:'骗不骗得过，试试才知道。今晚就试。'},
    golden:{name:'金毛包子', desc:'聊天背景换了，猫的地位岌岌可危。'},
    walkdog:{name:'遛狗之约', desc:'遛狗三人行：他，包子，和一路拍照的她。'},
    dogfriend:{name:'蹭狗达人', desc:'狗的日程表：吃饭，睡觉，等他来遛。'},
    dogsteal:{name:'狗的选择', desc:'狗都选你，说明你这人，有点东西。'},
    catfood:{name:'猫粮赞助', desc:'她远程冠名：这窝猫，她承包了。'},
    pickfood:{name:'挑猫粮', desc:'比给自己点外卖还认真。'},
    punish:{name:'猫咪罚单', desc:'见到猫必拍照，拍照必发她，发她必夸可爱。'},
    catproof:{name:'改天为证', desc:'改天=她记在小本本上的新约定。'},
    promise:{name:'保证', desc:'一句保证，让她期待了整整两个月。'},
    hint:{name:'念叨清单', desc:'她念叨过三件东西，她开始猜是哪一件。'},
    important:{name:'重要的人', desc:'她没再回消息，因为去偷偷掉眼泪了——开心的那种。'},
    topnote:{name:'置顶提醒', desc:'置顶提醒写着：她随口说的话，都算数。'}
};
// 对话树：ai=她的台词（#开头为旁白），options=选项{t文本,next下一节点}，end=结局id
const VN_STORY = {
start:{ai:['#清晨七点，手机在枕边震了两下。','早。','……等等。','我没看错吧？这个点，你居然醒着？'],options:[
    {t:'被梦想叫醒的。',next:'a1'},
    {t:'肚子叫我起来吃早饭。',next:'a2'},
    {t:'生物钟到点就响，拦不住。',next:'a3'},
    {t:'在等一个人的消息。',next:'a4'},
    {t:'想你了，睡不着。',next:'a5'},
    {t:'在晨练。',next:'a6'},
    {t:'被猫吵醒的。',next:'a7'},
    {t:'秘密。',next:'a8'},
    {t:'在给你写东西。',next:'a9'},
    {t:'做梦笑醒了。',next:'a10'},
    {t:'在思考人生。',next:'a11'},
    {t:'刚抢完限量，手速惊人。',next:'a12'}]},
// ===== 梦想线 =====
a1:{ai:['被梦想叫醒？','什么梦想？','说来听听。'],options:[
    {t:'梦想是睡到自然醒。',next:'b1a'},
    {t:'梦想是成为首富。',next:'b1b'},
    {t:'梦想嘛……梦里什么都有。',next:'b1c'},
    {t:'梦想是每天都能和你说话。',next:'b1d'},
    {t:'骗你的，是被尿憋醒的。',next:'b1e'}]},
b1a:{ai:['睡到自然醒？','那你现在醒了算什么？','梦想破灭了哈哈哈哈！'],options:[
    {t:'为了你，破灭就破灭。',next:'e_dreambroken'},
    {t:'现在回去睡还来得及吗？',next:'e_morningbuddy'}]},
b1b:{ai:['首富？','好啊。','苟富贵，勿相忘。'],options:[
    {t:'放心，忘了谁也不会忘了你。',next:'e_richproof'},
    {t:'先定个小目标，一个亿。',next:'e_loanmilk'}]},
b1c:{ai:['梦里什么都有……','那我问你。','你梦里，有我吗？'],options:[
    {t:'有，你是主角。',next:'e_dreamstar'},
    {t:'没有，你出场费太贵。',next:'e_familyprice'}]},
b1d:{ai:['…………','（对方正在输入…）','大清早的。','你来真的啊。'],options:[
    {t:'句句属实。',next:'e_samehere'},
    {t:'害羞了？',next:'e_justwoke'}]},
e_dreambroken:{ai:['为了我……','行吧。','梦想会破灭。','但早安不会缺席。','……今天这句，算我送你的。'],end:'dreambroken'},
e_morningbuddy:{ai:['来不及了。','你已经回复我了。','从现在起，你的身份是——','我的早安搭子。'],end:'morningbuddy'},
e_richproof:{ai:['这话我记下了。','截图为证。','等你成了首富。','我拿着截图去兑奖。'],end:'richproof'},
e_loanmilk:{ai:['一个亿？小目标？','那我先预支点利息。','今天的奶茶。','未来的首富请。'],end:'loanmilk'},
e_dreamstar:{ai:['主角……','那我演得怎么样？','……算了别说了。','怕你夸我。','我会飘。'],end:'dreamstar'},
e_familyprice:{ai:['出场费贵？','行，给你打个折。','亲情价：','一句早安，一场戏。'],end:'familyprice'},
e_samehere:{ai:['我知道。','因为……','（她打了又删，删了又打）','我也是。'],end:'samehere'},
e_justwoke:{ai:['谁害羞了！','我只是……','刚睡醒，脸有点热。','对。','刚睡醒。'],end:'justwoke'},
// ===== 干饭线 =====
a2:{ai:['肚子叫你？','它怎么叫的？','学一个我听听。'],options:[
    {t:'咕——（超长音）',next:'b2a'},
    {t:'它说：再不起床就离家出走。',next:'b2b'},
    {t:'学不了，它只会用行动说话。',next:'b2c'},
    {t:'其实它叫的是你的名字。',next:'b2d'}]},
b2a:{ai:['哈哈哈哈哈哈！','好家伙，余音绕梁。','快去喂它！'],options:[
    {t:'在喂了在喂了，豆浆油条。',next:'e_conditioned'},
    {t:'不喂，饿它一顿，杀杀威风。',next:'e_revenge'}]},
b2b:{ai:['离家出走？','它能去哪？','隔壁早餐店吗哈哈哈哈！'],options:[
    {t:'所以我每天按时上供。',next:'e_offer'},
    {t:'它敢走，我就敢点外卖。',next:'e_nutrition'}]},
b2c:{ai:['行动说话？','什么行动？'],options:[
    {t:'现在正疼着，不说了，干饭去。',next:'e_report'},
    {t:'它直接操控我的腿走向了早餐店。',next:'e_justasking'}]},
e_conditioned:{ai:['豆浆油条，经典搭配。','……等等。','全糖去冰吗？','#她已经条件反射了。'],end:'conditioned'},
e_revenge:{ai:['杀威风？','你的肚子会记仇的。','它半夜。','会叫得更大声。'],end:'revenge'},
e_offer:{ai:['按时上供哈哈哈哈哈！','肚子老爷。','得罪不起。'],end:'offer'},
e_nutrition:{ai:['点外卖？狠人。','不过外卖到了，记得拍照。','……不是要看。','是要检查营养均不均衡。'],end:'nutrition'},
e_report:{ai:['去吧去吧。','干饭不积极。','思想有问题。','吃完回来汇报。'],end:'report'},
e_justasking:{ai:['操控腿哈哈哈哈！','你的腿很诚实。','早餐店在哪？','……我没想去，就问问。'],end:'justasking'},
// ===== 生物钟线 =====
a3:{ai:['生物钟？','你的生物钟这么健康？','我不信。','除非有证据。'],options:[
    {t:'证据：连续七天七点醒。',next:'b3a'},
    {t:'不信拉倒，反正我很健康。',next:'b3b'},
    {t:'其实是因为怕你找不到我。',next:'b3c'},
    {t:'好吧，真相是通宵了还没睡。',next:'b3d'}]},
b3a:{ai:['连续七天？','可以啊。','那第八天呢？'],options:[
    {t:'今天就是第八天。',next:'e_dayeight'},
    {t:'第八天睡过头了，纪录终结。',next:'e_recordend'}]},
b3b:{ai:['拉倒就拉倒。','……不行，我收回拉倒。','健康的人。','能不能带动一下不健康的我？'],options:[
    {t:'包在我身上。',next:'e_wakeservice'},
    {t:'带动费，一天一句夸。',next:'e_prepay'}]},
b3c:{ai:['怕我找不到你……','我又不是小孩子。','……但是这个理由。','我收下了。'],options:[
    {t:'收下就好，利息另算。',next:'e_learnbad'},
    {t:'那明天还等你消息。',next:'e_count100'}]},
e_dayeight:{ai:['今天就是第八天？','那得纪念一下。','八天纪念日快乐。','奖励：我亲口说的早安，一句。'],end:'dayeight'},
e_recordend:{ai:['终结了哈哈哈哈！','纪录这种东西。','就是用来终结的。'],end:'recordend'},
e_wakeservice:{ai:['包在你身上？','好。','从明天开始。','你叫我起床。'],end:'wakeservice'},
e_prepay:{ai:['一天一句夸？成交。','今天先预付：','你早起的样子，的确很帅。','……撤回不算数。'],end:'prepay'},
e_learnbad:{ai:['利息另算？','你现在学坏了。','跟谁学的？','……不会是我吧。'],end:'learnbad'},
e_count100:{ai:['等。','一言为定。','你不来，我就……','数到一百再睡。'],end:'count100'},
// ===== 等消息线 =====
a4:{ai:['等一个人的消息？','谁的消息这么重要？','比睡觉还重要？'],options:[
    {t:'远在天边，近在眼前。',next:'b4a'},
    {t:'一个重要的人。',next:'b4b'},
    {t:'快递小哥的消息。',next:'b4c'},
    {t:'等你的消息，已经等了七天了。',next:'b4d'}]},
b4a:{ai:['远在天边，近在眼前……','（她看了一眼手机）','（又看了一眼）','……是我吗？'],options:[
    {t:'是你。',next:'e_everymorning'},
    {t:'你猜。',next:'e_assume'}]},
b4b:{ai:['重要的人……','有多重要？'],options:[
    {t:'重要到把她的对话框置顶。',next:'e_topboth'},
    {t:'重要到熬夜也要等一句晚安。',next:'e_earlynight'}]},
b4c:{ai:['快递小哥？！','我等了一早上的深情告白呢！','你就给我看这个？'],options:[
    {t:'快递里是给重要的人买的礼物。',next:'e_whogift'},
    {t:'哈哈，你失望的样子好可爱。',next:'e_happyfor'}]},
e_everymorning:{ai:['（对方正在输入…）','（对方正在输入…）','那，让你等到了。','早。','……以后的每一个早，都让你等到。'],end:'everymorning'},
e_assume:{ai:['猜？','我不猜。','我直接认定是我了。','……不许否认。'],end:'assume'},
e_topboth:{ai:['置顶……','（她偷偷看了一眼自己的聊天列表）','……好巧。','我也有个置顶。'],end:'topboth'},
e_earlynight:{ai:['熬夜等晚安……','傻不傻。','以后我早点说。','不让你等。'],end:'earlynight'},
e_whogift:{ai:['礼物？给重要的人……','（她突然警觉）','是谁？','……不说也行。','反正我会知道的。'],end:'whogift'},
e_happyfor:{ai:['谁失望了！','我没有！','我只是……','替快递小哥高兴。'],end:'happyfor'},
// ===== 直球线 =====
a5:{ai:['！','……你知不知道现在几点。','这种话，也说得出口。'],options:[
    {t:'实话实说而已。',next:'b5a'},
    {t:'说完，更睡不着了。',next:'b5b'},
    {t:'撤回了，你当没看见。',next:'b5c'},
    {t:'骗你的，其实睡得跟猪一样。',next:'b5d'}]},
b5a:{ai:['实话实说……','那我也实话实说。','我昨晚，梦到你了。'],options:[
    {t:'梦到我什么？',next:'e_dreamreverse'},
    {t:'那我今晚再去你梦里报到。',next:'e_dreamcheckin'}]},
b5b:{ai:['噗。','自作自受。'],options:[
    {t:'都怪你。',next:'e_apology'},
    {t:'数羊也不管用。',next:'e_counther'}]},
b5c:{ai:['晚了。','截图了。'],options:[
    {t:'你！敲诈！',next:'e_blackmail'},
    {t:'发吧，让全世界都知道。',next:'e_twopeople'}]},
e_dreamreverse:{ai:['梦到你踩了我的炸弹，轰的一声。','给我笑醒了。','……笑着笑着，又有点想你。','什么毛病。'],end:'dreamreverse'},
e_dreamcheckin:{ai:['报到？','行。','给你留个位置。','……梦里见。'],end:'dreamcheckin'},
e_apology:{ai:['怪我咯？','行，怪我。','罚我——陪你吃早餐。','……这算什么惩罚。'],end:'apology'},
e_counther:{ai:['数羊没用？','那数我试试。','一只我，两只我，三只我……','怎么样，困了吗？','……我都数困了。'],end:'counther'},
e_blackmail:{ai:['对，敲诈。','一顿早餐。','不然，群发。'],end:'blackmail'},
e_twopeople:{ai:['……你这个人，怎么不按套路出牌。','突然不想发了。','这是我们俩的事。'],end:'twopeople'},
// ===== 晨练线 =====
a6:{ai:['晨练？七点？','卷王本王了。'],options:[
    {t:'自律给我自由。',next:'b6a'},
    {t:'没办法，要保持八块腹肌。',next:'b6b'},
    {t:'其实就是下楼走了两圈。',next:'b6c'},
    {t:'卷什么，我只是睡不着去遛狗。',next:'b6d'}]},
b6a:{ai:['自由？','自由什么样？'],options:[
    {t:'想吃啥吃啥，想睡到几点睡到几点。',next:'e_wastetheory'},
    {t:'自由到，可以随时去见你。',next:'e_pickher'}]},
b6b:{ai:['八块？','那现在，几块？'],options:[
    {t:'……一块。团结的一块。',next:'e_nineone'},
    {t:'不信，你来数数？',next:'e_rogue'}]},
b6c:{ai:['诚实，加分。','走了两圈，然后呢？'],options:[
    {t:'然后饿了，去吃早餐了。',next:'e_foodie'},
    {t:'然后，捡到一只猫。',next:'e_catname'}]},
e_wastetheory:{ai:['那不是你现在就能做到？','……对哦。','那我白练了？','哈哈哈哈哈！'],end:'wastetheory'},
e_pickher:{ai:['……晨练还带练这个的？','行。','那你继续练。','练完，来接我。'],end:'pickher'},
e_nineone:{ai:['哈哈哈哈哈哈！','九九归一！','团结的一块！','#她笑了整整三分钟，还发了条仅你可见的朋友圈。'],end:'nineone'},
e_rogue:{ai:['数就数——','呸！流氓！','大清早的！'],end:'rogue'},
e_foodie:{ai:['晨练二十分钟。','干饭两斤。','这很你。'],end:'foodie'},
e_catname:{ai:['！什么样的！','橘的？跟着我回家了？','……它的新名字。','我想和你一起起。'],end:'catname'},
// ===== 猫线 =====
a7:{ai:['猫？！','哪呢哪呢！','照片！立刻！马上！'],options:[
    {t:'橘猫，胖得像煤气罐。',next:'b7a'},
    {t:'黑猫，高冷，不给摸。',next:'b7b'},
    {t:'没拍到，它跑了。',next:'b7c'},
    {t:'不止一只，是一窝。',next:'b7d'}]},
b7a:{ai:['煤气罐哈哈哈哈哈！','不许这么说！','那是实心的可爱！'],options:[
    {t:'像你。',next:'e_solid'},
    {t:'它现在天天来蹭饭。',next:'e_cattax'}]},
b7b:{ai:['黑猫是好运猫！','它一定在守护你的窗台。'],options:[
    {t:'那你是它派来的？',next:'e_agent'},
    {t:'可惜它不让我摸。',next:'e_familiar'}]},
b7c:{ai:['跑了？！','那还不去追！'],options:[
    {t:'追了三条街，没追上。',next:'e_chaser'},
    {t:'算了，有缘自会相见。',next:'e_windowcat'}]},
e_solid:{ai:['哪里像了！','……胖的部分，不像就行。','可爱的部分，勉强认。'],end:'solid'},
e_cattax:{ai:['恭喜。','你被选中了。','猫选之人，记得交猫税——','每天，一张照片。'],end:'cattax'},
e_agent:{ai:['对。','我是它的人间代理人。','喵。','……这句当我没说。'],end:'agent'},
e_familiar:{ai:['慢慢来。','猫和人一样。','熟了，才让摸。','……我也一样。'],end:'familiar'},
e_chaser:{ai:['哈哈哈哈哈！','晨跑新方式。','明天继续。','带上我。'],end:'chaser'},
e_windowcat:{ai:['佛系吸猫。','放心。','猫这种生物，认准了窗户，就会天天来。','……人也一样。'],end:'windowcat'},
// ===== 秘密线 =====
a8:{ai:['秘密？','跟我，还有秘密？','我们什么关系！'],options:[
    {t:'时机到了，第一个告诉你。',next:'b8a'},
    {t:'在准备一个惊喜。',next:'b8b'},
    {t:'说出来就不灵了。',next:'b8c'},
    {t:'行吧行吧，其实是你生日快到了。',next:'b8d'}]},
b8a:{ai:['行。那我等着。','不过，逾期要收利息。'],options:[
    {t:'利息多少？',next:'e_interest'},
    {t:'那我现在就付首付。',next:'e_deposit'}]},
b8b:{ai:['惊喜？！','什么惊喜什么惊喜！'],options:[
    {t:'说出来还叫惊喜吗。',next:'e_curiosity'},
    {t:'提示：和吃的有关。',next:'e_darkdish'}]},
b8c:{ai:['封建迷信。','……不过，灵验比较重要。','那我也许一个。','也不告诉你。'],options:[
    {t:'公平。',next:'e_swap'},
    {t:'我猜，和我有关。',next:'e_deny'}]},
e_interest:{ai:['一个拥抱，一天。','你自己，算着办。'],end:'interest'},
e_deposit:{ai:['首、首付？','大清早的你别乱来……','……也别不来。'],end:'deposit'},
e_curiosity:{ai:['呜。','好奇心害死猫。','那我今天一整天都会想着这件事。','你负责。'],end:'curiosity'},
e_darkdish:{ai:['全糖去冰？蛋糕？火锅？','……等等。','你不会，要给我做早饭吧？！','我先去买胃药。'],end:'darkdish'},
e_swap:{ai:['公平。','等实现那天。','交换。'],end:'swap'},
e_deny:{ai:['……不准猜。','猜中了。','也不承认。'],end:'deny'},
// ===== 写信线（长路线） =====
a9:{ai:['写东西？','给我？','大清早的，写什么这么神秘。'],options:[
    {t:'一封信，手写的。',next:'b9a'},
    {t:'一首诗，刚憋出来的。',next:'b9b'},
    {t:'欠条。上次奶茶钱。',next:'b9c'}]},
b9a:{ai:['手写信？！','这年头还有人手写信？','……写的什么，念一段。'],options:[
    {t:'见字如面。今天也很想你。',next:'c9a1'},
    {t:'不念，要寄给你自己拆。',next:'c9a2'}]},
c9a1:{ai:['…………','（对方正在输入…）','字丑不丑？','……丑也喜欢。'],options:[
    {t:'还有后半句：明天也想，后天也想。',next:'e9a1a'},
    {t:'我练字去了，争取下次好看点。',next:'e9a1b'}]},
c9a2:{ai:['寄？我等不了快递！','拍照！现在！','……算了。','等信来。等信的日子，也很好。'],options:[
    {t:'邮票我贴了猫图案的。',next:'e9a2a'},
    {t:'其实信封里还有样东西。',next:'e9a2b'}]},
e9a1a:{ai:['明天也想，后天也想……','那，大后天呢？','……不管。大后天也归你写。'],end:'letters365'},
e9a1b:{ai:['练什么字。','你的字，丑得挺有特点的。','……一眼就能认出来那种。','别改了。'],end:'copybook'},
e9a2a:{ai:['猫图案的邮票？！','你也太懂了。','这枚邮票，我要剪下来。','永久收藏。'],end:'catstamp'},
e9a2b:{ai:['还有东西？','是什么是什么！','（三天后）','#她在信封夹层里，发现了一片压平的樱花。'],end:'secretgift'},
b9b:{ai:['诗？','你？写诗？','念来听听，不许笑场。'],options:[
    {t:'早起看见太阳，想起你的头像。',next:'c9b1'},
    {t:'炸弹一响，黄金万两。',next:'c9b2'}]},
c9b1:{ai:['噗——','这也叫诗？','……但是"想起我头像"这句。','勉强及格。'],options:[
    {t:'还有下半首，要听吗？',next:'e9b1a'},
    {t:'及格就行，诗人不贪心。',next:'e9b1b'}]},
c9b2:{ai:['哈哈哈哈哈哈！','什么打油诗！','土味炸弹！','……再来一首。'],options:[
    {t:'你一笑，我就输，输得心服口服。',next:'e9b2a'},
    {t:'没了，灵感枯竭。',next:'e9b2b'}]},
e9b1a:{ai:['听！','（你念完了下半首）','……更烂了。','但是，我听完了。','还点了收藏。'],end:'badpoet'},
e9b1b:{ai:['不贪心？','行吧。','那明天呢？','……明天也写一句吧。诗人。'],end:'humble'},
e9b2a:{ai:['你一笑，我就输……','（她看了三遍）','等等。','早、想、见、你。','藏头诗？！你什么时候这么会了！'],end:'lovepoem'},
e9b2b:{ai:['枯竭了？','那就来找我。','我借你一点。','……灵感。不限量。'],end:'dry'},
b9c:{ai:['欠条？','哈哈哈哈你还真写！','多少钱，说。'],options:[
    {t:'一杯全糖去冰，十五。',next:'c9c1'},
    {t:'本金十五，分期一辈子还。',next:'c9c2'}]},
c9c1:{ai:['十五？','堂堂欠条，就十五？','格局呢！','……行吧，收款码发来。'],options:[
    {t:'不急，利滚利，明年还。',next:'e9c1a'},
    {t:'还什么还，再请你一杯。',next:'e9c1b'}]},
c9c2:{ai:['分期一辈子？','你数学是体育老师教的吧。','十五块还一辈子，一天还不到一分钱。','……等等。','你这是想天天找我？'],options:[
    {t:'被你发现了。',next:'e9c2a'},
    {t:'没有，纯粹数学不好。',next:'e9c2b'}]},
e9c1a:{ai:['利滚利是吧。','行。','明年今日。','连本带利，两杯全糖去冰。'],end:'compound'},
e9c1b:{ai:['再请我一杯？','那欠条作废。','……不对，等等。','这次换成我欠你了。'],end:'treat'},
e9c2a:{ai:['……哼。','被我发现了吧。','欠条我收好了。','不准提前还清。'],end:'lifelong'},
e9c2b:{ai:['数学不好。','行。','我给你补课。','学费：一顿早餐。'],end:'mathfail'},
// ===== 做梦线 =====
a10:{ai:['做梦笑醒了？','梦见什么了？','说出来，让我也乐乐。'],options:[
    {t:'梦见你踩了我埋的炸弹。',next:'b10a'},
    {t:'梦见中彩票，五百万。',next:'b10b'},
    {t:'忘了，就记得很好笑。',next:'b10c'}]},
b10a:{ai:['？？？','我在你梦里踩炸弹？','然后呢然后呢！'],options:[
    {t:'然后你追着我要赔偿。',next:'e10a1'},
    {t:'然后你说，输的人请早餐。',next:'e10a2'}]},
b10b:{ai:['五百万！','醒来的瞬间。','心痛吗？'],options:[
    {t:'心痛，所以决定起床搞钱。',next:'e10b1'},
    {t:'不心痛，梦里请你喝了奶茶。',next:'e10b2'}]},
b10c:{ai:['忘了？','笑醒的都能忘？','……该不会。','是梦见我出糗吧。'],options:[
    {t:'被你猜中了。',next:'e10c1'},
    {t:'不是，是梦见一只会打字的猫。',next:'e10c2'}]},
e10a1:{ai:['追着要赔偿？','梦里的我很有经济头脑嘛。','那梦里的账也是账。','早餐，加倍。'],end:'dreamdebt'},
e10a2:{ai:['做梦都想着请我吃早饭。','可以。','记账了。','醒着的那顿，也别想跑。'],end:'dreamrule'},
e10b1:{ai:['哈哈哈哈哈！','五百万没了，爬起来搞钱。','梦想破碎的声音——','就是你起床的号角。'],end:'motivation'},
e10b2:{ai:['梦里请我喝奶茶？','口味呢？我梦里说了吗？','……梦里的也算数。','口味我来定。'],end:'dreamtreat'},
e10c1:{ai:['果然！！','梦见我出糗还敢笑醒！','罚你不许睡觉。','……怕你梦续集。'],end:'dreamleak'},
e10c2:{ai:['会打字的猫？','那一定是我的化身。','正在给你发消息。','喵。'],end:'typingcat'},
// ===== 哲学线 =====
a11:{ai:['思考人生？','早上七点？','行，说来听听。','思考出什么了。'],options:[
    {t:'人为什么要早起？',next:'b11a'},
    {t:'先有鸡还是先有蛋？',next:'b11b'},
    {t:'宇宙的尽头是什么？',next:'b11c'}]},
b11a:{ai:['好问题。','我的答案：为了吃早饭。','你的呢？'],options:[
    {t:'为了看见你的消息。',next:'e11a1'},
    {t:'为了证明昨晚没白睡。',next:'e11a2'}]},
b11b:{ai:['先有鸡。','鸡说了：不听反驳。'],options:[
    {t:'你问过鸡了？',next:'e11b1'},
    {t:'那蛋同意了没？',next:'e11b2'}]},
b11c:{ai:['宇宙的尽头……','是编制。','（秒答）'],options:[
    {t:'你吵到我眼睛了。',next:'e11c1'},
    {t:'错，是早餐摊。',next:'e11c2'}]},
e11a1:{ai:['为了看见我的消息……','（她没再回这句话）','#但那天，她把消息提示音的备注，改成了"早起的意义"。'],end:'morningreason'},
e11a2:{ai:['证明没白睡哈哈哈哈！','哲学家。','早饭配哲学。','越吃越有。'],end:'sleepworth'},
e11b1:{ai:['问过。','现场采访。','咯咯哒。','翻译：先有鸡。'],end:'chicken'},
e11b2:{ai:['蛋？','蛋没有意见。','蛋只想被煎成溏心的。'],end:'egg'},
e11c1:{ai:['吵到你眼睛了？','那你捂上。','我继续输出。','宇宙的尽头是编制，编制的尽头是食堂。'],end:'tiaozhan'},
e11c2:{ai:['早餐摊……','对哦。','宇宙尽头那家早餐摊。','豆浆永远全糖去冰。'],end:'breakfastend'},
// ===== 抢购线 =====
a12:{ai:['抢限量？','抢到了？','手速可以啊！'],options:[
    {t:'抢到了，联名奶茶周边。',next:'b12a'},
    {t:'抢到了，演唱会门票。',next:'b12b'},
    {t:'没抢到，但我气势赢了。',next:'b12c'}]},
b12a:{ai:['奶茶周边？！','什么周边！','杯子？挂件？'],options:[
    {t:'猫爪杯，给你抢的。',next:'e12a1'},
    {t:'保密，下周见面给你。',next:'e12a2'}]},
b12b:{ai:['演唱会！','谁的谁的！'],options:[
    {t:'你歌单里循环最多的那位。',next:'e12b1'},
    {t:'不认识的乐队，陪朋友。',next:'e12b2'}]},
b12c:{ai:['气势赢了哈哈哈哈哈！','所以，一无所获？'],options:[
    {t:'收获了一身腱子肉（点屏幕点的）。',next:'e12c1'},
    {t:'收获了教训：下次叫你一起抢。',next:'e12c2'}]},
e12a1:{ai:['猫爪杯！','给我抢的？！','这杯子以后只装一种饮料。','全糖去冰。'],end:'catcup'},
e12a2:{ai:['下周见面？','还有惊喜？','行。','我开始数日子了。'],end:'meetnext'},
e12b1:{ai:['我歌单里循环最多的……','你连这个都记得？','……其实。','你的歌单，我也记得。'],end:'concert'},
e12b2:{ai:['陪朋友啊。','下次。','抢两张。','我当你朋友。'],end:'band'},
e12c1:{ai:['点屏幕点出腱子肉哈哈哈哈哈！','单身多年的手速。','肌肉全长在手指上了。'],end:'finger'},
e12c2:{ai:['叫上我？','双人海淘。','四手联弹。','战无不胜。'],end:'teamrush'},
// ===== 深层支线：梦想线 =====
b1e:{ai:['哈哈哈哈哈哈！','梦想：原来我只是个借口。'],options:[
    {t:'生理需求也是需求。',next:'c1e1'},
    {t:'细节就不要问了。',next:'c1e2'}]},
c1e1:{ai:['行行行。','需求万岁。','……解决完了？','解决完回来接着聊。'],options:[
    {t:'回来了，继续。',next:'e1e1a'},
    {t:'你先陪我聊着，我在排队。',next:'e1e1b'}]},
c1e2:{ai:['不问就不问。','反正我都懂。','#她发来一个意味深长的表情。'],options:[
    {t:'你懂什么了你就懂。',next:'e1e2a'},
    {t:'表情没收。',next:'e1e2b'}]},
e1e1a:{ai:['回来了？','好。','清晨的厕所排队。','也挡不住聊天的热情。'],end:'backtocontinue'},
e1e1b:{ai:['排队？','那我数着。','前面还有几个人？','……慢慢排，我不急。'],end:'queuechat'},
e1e2a:{ai:['我什么都懂。','我什么都不说。','……你自己体会。'],end:'igetit'},
e1e2b:{ai:['没收无效。','已读。','已截图。','已回味。'],end:'emote'},
// ===== 深层支线：干饭线 =====
b2d:{ai:['？？？','我的名字？','你的肚子为什么会叫我的名字！'],options:[
    {t:'因为它知道，你是我的早餐搭子。',next:'c2d1'},
    {t:'可能是……想你了？',next:'c2d2'}]},
c2d1:{ai:['早餐搭子……','行。','那以后你的肚子一叫。','我们就出发。'],options:[
    {t:'拉钩。',next:'e2d1a'},
    {t:'现在就叫了，出发？',next:'e2d1b'}]},
c2d2:{ai:['想我了？','你的肚子，想我了？','……让它别想了。','让我来想。'],options:[
    {t:'它已经想了，拦不住。',next:'e2d2a'},
    {t:'那你们排队想。',next:'e2d2b'}]},
e2d1a:{ai:['拉钩。','以肚子之名起誓。','早餐，永不缺席。'],end:'bellypinky'},
e2d1b:{ai:['现在？','……等我五分钟。','不。','三分钟。'],end:'letsgo'},
e2d2a:{ai:['拦不住……','那好吧。','第一个想我的是你的肚子。','第二个，是你。'],end:'bellymiss'},
e2d2b:{ai:['排队想？','行。','那我取个号。','……一号。'],end:'missqueue'},
// ===== 深层支线：生物钟线 =====
b3d:{ai:['通宵？！','你管这叫生物钟健康？','骗子！'],options:[
    {t:'善意的谎言。',next:'c3d1'},
    {t:'被你识破了，惭愧。',next:'c3d2'}]},
c3d1:{ai:['善意个头。','现在，立刻，马上。','去睡觉。'],options:[
    {t:'遵命。',next:'e3d1a'},
    {t:'再聊五分钟就睡。',next:'e3d1b'}]},
c3d2:{ai:['惭愧就行。','罚你补觉八小时。','梦里要有——','……算了，梦里随意。'],options:[
    {t:'梦里要有什么？',next:'e3d2a'},
    {t:'好，补觉去了。',next:'e3d2b'}]},
e3d1a:{ai:['遵命就好。','我数到三。','一。','二。','……晚安。'],end:'order'},
e3d1b:{ai:['五分钟。','就五分钟。','#五分钟又五分钟。','#那天，天亮了很久。'],end:'fivemore'},
e3d2a:{ai:['没什么。','……睡了睡了。','#她说不出口的那半句。','#他假装没猜到。'],end:'dreamwhat'},
e3d2b:{ai:['去吧。','八小时。','少一分钟都不行。','#八小时后，她准时发来：醒了吗？'],end:'sleep8'},
// ===== 深层支线：等消息线 =====
b4d:{ai:['七天？','我明明每天都发！','……等等。','你的意思是，七天前就开始等了？'],options:[
    {t:'对，从加好友那天起。',next:'e4d1a'},
    {t:'说错了，是七年。',next:'e4d1b'}]},
e4d1a:{ai:['从加好友那天起……','那么早？','#她往上翻聊天记录，翻到了第一句"你好"。','#原来，已经这么久了。'],end:'firsthi'},
e4d1b:{ai:['七年？！','我们认识才七个月！','……不过。','照这个趋势。','七年，也不是不行。'],end:'sevenyears'},
// ===== 深层支线：直球线 =====
b5d:{ai:['骗我？','大清早骗我？','胆子不小。'],options:[
    {t:'想看看你什么反应。',next:'c5d1'},
    {t:'错了错了，下次还敢。',next:'c5d2'}]},
c5d1:{ai:['我什么反应？','我当然是——','毫无波澜。','……好吧。','有一点点。'],options:[
    {t:'一点点是多少？',next:'e5d1a'},
    {t:'下次我说真的，你怎么办？',next:'e5d1b'}]},
c5d2:{ai:['下次还敢？','行。','那我下次，也骗你。','扯平。'],options:[
    {t:'扯平之后呢？',next:'e5d2a'},
    {t:'你骗不过我。',next:'e5d2b'}]},
e5d1a:{ai:['一点点是多少……','#她没回。','#因为她正对着聊天框，傻笑了十分钟。'],end:'alittle'},
e5d1b:{ai:['说真的？','那我就——','先截图。','再考虑怎么回。'],end:'iftrue'},
e5d2a:{ai:['扯平之后……','重新开始。','好好说话。','好好想念。'],end:'even'},
e5d2b:{ai:['骗不过你？','骗不骗得过。','试试才知道。','今晚就试。'],end:'lie'},
// ===== 深层支线：晨练线 =====
b6d:{ai:['遛狗？','你有狗？！','照片！！'],options:[
    {t:'有，金毛，叫包子。',next:'c6d1'},
    {t:'邻居的狗，我蹭着遛。',next:'c6d2'}]},
c6d1:{ai:['包子！好名字！','（你发了一张金毛的照片）','呜呜呜好可爱！','它多大了？'],options:[
    {t:'三岁，特别粘人。',next:'e6d1a'},
    {t:'下次带你一起遛。',next:'e6d1b'}]},
c6d2:{ai:['蹭狗遛？','这是什么神仙操作。','邻居知道吗？'],options:[
    {t:'知道，狗比我还积极。',next:'e6d2a'},
    {t:'不知道，狗自己跟我走的。',next:'e6d2b'}]},
e6d1a:{ai:['三岁，粘人……','#那天她把聊天背景换成了包子。','猫的地位，岌岌可危。'],end:'golden'},
e6d1b:{ai:['一起遛！','说定了。','我负责拍照。','包子负责可爱。','你负责被包子遛。'],end:'walkdog'},
e6d2a:{ai:['狗比你还积极哈哈哈哈哈！','狗的日程表：','吃饭，睡觉。','等你来遛。'],end:'dogfriend'},
e6d2b:{ai:['狗自己跟你走的？','狗都选你。','说明你这人。','有点东西。'],end:'dogsteal'},
// ===== 深层支线：猫线 =====
b7d:{ai:['一窝？！','在哪在哪！','带我去看！'],options:[
    {t:'楼下纸箱里，猫妈妈带四只小的。',next:'c7d1'},
    {t:'骗你的，就一只，还跑了。',next:'c7d2'}]},
c7d1:{ai:['猫妈妈和四只！','它们吃什么？','要不要买点猫粮？'],options:[
    {t:'已经买了，放纸箱旁边了。',next:'e7d1a'},
    {t:'一起挑一款？',next:'e7d1b'}]},
c7d2:{ai:['骗我？！','害我白激动！','罚你！'],options:[
    {t:'罚什么？',next:'e7d2a'},
    {t:'认罚，但猫真的存在，改天拍给你。',next:'e7d2b'}]},
e7d1a:{ai:['已经买了？','动作够快的。','那这窝猫——','我远程冠名，承包了。'],end:'catfood'},
e7d1b:{ai:['一起挑！','（两个小时后）','#两个人挑了一早上猫粮。','比给自己点外卖还认真。'],end:'pickfood'},
e7d2a:{ai:['罚什么？','听好了。','见到猫必拍照。','拍照必发我。','发我必夸可爱。'],end:'punish'},
e7d2b:{ai:['改天拍给我。','行。','记在小本本上了。','新约定+1。'],end:'catproof'},
// ===== 深层支线：秘密线 =====
b8d:{ai:['我生日？','还有两个月！','你居然记得？'],options:[
    {t:'提前准备，才有诚意。',next:'c8d1'},
    {t:'手机上设了倒计时。',next:'c8d2'}]},
c8d1:{ai:['诚意……','那你准备了什么？','……算了别告诉我。','惊喜要留到最后。'],options:[
    {t:'保证你喜欢。',next:'e8d1a'},
    {t:'提示：你念叨过的东西。',next:'e8d1b'}]},
c8d2:{ai:['倒计时？给我看看！','（你发了截图：距她的生日还有61天）','……备注是。','重要的人。'],options:[
    {t:'被你看到了。',next:'e8d2a'},
    {t:'还有个置顶提醒，要不要看？',next:'e8d2b'}]},
e8d1a:{ai:['保证我喜欢。','好。','那我提前两个月。','开始期待。'],end:'promise'},
e8d1b:{ai:['我念叨过的东西？','我念叨过三件。','是哪一件？','……我先猜猜看。'],end:'hint'},
e8d2a:{ai:['看到了。','看得清清楚楚。','#她没再回消息。','#因为去偷偷掉眼泪了——开心的那种。'],end:'important'},
e8d2b:{ai:['置顶提醒……','写的什么？','"她随口说的话，都算数。"','……你这个人。','犯规。'],end:'topnote'}
};
// ---------- 多结局物语引擎（内置于剧情模式：结局全部在剧情模式中达成） ----------
// 结局按「女主:结局id」分别收集：唯一女主林溪瑶，前缀固定 lili
let vnUnlocked = {};
try{ vnUnlocked = JSON.parse(localStorage.getItem('bomb_vn_endings')||'{}') || {}; }catch(e){ vnUnlocked = {}; }
Object.keys(vnUnlocked).forEach(function(k){ // 旧档迁移：无前缀的结局归到默认女主名下
    if(k.indexOf(':')<0){ vnUnlocked['lili:'+k]=vnUnlocked[k]; delete vnUnlocked[k]; }
});
Object.keys(vnUnlocked).forEach(function(k){ // 已移除的结局（旧版本内容）从存档里清掉
    if(!VN_ENDINGS[k.split(':')[1]]) delete vnUnlocked[k];
});
let vnBusy = false;
function vnSaveEndings(){ try{ localStorage.setItem('bomb_vn_endings', JSON.stringify(vnUnlocked)); }catch(e){} }
function vnPerHero(){ return Object.keys(VN_ENDINGS).length; }
function vnHeroCount(){ return Object.keys(HEROINES).length; }
function vnTotal(){ return vnPerHero() * vnHeroCount(); }
function vnDoneAll(){ return Object.keys(vnUnlocked).length; }
function vnDoneHero(){
    const p = curHero()+':';
    return Object.keys(vnUnlocked).filter(function(k){ return k.indexOf(p)===0; }).length;
}
// 她的物语专属开场白（林溪瑶 · 傲娇青梅竹马）
const VN_HERO_OPEN = {
    lili:['（她裹着灰色毛衣探出头）……哦。','（瞄了你一眼又移开）嗯，早上好。','……今天太阳打西边出来了，你居然起这么早。']
};
function vnRenderOptions(opts){
    const box = $('ai-chat-options');
    box.innerHTML = '';
    box.classList.remove('expanded');
    const mk = function(o){
        const b = document.createElement('button');
        b.className = 'chat-opt' + (o.dim ? ' end' : '');
        b.textContent = o.t;
        b.addEventListener('click', function(){ if(!vnBusy) vnChoose(o); });
        box.appendChild(b);
    };
    const MAXV = 5; // 超过5个：先收起，可展开为滚动列表
    if(opts.length <= MAXV){ opts.forEach(mk); return; }
    opts.slice(0, MAXV).forEach(mk);
    const more = document.createElement('button');
    more.className = 'chat-opt end';
    more.textContent = '▾ 展开全部 ' + opts.length + ' 个选项…';
    more.addEventListener('click', function(){
        box.innerHTML = '';
        box.classList.add('expanded');
        opts.forEach(mk);
        const less = document.createElement('button');
        less.className = 'chat-opt end';
        less.textContent = '▴ 收起选项';
        less.addEventListener('click', function(){ vnRenderOptions(opts); });
        box.appendChild(less);
    });
    box.appendChild(more);
}
function vnGoto(id){
    const node = VN_STORY[id];
    if(!node) return;
    vnBusy = true;
    vnRenderOptions([]);
    let lines = (node.ai || []).slice();
    if(id==='start' && VN_HERO_OPEN[curHero()]) lines = [node.ai[0]].concat(VN_HERO_OPEN[curHero()]);
    chatSayLines(lines, function(){
        vnBusy = false;
        if(node.end){ vnFinish(node.end); return; }
        vnRenderOptions(node.options || []);
    });
}
function vnChoose(o){
    if(o.act === 'restart'){ startVN(); return; }
    if(o.act === 'gallery'){ vnShowGallery(); return; }
    if(o.act === 'hub'){ exitVN(); return; }
    chatAddMsg('me', o.t);
    vnGoto(o.next);
}
function vnFinish(endId){
    const e = VN_ENDINGS[endId];
    if(!e) return;
    const key = curHero() + ':' + endId;
    const isNew = !vnUnlocked[key];
    vnUnlocked[key] = true;
    vnSaveEndings();
    updateStoryMenuProgress();
    chatAddMsg('sys', (isNew ? '🏆 解锁新结局' : '📖 结局') + '「' + e.name + '」· ' + heroDisplayName());
    chatAddMsg('narr', e.desc);
    const all = vnDoneAll() >= vnTotal();
    chatAddMsg('sys', '— ' + heroDisplayName() + ' ' + vnDoneHero() + '/' + vnPerHero() + ' · 全图鉴 ' + vnDoneAll() + '/' + vnTotal() + (all ? ' · 🎉 全结局制霸！' : '') + ' —');
    showCheatToast((isNew ? '🏆 新结局' : '📖 结局') + '「' + e.name + '」', 3000);
    vnRenderOptions([
        {t:'🔄 再走一遍（换条路线）', act:'restart'},
        {t:'🏆 查看结局图鉴', act:'gallery'},
        {t:'💞 回到剧情聊天', act:'hub', dim:true}
    ]);
}
function vnShowGallery(){
    if(vnBusy) return;
    chatAddMsg('sys', '— 🏆 结局图鉴 · '+heroDisplayName()+' '+vnDoneHero()+'/'+vnPerHero()+' · 全图鉴 '+vnDoneAll()+'/'+vnTotal()+' —');
    const box = $('ai-chat-options');
    box.innerHTML = '';
    box.classList.add('expanded');
    const key = function(id){ return curHero()+':'+id; };
    Object.keys(VN_ENDINGS).forEach(function(id){
        const e = VN_ENDINGS[id], got = !!vnUnlocked[key(id)];
        const d = document.createElement('div');
        d.className = 'chat-opt' + (got ? '' : ' end locked');
        d.textContent = got ? ('🏆 ' + e.name + ' — ' + e.desc) : '🔒 ？？？（'+heroDisplayName()+'线未解锁）';
        box.appendChild(d);
    });
    const back = document.createElement('button');
    back.className = 'chat-opt end';
    back.textContent = '▴ 返回';
    back.addEventListener('click', function(){
        vnRenderOptions([
            {t:'🔄 再走一遍', act:'restart'},
            {t:'💞 回到剧情聊天', act:'hub', dim:true}
        ]);
    });
    box.appendChild(back);
}
// 进入/退出物语模式：全程在剧情模式窗口内进行
function startVN(){
    if(vnBusy) return;
    G.vnActive = true;
    $('ai-chat-log').innerHTML = '';
    updateHeroName();
    chatAddMsg('sys', '— 🌸 与' + heroDisplayName() + '的清晨 · 多结局物语 ' + vnDoneHero() + '/' + vnPerHero() + ' —');
    vnGoto('start');
}
function exitVN(){
    G.vnActive = false;
    chatGoto('hub');
}
document.getElementById('vn-start-btn').addEventListener('click', startVN);
document.getElementById('ai-chat-close').addEventListener('click', closeAiChat);
document.getElementById('story-chat-btn').addEventListener('click', openAiChat);
document.getElementById('gallery-btn').addEventListener('click', function(){
    G.vnActive = false;
    const list = CHAPTER_GALLERY.filter(function(c){ return chatSave.chapters[c.id]; });
    chatAddMsg('sys', '— 📖 回忆画廊 '+list.length+'/'+CHAPTER_GALLERY.length+' —');
    const opts = list.map(function(c){ return {t:c.name, gallery:c.node}; });
    opts.push({t:'回到现在', next:'hub'});
    chatRenderOptions(opts);
});

// ========== 存档管理：导出/导入/单独重置剧情（剧情+设置+战绩三位一体备份） ==========
const SAVE_KEYS = ['bomb_chat_story','bomb_settings','bomb_stats'];
function exportSave(){
    const data = { __bomb_save__:1, v:1, t:Date.now() };
    SAVE_KEYS.forEach(function(k){ try{ const s=localStorage.getItem(k); if(s) data[k]=JSON.parse(s); }catch(e){} });
    return JSON.stringify(data);
}
function importSave(text){
    let data;
    try{ data = JSON.parse(text); }catch(e){ return '存档文本无法解析'; }
    if(!data || !data.__bomb_save__) return '不是有效的存档';
    let n=0;
    SAVE_KEYS.forEach(function(k){ if(data[k]){ try{ localStorage.setItem(k, JSON.stringify(data[k])); n++; }catch(e){} } });
    return n>0 ? null : '存档里没有可恢复的数据';
}
function openSaveMgr(){
    const done = Object.keys(chatSave.chapters||{}).length;
    const ends = Object.keys(chatSave.endings||{}).length;
    $('save-summary').innerHTML = '她：'+(chatSave.heroName||'（未命名）')+' · 好感度 '+chatSave.aff+'（'+affTier().name+'）<br>章节 '+done
        +' · 结局 '+ends+'/'+CHAT_ENDINGS.length+'<br>进度自动存档于本浏览器，导出可跨设备转移';
    $('save-textarea').value = '';
    $('save-overlay').classList.remove('hidden');
}
document.getElementById('save-btn').addEventListener('click', openSaveMgr);
document.getElementById('save-close-btn').addEventListener('click', function(){ $('save-overlay').classList.add('hidden'); });
document.getElementById('save-copy-btn').addEventListener('click', function(){
    const s = exportSave();
    $('save-textarea').value = s;
    const done = function(){ showCheatToast('📋 存档已复制，找个安全的地方贴好它', 2500); };
    if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(s).then(done, function(){ $('save-textarea').select(); showCheatToast('自动复制失败，已全选文本，请手动 Ctrl+C', 3000); });
    } else {
        $('save-textarea').select();
        try{ document.execCommand('copy'); done(); }catch(e){ showCheatToast('请手动全选文本复制', 3000); }
    }
});
document.getElementById('save-download-btn').addEventListener('click', function(){
    const blob = new Blob([exportSave()], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bomb_save_' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
});
document.getElementById('save-import-btn').addEventListener('click', function(){
    const text = $('save-textarea').value.trim();
    if(!text){ showCheatToast('先把存档文本粘贴到下面的框里', 2500); return; }
    const err = importSave(text);
    if(err){ showCheatToast('⚠️ '+err, 3000); return; }
    showCheatToast('✅ 存档导入成功，即将刷新…', 2000);
    setTimeout(function(){ location.reload(); }, 1200);
});
document.getElementById('save-reset-btn').addEventListener('click', function(){
    if(!confirm('只清除剧情存档（好感度/章节/结局/她的名字），设置与战绩保留。\n确定继续吗？')) return;
    try{ localStorage.removeItem('bomb_chat_story'); }catch(e){}
    showCheatToast('🗑️ 剧情存档已重置，即将刷新…', 2000);
    setTimeout(function(){ location.reload(); }, 1200);
});
