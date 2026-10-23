import { BOTTLES, SPECIES } from './data';
import { CharId, QueueItem, SaveState, canBookIce, canUnlockIce, speciesCount } from './state';

export const CHARS: Record<CharId, { name: string; avatar: string; color: string; title?: string }> = {
  me: { name: '阿渔', avatar: '🧑', color: '#3b82f6', title: '你，钓鱼新手' },
  mom: { name: '老妈', avatar: '👩‍🦳', color: '#ec4899', title: '家庭最高指挥官' },
  cuihua: { name: '翠花姐', avatar: '👩‍🦰', color: '#10b981', title: '翠花渔具店老板娘' },
  dapao: { name: '大炮哥', avatar: '🧔', color: '#ef4444', title: '大炮枪械铺老板' },
  mayor: { name: '王镇长', avatar: '👨‍💼', color: '#f59e0b', title: '阳光湾镇长' },
  kevin: { name: '凯文_钓鱼一哥', avatar: '😎', color: '#8b5cf6', title: '百万粉丝钓鱼网红（自称）' },
  gull: { name: '海鸥史蒂夫', avatar: '🐦', color: '#64748b', title: '职业偷鱼' },
  unknown: { name: '未知号码', avatar: '❓', color: '#475569', title: '来电地区：北方某处' },
  grandpa: { name: '海爷爷', avatar: '👴', color: '#0ea5e9', title: '失踪二十年的传奇渔夫' },
  bobo: { name: '企鹅波波', avatar: '🐧', color: '#1e293b', title: '冰海桑拿前台' },
  bottle: { name: '漂流瓶', avatar: '🍾', color: '#16a34a', title: '来自海底的信' },
  seal: { name: '海豹老板', avatar: '🦭', color: '#78716c', title: '冰海防流鳍专卖' },
};

export interface ComicPanel {
  art: string;
  bg: string;
  caption?: string;
  who?: CharId;
  say?: string;
}

export interface Comic {
  id: string;
  title: string;
  panels: ComicPanel[];
}

export const COMICS: Record<string, Comic> = {
  prologue: {
    id: 'prologue',
    title: '序章 · 爷爷去买烟了',
    panels: [
      { art: '🏠 👴 🚬', bg: 'linear-gradient(160deg,#fde68a,#fca5a5)', caption: '二十年前，海爷爷说要出门买包烟。' },
      { art: '🚪 💨', bg: 'linear-gradient(160deg,#e5e7eb,#9ca3af)', caption: '然后他就再也没回来。' },
      { art: '👩‍🦳 📱', bg: 'linear-gradient(160deg,#fbcfe8,#f9a8d4)', who: 'mom', say: '你爷爷留下了一条船、一把枪，还有满墙的「钓鱼节冠军」奖状。你别整天在家打游戏了！' },
      { art: '🧑 🚤 🔫', bg: 'linear-gradient(160deg,#bae6fd,#38bdf8)', who: 'me', say: '所以……用枪钓鱼？这合法吗？' },
      { art: '🐟 💥 🔫', bg: 'linear-gradient(160deg,#fef08a,#fb923c)', caption: '这是阳光湾的传统钓鱼法：先把鱼钓上来，再把它们在空中打下来。' },
      { art: '⬇️ 🎣 ⬆️ 🔫', bg: 'linear-gradient(160deg,#a7f3d0,#34d399)', caption: '玩法：①下潜时左右移动躲开鱼 ②撞到鱼后收线，尽量多钩鱼 ③鱼飞上天后点击射击！' },
    ],
  },
  kevin: {
    id: 'kevin',
    title: '第二话 · 网红的挑战',
    panels: [
      { art: '😎 📸', bg: 'linear-gradient(160deg,#ddd6fe,#a78bfa)', who: 'kevin', say: '家人们！今天带大家看看什么叫专业钓鱼！双击 666！' },
      { art: '🧑 🚤  ⚔️  🛥️ 😎', bg: 'linear-gradient(160deg,#bae6fd,#0ea5e9)', caption: '网红凯文开着租来的游艇，向你发起挑战。' },
      { art: '😎 🥅 🌊', bg: 'linear-gradient(160deg,#7dd3fc,#0369a1)', who: 'kevin', say: '用渔网！高效！环保！记得点赞关注！' },
      { art: '🥅 🦈', bg: 'linear-gradient(160deg,#0ea5e9,#075985)', caption: '他网到了一条小鲨鱼。' },
      { art: '🦈 😱 📱 💦', bg: 'linear-gradient(160deg,#0369a1,#0c4a6e)', caption: '然后小鲨鱼网到了他。', who: 'kevin', say: '我的手机！！！' },
      { art: '🧑 🔫 🦈 💥', bg: 'linear-gradient(160deg,#fde68a,#f97316)', caption: '你一枪把鲨鱼打上了天，顺便赚了 58 块。' },
      { art: '😎 💧 🙃', bg: 'linear-gradient(160deg,#e0e7ff,#a5b4fc)', who: 'kevin', say: '……这期视频不发了。手机好像沉到 240 米那边去了。' },
    ],
  },
  north: {
    id: 'north',
    title: '第三话 · 北上冰海',
    panels: [
      { art: '🚢 ➖ 🚤 🧊', bg: 'linear-gradient(160deg,#c7d2fe,#6366f1)', caption: '你买的「船票」，其实是把你的小船用绳子绑在一艘破冰船后面。' },
      { art: '🥶 🧑 🥶', bg: 'linear-gradient(160deg,#e0f2fe,#7dd3fc)', who: 'me', say: '为什么没有人提醒我带外套？！' },
      { art: '🌌 ✨ 🌊', bg: 'linear-gradient(160deg,#0b1030,#1f6f5c)', caption: '极光在头顶跳舞，海水黑得像墨汁。你感觉头灯会很有用。' },
      { art: '🐧 📱', bg: 'linear-gradient(160deg,#f1f5f9,#94a3b8)', caption: '一只企鹅站在浮冰上玩手机。', who: 'bobo', say: '嘎。（已读不回）' },
      { art: '🛖 ♨️ 🪧', bg: 'linear-gradient(160deg,#1e1b4b,#312e81)', caption: '远处有一座冒着热气的小屋，招牌上写着：「海爷爷桑拿 · 企鹅八折」', who: 'me', say: '……不会吧。' },
    ],
  },
  ending: {
    id: 'ending',
    title: '终章 · 爷爷的假牙',
    panels: [
      { art: '👑 🐟 💥', bg: 'linear-gradient(160deg,#fde047,#f97316)', caption: '你把传说中的鱼王打上了天！' },
      { art: '🦷 ✨', bg: 'linear-gradient(160deg,#e0f2fe,#bae6fd)', caption: '一副闪闪发光的假牙从天而降，正好落在你的船上。' },
      { art: '🛖 ♨️ 👴 🐧 🐧', bg: 'linear-gradient(160deg,#1e1b4b,#7c3aed)', caption: '桑拿房的门「砰」地打开。', who: 'grandpa', say: '我的牙！！！' },
      { art: '👴 🦷 😁', bg: 'linear-gradient(160deg,#fef3c7,#fbbf24)', who: 'grandpa', say: '二十年了！老子终于能啃甘蔗了！' },
      { art: '🧑 ❓ 👴', bg: 'linear-gradient(160deg,#cffafe,#22d3ee)', who: 'me', say: '所以……你这二十年一直在这儿开桑拿？' },
      { art: '👴 🐧 🐟', bg: 'linear-gradient(160deg,#e2e8f0,#94a3b8)', who: 'grandpa', say: '企鹅们给的小费很丰厚。用鱼付的。' },
      { art: '📱 👩‍🦳 💢', bg: 'linear-gradient(160deg,#fecdd3,#fb7185)', caption: '这时，老妈打来了视频电话。', who: 'mom', say: '海大海！！你说去买的烟呢？！' },
      { art: '👴 💦 🚬', bg: 'linear-gradient(160deg,#fde68a,#f59e0b)', who: 'grandpa', say: '……我、我这就去买。' },
      { art: '🎣 🌅 🐟', bg: 'linear-gradient(160deg,#fdba74,#7c3aed)', caption: 'THE END……？ 钓鱼永不结束！海爷爷送了你一顶亲手织的企鹅帽。继续收集全部图鉴吧！' },
    ],
  },
};

type Action =
  | { sms: CharId; text: string; key?: boolean }
  | { post: CharId; text: string; likes?: number; key?: boolean }
  | { q: QueueItem }
  | { reward: number }
  | { hat: string };

/** 默认算主线的说话人：悬疑线 / 爷爷 / 冰海 NPC，这些消息值得让手机亮一下 */
const KEY_THREADS: CharId[] = ['unknown', 'grandpa', 'bobo', 'seal'];

export interface StoryEvent {
  id: string;
  cond: (s: SaveState) => boolean;
  actions: Action[];
}

const sp = (s: SaveState, id: string) => (s.caught[id] || 0) > 0;

export const EVENTS: StoryEvent[] = [
  {
    // 开场只留漫画：它已经把世界观和玩法讲完了。
    // 翠花电话和镇长公告挪到第一局之后——那时玩家才真正需要「升级鱼线」「别打水母」。
    id: 'intro',
    cond: () => true,
    actions: [{ q: { kind: 'comic', id: 'prologue' } }],
  },
  {
    id: 'introAfterFirst',
    cond: (s) => s.trips >= 1 && s.fired.includes('intro'),
    actions: [
      {
        q: {
          kind: 'call',
          from: 'cuihua',
          topic: '渔具店的熟人',
          lines: [
            { text: '喂？是海家的小子吧？我是渔具店的翠花！' },
            { text: '你爷爷以前是我们店的 VIP，欠了我三十年的鱼线钱……开玩笑的，其实是二十年。' },
            { me: true, text: '呃……' },
            { text: '总之！手机上装了我们店的 APP，赚了钱记得来升级鱼线。线越长，钓得越深，鱼越值钱！' },
            { text: '对了，你手机里今天多了两个图标：「鱼博」是看别人吹牛的，「渔具店」是花钱的。先点渔具店，你那条线细得像挂面。' },
            { text: '还有，看到粉色的水母千万别打！镇上罚款可狠了。' },
            { me: true, text: '好的翠花姐。' },
          ],
        },
      },
      { q: { kind: 'notice', org: '阳光湾镇政府', title: '📢 第 38 届阳光湾钓鱼节开幕！', text: '本届规则：钓得多、打得准、赚得多者为胜。\n\n温馨提示：\n1. 请勿向水母开枪（罚款按当次收入比例计算）\n2. 请勿向海鸥开枪（它会记仇）\n3. 请勿向镇长开枪\n\n—— 王镇长 敬上' } },
      { sms: 'mom', text: '儿子，你爷爷的船我让人擦干净了，今天就给我出海！别又宅在家里打游戏。' },
      { sms: 'mom', text: '钓不到鱼别回来吃饭。' },
    ],
  },
  {
    id: 'firstTrip',
    cond: (s) => s.trips >= 1,
    actions: [
      { sms: 'dapao', text: '兄弟！听说你用你爷爷那把老手枪打鱼？有前途！！' },
      { sms: 'dapao', text: '来我店里看看，霰弹枪打鱼，一枪一盘刺身！' },
      { post: 'kevin', text: '今天用渔网一口气捞了 300 斤，有些人还在用手枪钓鱼呢😅 时代变了。#钓鱼一哥 #高效 #自律', likes: 12 },
      { post: 'gull', text: '今天从一个新来的渔夫船上偷了一条沙丁鱼。人生巅峰。', likes: 2031 },
    ],
  },
  {
    // 第 2 趟：解锁「枪械铺」「战绩」。这两个是纯功能升级，玩家不会自己去翻，必须有人喊一声。
    id: 'unlockGuns',
    cond: (s) => s.trips >= 2,
    actions: [
      {
        q: {
          kind: 'call',
          from: 'dapao',
          topic: '枪械铺给你开了',
          lines: [
            { text: '海家小子！听说你两趟都活着回来了，行啊。' },
            { text: '你手机里那个「枪械铺」，我给你开了。手枪打一条，霰弹枪打一片，自己算账。' },
            { text: '旁边那个「战绩」也顺手开了：命中多少、亏了多少钱，全给你记着。' },
            { me: true, text: '亏钱也记？' },
            { text: '不记亏钱，你怎么知道该换枪。' },
            { text: '（嘟——）' },
          ],
        },
      },
    ],
  },
  {
    // 第 3 趟：解锁「航线」。不是为了立刻能走，而是让玩家看见「北边那片海」这个长线目标。
    id: 'unlockRoute',
    cond: (s) => s.trips >= 3 && !s.unlocked.includes('ice'),
    actions: [
      {
        q: {
          kind: 'call',
          from: 'mayor',
          topic: '航线开通',
          lines: [
            { text: '海大海同志吗？我是王镇长。' },
            { text: '你出海满三趟了，镇上给你开了「航线」功能。' },
            { me: true, text: '我现在能去别的地方了？' },
            { text: '目前只有阳光湾。不过北边那片冰海，航线上给你留了个位置。' },
            { text: '潜到 180 米，认识 8 种鱼，那片海就会亮起来。' },
            { me: true, text: '……你怎么知道这些？' },
            { text: '你爷爷当年也是这么走的。' },
            { text: '（挂断）' },
          ],
        },
      },
    ],
  },
  {
    // 第 4 趟：解锁「帽子」。纯装饰，一条轻消息就够，不值得打电话。
    id: 'unlockHat',
    cond: (s) => s.trips >= 4,
    actions: [
      { sms: 'mom', text: '你三婶给你织了几顶帽子，我放你船上了。手机里那个「帽子」能换着戴——别再晒成黑炭。' },
    ],
  },
  {
    id: 'd60',
    cond: (s) => s.maxDepth.bay >= 60,
    actions: [
      { sms: 'unknown', text: '……深一点……' },
      { sms: 'unknown', text: '……再深一点……' },
      { sms: 'mom', text: '你手机是不是中病毒了？我也收到一条奇怪短信说「把孩子喂饱点」。' },
    ],
  },
  {
    id: 'money400',
    cond: (s) => s.totalEarned >= 400,
    actions: [{ sms: 'cuihua', text: '小伙子赚到钱啦？鱼线该升级了哦～姐给你打个九九折！（原价）' }],
  },
  {
    id: 'trip3',
    cond: (s) => s.trips >= 3,
    actions: [
      { post: 'mayor', text: '【镇长信箱】有居民反映海上经常传来枪声。经调查，是正常钓鱼活动，请大家放心。', likes: 88 },
      { post: 'gull', text: '有人说我是小偷。我不是小偷，我是「海产品再分配专家」。', likes: 5620 },
    ],
  },
  {
    id: 'jelly1',
    cond: (s) => s.jellyHits >= 1,
    actions: [
      { q: { kind: 'notice', org: '阳光湾海洋管理局', title: '⚠️ 罚款通知书', text: '经查，您于本日在海面上空射击水母一只。\n\n水母虽然没有大脑，但它有尊严。\n\n罚款已按您本次收入的比例自动扣除。请珍爱果冻，从我做起。' } },
      { sms: 'mom', text: '你打水母了？？全镇都传遍了！你王阿姨在菜市场问我是不是家教有问题！' },
    ],
  },
  {
    id: 'd120',
    cond: (s) => s.maxDepth.bay >= 120,
    actions: [
      {
        q: {
          kind: 'call',
          from: 'unknown',
          // 主线节点：第一次听见「海底的瓶子」，必须接。这一通电话决定后面所有漂流瓶的分量。
          force: true,
          topic: '海底的瓶子',
          lines: [
            { text: '（呼……呼……海风声……）' },
            { me: true, text: '喂？谁啊？' },
            { text: '（呼……）……海底……有我留下的瓶子……' },
            { text: '……找到它们……还有……帮我看看菜市场的带鱼现在多少钱一斤……' },
            { me: true, text: '啊？' },
            { text: '（嘟——嘟——嘟——）' },
          ],
        },
      },
      { post: 'kevin', text: '有人说在阳光湾海底看到了漂流瓶？炒作罢了。我凯文从不相信这种东西。（私信我坐标）', likes: 45 },
    ],
  },
  {
    id: 'bottle1',
    cond: (s) => s.bottles.includes('b1'),
    actions: [
      { sms: 'mom', text: '你发来的照片……这字迹！是你爷爷的！这老东西还活着？！', key: true },
      { sms: 'mom', text: '找到他告诉他，他欠我一包烟。二十年的利息另算。' },
      { sms: 'unknown', text: '你找到了。继续。' },
    ],
  },
  {
    id: 'species7',
    cond: (s) => speciesCount(s, 'bay') >= 7,
    actions: [
      { q: { kind: 'notice', org: '阳光湾镇政府', title: '🏆 钓鱼节中期排行榜', text: '第一名：凯文（数据由凯文本人提供）\n第二名：阿渔\n第三名：海鸥史蒂夫（数据由受害者提供）\n\n请各位选手再接再厉！' } },
      { post: 'kevin', text: '排行榜第一，意料之中。感谢家人们支持！PS：谁说数据是我自己报的，拿出证据。', likes: 3 },
    ],
  },
  {
    id: 'd200',
    cond: (s) => s.maxDepth.bay >= 200,
    actions: [
      { q: { kind: 'comic', id: 'kevin' } },
      { post: 'kevin', text: '用我妈手机发的。我的手机掉海里了，谁捡到了还我，里面有我的美颜设置。', likes: 1 },
      { post: 'gull', text: '今天目睹一个人类被鲨鱼网住。年度最佳。', likes: 99999 },
    ],
  },
  {
    id: 'goldfish',
    cond: (s) => sp(s, 'goldfish'),
    actions: [
      { q: { kind: 'notice', org: '阳光湾镇政府', title: '📢 关于本人金鱼的声明', text: '近日有渔民在 340 米深处捕获一条巨型金鱼。\n\n本人郑重声明：那条金鱼不是我三年前因为懒得换水倒进海里的「小金」。\n\n另外，它还好吗？它吃得饱吗？\n\n—— 王镇长' } },
      { post: 'mayor', text: '今天心情复杂。', likes: 520 },
    ],
  },
  {
    // 中段钩子：180m 时先给「北方还有一片海」，让玩家在攒钱的十几局里有盼头。
    // 真正的船票信息留到 250m 的 unlockReady。
    id: 'iceHint',
    cond: (s) => canBookIce(s) && !canUnlockIce(s) && !s.unlocked.includes('ice'),
    actions: [
      {
        q: {
          kind: 'call',
          from: 'unknown',
          force: true,
          topic: '北方还有一片海',
          lines: [
            { text: '（信号很差，风声盖过了人声）' },
            { text: '……你潜到 180 米了。' },
            { me: true, text: '你是谁？' },
            { text: '往北。还有一片海，比这里深得多。' },
            { text: '再深一点……我就告诉你船票在哪买。' },
            { text: '（嘟——嘟——）' },
          ],
        },
      },
    ],
  },
  {
    id: 'unlockReady',
    cond: (s) => canUnlockIce(s) && !s.unlocked.includes('ice'),
    actions: [
      {
        q: {
          kind: 'call',
          from: 'grandpa',
          force: true,
          topic: '爷爷还活着',
          lines: [
            { text: '孩子……是我。你爷爷。' },
            { me: true, text: '爷爷？！你真的还活着？！你在哪？！' },
            { text: '我在北边的极光冰海。说来话长……二十年前，一条鱼偷了我的假牙。' },
            { me: true, text: '……所以你就追了二十年？' },
            { text: '没有假牙我连烟都叼不住啊！' },
            { text: '你已经是个合格的渔夫了。打开「航线」APP，买张去冰海的船票，2400 块。' },
            { text: '记得带外套。还有……别告诉你妈我在哪。' },
          ],
        },
      },
    ],
  },
  {
    id: 'iceUnlocked',
    cond: (s) => s.unlocked.includes('ice'),
    actions: [
      { q: { kind: 'comic', id: 'north' } },
      { q: { kind: 'notice', org: '极光冰海管理处', title: '❄️ 游客须知', text: '欢迎来到极光冰海！\n\n1. 越往深处越黑，请自备头灯\n2. 洋流湍急，鱼钩会被冲走，请购买防流鳍\n3. 电鳗会电人，钩到会甩掉两条鱼\n4. 请勿喂企鹅吃辣条\n5. 海爷爷桑拿营业时间：全天（永夜）' } },
      { post: 'mom', text: '儿子去北方了，说是出差。有谁知道北方哪里有卖外套的？', likes: 34 },
    ],
  },
  {
    id: 'iceTrip1',
    cond: (s) => s.maxDepth.ice > 0,
    actions: [
      { sms: 'bobo', text: '嘎。' },
      { sms: 'bobo', text: '嘎嘎。（翻译：欢迎来到冰海。海爷爷让我接你。他说你肯定忘了带外套。）' },
      { sms: 'bobo', text: '（以及：桑拿会员卡充 500 送一条鳕鱼）' },
      { sms: 'seal', text: '你好，这里是冰海防流鳍专卖店。你们翠花姐的货是我供的，好评返现哦。' },
      { post: 'bobo', text: '嘎嘎嘎嘎！📸（配图：一个冻成冰棍的人类渔夫）', likes: 777 },
    ],
  },
  {
    id: 'ice300',
    cond: (s) => s.maxDepth.ice >= 300,
    actions: [
      {
        q: {
          kind: 'call',
          from: 'grandpa',
          force: true,
          topic: '鱼王与假牙',
          lines: [
            { text: '孩子，你离它越来越近了。' },
            { text: '鱼王就在 500 米以下。金色的，比你的船还大，嘴里闪闪发光的就是我的假牙。' },
            { me: true, text: '它有多难打？' },
            { text: '它皮糙肉厚，你得多打几枪。建议带把好枪……大炮那小子的店还开着吧？' },
            { text: '他爸以前就是卖弹弓的。一家子都一个德行。' },
          ],
        },
      },
      { post: 'gull', text: '我飞到北极了。这里的鱼更肥，这里的企鹅更好骗。', likes: 12000 },
    ],
  },
  {
    id: 'legend',
    cond: (s) => s.legend,
    actions: [
      { q: { kind: 'comic', id: 'ending' } },
      { hat: 'penguin' },
      { reward: 2000 },
      { sms: 'grandpa', text: '孩子，企鹅帽是我亲手织的，戴上它钓鱼运气会好。我去买烟了，这次真的会回来。' },
      { sms: 'mom', text: '你爷爷到家了。带了一包烟，和四十只企鹅。家里住不下了你快回来！' },
      { post: 'mayor', text: '热烈欢迎传奇渔夫海大海先生回到阳光湾！另：请把企鹅带走。', likes: 3888 },
      { post: 'kevin', text: '恭喜阿渔……好吧，你确实比我强一点点。一点点。', likes: 250 },
      { post: 'bobo', text: '嘎！！（翻译：海爷爷的桑拿我接手了，欢迎光临！）', likes: 10086 },
    ],
  },
  {
    id: 'allSpecies',
    cond: (s) => SPECIES.filter((x) => x.special !== 'jelly').every((x) => (s.caught[x.id] || 0) > 0),
    actions: [
      { reward: 5000 },
      { sms: 'grandpa', text: '全图鉴收集完成！你已经超越了我。这 5000 块是我桑拿店的分红，拿着。' },
    ],
  },
  { id: 'trip8', cond: (s) => s.trips >= 8, actions: [{ post: 'cuihua', text: '本店新到一批鱼线，结实到可以拿来跳绳。欢迎选购！', likes: 66 }] },
  { id: 'trip14', cond: (s) => s.trips >= 14, actions: [{ post: 'dapao', text: '有人问我：「大炮哥，用枪钓鱼是不是太残忍了？」我说：「那你吃过烤鱼吗？」他沉默了。', likes: 1200 }] },
  { id: 'best1500', cond: (s) => s.bestTrip >= 1500, actions: [{ post: 'kevin', text: '最近在思考人生。可能渔网真的不太行。', likes: 5 }] },
  { id: 'combo12', cond: (s) => s.bestCombo >= 12, actions: [{ sms: 'cuihua', text: '听说你一口气连打十二条鱼？！我这鱼钩质量是真的好啊，记得给我写好评！' }] },
];

export function bottleById(id: string) {
  return BOTTLES.find((b) => b.id === id);
}

/** 条件驱动的事件执行器：每次状态变更后重跑，fired 去重 */
export function runStory(s: SaveState): SaveState {
  let next: SaveState = {
    ...s,
    fired: [...s.fired],
    messages: [...s.messages],
    feed: [...s.feed],
    queue: [...s.queue],
    unread: { ...s.unread },
    unreadKey: { ...s.unreadKey },
    comics: [...s.comics],
    hats: [...s.hats],
    notices: [...s.notices],
  };
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 6) {
    changed = false;
    for (const ev of EVENTS) {
      if (next.fired.includes(ev.id)) continue;
      if (!ev.cond(next)) continue;
      next.fired.push(ev.id);
      changed = true;
      ev.actions.forEach((a, i) => {
        const id = `${ev.id}_${i}`;
        if ('sms' in a) {
          const key = a.key ?? KEY_THREADS.includes(a.sms);
          next.messages.push({ id, thread: a.sms, text: a.text, trip: next.trips, key });
          next.unread.sms = (next.unread.sms || 0) + 1;
          if (key) next.unreadKey.sms = (next.unreadKey.sms || 0) + 1;
        } else if ('post' in a) {
          next.feed.push({ id, author: a.post, text: a.text, likes: a.likes ?? Math.floor(Math.random() * 200), trip: next.trips });
          next.unread.feed = (next.unread.feed || 0) + 1;
          if (a.key) next.unreadKey.feed = (next.unreadKey.feed || 0) + 1;
        } else if ('q' in a) {
          // 漫画与来电默认是主线（必须看），公告/瓶子默认可稍后处理
          const tier = a.q.tier ?? (a.q.kind === 'comic' || a.q.kind === 'call' ? 'main' : 'side');
          next.queue.push({ ...a.q, uid: id, tier });
          // 公告留档：岛上那条会消失，手机通知栏里还能回看
          if (a.q.kind === 'notice' && !next.notices.some((n) => n.id === id)) {
            next.notices.push({
              id,
              title: a.q.title,
              text: a.q.text,
              org: a.q.org,
              trip: next.trips,
              kind: 'notice',
            });
          }
          if (a.q.kind === 'comic' && !next.comics.includes(a.q.id)) {
            next.comics.push(a.q.id);
            next.unread.comic = (next.unread.comic || 0) + 1;
            next.unreadKey.comic = (next.unreadKey.comic || 0) + 1;
          }
        } else if ('reward' in a) {
          next = { ...next, money: next.money + a.reward };
        } else if ('hat' in a) {
          if (!next.hats.includes(a.hat)) next = { ...next, hats: [...next.hats, a.hat] };
          next.unread.hat = (next.unread.hat || 0) + 1;
          next.unreadKey.hat = (next.unreadKey.hat || 0) + 1;
        }
      });
      if (ev.id === 'unlockReady') {
        next.unread.route = (next.unread.route || 0) + 1;
        next.unreadKey.route = (next.unreadKey.route || 0) + 1;
      }
    }
  }
  return next;
}


/**
 * 回拨台词。玩家主动打过去时播这一段 —— 每个人的反应要能对上人设，
 * 打不通的（未知号码 / 爷爷）就留白，本身就是剧情。
 */
export const CALLBACKS: Partial<Record<CharId, { me?: boolean; text: string }[]>> = {
  cuihua: [
    { text: '喂？' },
    { text: '你终于打回来了。我还以为你被鱼拖走了。' },
    { me: true, text: '……我刚上来。' },
    { text: '渔具店新到一批线，别再买那种一拉就断的。' },
    { text: '……行吧。注意安全。' },
  ],
  dapao: [
    { text: '大炮枪械铺，要什么直接说。' },
    { me: true, text: '随便看看。' },
    { text: '看看？看看也收钱。' },
    { text: '算了，来店里，给你打折。' },
  ],
  mayor: [
    { text: '王镇长办公室。' },
    { text: '钓鱼节的报名费还没交呢。' },
    { me: true, text: '我爷爷那辈就交过了。' },
    { text: '……行，看在你爷爷面子上。' },
  ],
  mom: [
    { text: '喂，吃饭了没有？' },
    { me: true, text: '吃了。' },
    { text: '又吃鱼？' },
    { me: true, text: '……' },
    { text: '找个正经工作吧。' },
  ],
  kevin: [
    { text: '喂喂喂！这里是凯文！' },
    { text: '你也在钓鱼？哪个平台的？' },
    { me: true, text: '我不直播。' },
    { text: '（对方失去了兴趣，挂断了）' },
  ],
  bobo: [
    { text: '企鹅桑拿，前台波波。' },
    { text: '先生，您上次的浴巾还没还。' },
  ],
  seal: [
    { text: '冰海防流鳍，专治各种鳍。' },
    { text: '不买别打，信号费很贵。' },
  ],
  unknown: [
    { text: '（拨号中……）' },
    { text: '（无人接听。听筒里只有海风。）' },
  ],
  grandpa: [
    { text: '（拨号中……）' },
    { text: '（您拨打的号码不在服务区。）' },
    { text: '（这个号码，已经二十年没人用了。）' },
  ],
};
