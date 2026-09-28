export type OutcomeKey = "a" | "b" | "c" | "d";

type Choice = { text: string; primary: OutcomeKey; secondary: OutcomeKey };
type Question = { prompt: string; choices: [Choice, Choice, Choice] };

export type FunTestOutcome = {
  id: OutcomeKey;
  name: string;
  description: string;
  typical: string;
  bond: string;
  closing: string;
  keywords: [string, string];
  tip: string;
};

export type FunTest = {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  cover: string;
  introduction: string;
  disclaimer: string;
  questions: Question[];
  outcomes: [FunTestOutcome, FunTestOutcome, FunTestOutcome, FunTestOutcome];
};

type ChoiceDraft = [text: string, primary: OutcomeKey, secondary: OutcomeKey];
const q = (prompt: string, first: ChoiceDraft, second: ChoiceDraft, third: ChoiceDraft): Question => ({
  prompt,
  choices: [first, second, third].map(([text, primary, secondary]) => ({ text, primary, secondary })) as Question["choices"],
});

const entertainment = "趣味测试仅供娱乐，结果来自你的日常观察，不是行为学诊断。";

export const funTests: FunTest[] = [
  {
    id: "hidden-personality",
    title: "它的隐藏性格",
    subtitle: "十个小场景，看看家里这位到底是哪种主角。",
    category: "性格观察",
    cover: "personality",
    introduction: "按它平时最常见的反应选，不必寻找标准答案。",
    disclaimer: entertainment,
    questions: [
      q("早晨醒来，它通常先做什么？", ["满屋巡游，像在点名", "a", "d"], ["盯着窗外研究半天", "b", "d"], ["先来你身边报到", "c", "a"]),
      q("家里来了新玩具，它会？", ["马上上爪试玩", "a", "b"], ["绕两圈，确认没有机关", "b", "d"], ["等你一起拆才开心", "c", "a"]),
      q("听见门外有动静时？", ["冲到门边迎接未知嘉宾", "a", "c"], ["找好位置静静观察", "b", "d"], ["先看你一眼再行动", "d", "c"]),
      q("拍照时它最像？", ["自动进入镜头的明星", "a", "c"], ["被拍到才发现的侦探", "b", "d"], ["坚持贴着你入镜的搭档", "c", "a"]),
      q("你在忙，它会怎样陪着？", ["拿玩具来邀请你休息", "a", "c"], ["在附近安静研究自己的事", "b", "d"], ["找个不碍事的位置守着", "d", "c"]),
      q("它最中意的家中位置？", ["能看到所有人的中心位", "a", "d"], ["只有它知道的观察角", "b", "d"], ["离你一伸手就到的地方", "c", "a"]),
      q("零食出现时，它像？", ["快乐得先转两圈", "a", "c"], ["先闻闻，认真鉴定", "b", "d"], ["端端正正等口令", "d", "b"]),
      q("你短暂出门再回家，它会？", ["举行一场欢迎仪式", "a", "c"], ["悄悄出现，仿佛早就知道", "b", "d"], ["一路跟着确认你回来了", "c", "d"]),
      q("遇到没见过的地方？", ["先迈第一步带路", "a", "d"], ["每个角落都要闻一遍", "b", "a"], ["跟你保持同一节奏", "c", "d"]),
      q("准备睡觉时，最后一个动作是？", ["再玩一小会儿", "a", "c"], ["检查周围才躺下", "d", "b"], ["靠近你，找个安心角度", "c", "d"]),
    ],
    outcomes: [
      { id: "a", name: "社交小太阳", description: "它对新鲜事有一颗跃跃欲试的心，快乐很容易写在脸上。", typical: "听见熟悉的声音就跑来，玩具刚落地就想抢先试试。", bond: "你像它最信任的观众，普通的一天也能被它演成热闹的小剧场。", closing: "它的热情不用一直满格；愿意把兴奋分享给你，已经是很可爱的偏爱。", keywords: ["好奇", "热场"], tip: "今天留五分钟，陪它玩一次它主动发起的游戏。" },
      { id: "b", name: "安静侦探", description: "它不急着表态，却总能先注意到别人忽略的小变化。", typical: "对新物件先闻再碰，喜欢在固定的角落观察全场。", bond: "你是它放下戒备后愿意靠近的人；那一步慢慢走来的距离特别珍贵。", closing: "它的爱常常没有大动作，但会藏在每一次悄悄靠近里。", keywords: ["观察", "慢热"], tip: "给它一个可以安静看世界的小位置。" },
      { id: "c", name: "黏人棉花糖", description: "它最懂得把靠近变成一种柔软的日常。", typical: "你换个房间它也跟着，休息时总能找到离你不远的位置。", bond: "对它来说，你的在场就是最安心的背景音。", closing: "被它选作安全区，是一件值得偷偷开心的小事。", keywords: ["贴贴", "安心"], tip: "忙完手上的事，记得回应一下它的小小跟随。" },
      { id: "d", name: "认真小队长", description: "它对熟悉的节奏很上心，像在维护这个家的小秩序。", typical: "记得吃饭和散步时间，听见异常动静会先确认情况。", bond: "你们像默契的队友：它守着日常，你给它稳定的依靠。", closing: "这份认真背后，是它把这里当成了自己的家。", keywords: ["可靠", "节奏"], tip: "按它熟悉的节奏，安排一段没有催促的相处时间。" },
    ],
  },
  {
    id: "little-luck",
    title: "它带来的小小好运",
    subtitle: "不是预言，是发现生活里被它点亮的瞬间。",
    category: "今日好运",
    cover: "luck",
    introduction: "想想和它待在一起时，最容易发生哪种小小好事。",
    disclaimer: "本测试只提供娱乐性的好运想象，不预测财运，也不提供投资或现实决策建议。",
    questions: [
      q("匆忙的早上，它最可能？", ["在光里伸懒腰，让你慢半拍", "a", "d"], ["忽然做出一个好笑动作", "b", "a"], ["一路送你到门口", "c", "d"]),
      q("周末天气很好，你们会？", ["找块舒服的地方晒太阳", "a", "d"], ["试试一条没走过的小路", "b", "c"], ["遇见熟人就停下聊聊", "c", "b"]),
      q("你刚坐下休息，它会？", ["在旁边安静打盹", "d", "a"], ["带来一件不知哪找的小宝贝", "b", "a"], ["凑过来讨一声夸奖", "c", "d"]),
      q("朋友来家里，它一般？", ["带着大家一起热闹", "c", "b"], ["给大家一个意外表情包", "b", "c"], ["在熟悉的位置安心旁观", "d", "a"]),
      q("它最会提醒你注意什么？", ["窗边的一小块阳光", "a", "d"], ["角落里新出现的小东西", "b", "a"], ["每天差不多时间的晚饭", "d", "c"]),
      q("你带回新物件，它先？", ["认真闻出新鲜气味", "b", "a"], ["看你是不是很开心", "c", "d"], ["确认旧窝还在原处", "d", "a"]),
      q("一起拍照，最容易留下？", ["阳光刚好落在它身上的画面", "a", "d"], ["没准备好却特别好笑的一张", "b", "c"], ["它和朋友同框的瞬间", "c", "a"]),
      q("它的小收藏更像？", ["晒过太阳的舒服角落", "a", "d"], ["各处叼来的奇怪物件", "b", "c"], ["你常穿的一件衣服", "d", "c"]),
      q("遇到平平无奇的一天，它会？", ["把小日常过得很有味道", "a", "d"], ["突然制造一个新笑点", "b", "a"], ["守在你身边直到一天结束", "d", "c"]),
      q("如果给它颁一枚徽章，你会写？", ["发现美好小事", "a", "b"], ["惊喜制造专业户", "b", "c"], ["让大家聚在一起", "c", "d"]),
    ],
    outcomes: [
      { id: "a", name: "日常拾光师", description: "它擅长把你错过的小风景重新放到眼前。", typical: "一小片阳光、一个舒服的午后，在它身边都变得值得停留。", bond: "它给你的好运，是忙碌里愿意放慢脚步的那一刻。", closing: "今天的好事或许很小，但你们一起看见了。", keywords: ["阳光", "留意"], tip: "幸运物：窗边那块刚好暖和的地方。" },
      { id: "b", name: "惊喜接球手", description: "它总能让计划之外的瞬间变成值得讲给朋友听的故事。", typical: "突然叼来奇怪物件，或者在镜头前贡献意外的表情。", bond: "你们的日子因为它，多了许多不必安排的笑声。", closing: "所谓好运，有时就是今天又多了一件可爱的小意外。", keywords: ["惊喜", "笑点"], tip: "幸运物：那件被它选中的旧玩具。" },
      { id: "c", name: "人缘召集官", description: "它像一张温柔的邀请函，总让人与人更容易聊起来。", typical: "见到熟面孔会主动打招呼，出门时常常成为话题中心。", bond: "它把自己的好奇心借给你，让平常的相遇也有了开场白。", closing: "这份好运不是谁来保证，而是你们已经拥有的连接。", keywords: ["相遇", "热情"], tip: "幸运物：一起出门时那根熟悉的牵引绳。" },
      { id: "d", name: "安稳守护星", description: "它把寻常日子守得很稳，给你一种“回家就好”的踏实。", typical: "记得固定的休息角落，也会在你坐下时安静待在附近。", bond: "它带来的好运，是一天结束后仍有人等你一起歇一会儿。", closing: "没有大场面，也能有一份刚刚好的幸福。", keywords: ["踏实", "归处"], tip: "幸运物：你们最喜欢的那张小毯子。" },
    ],
  },
  {
    id: "our-bond",
    title: "你们的陪伴关系",
    subtitle: "你和它，原来是这样一组默契搭档。",
    category: "陪伴关系",
    cover: "bond",
    introduction: "别猜它在想什么，选你们真实相处时最像的画面。",
    disclaimer: entertainment,
    questions: [
      q("你刚回家，它会？", ["立刻邀请你开启下一项活动", "a", "b"], ["一路跟着，等你安顿下来", "b", "d"], ["在老地方等一个熟悉的招呼", "d", "c"]),
      q("你们一起休息时？", ["各自放松，偶尔对视", "d", "a"], ["它总想贴近一点点", "b", "c"], ["谁先困了，另一个就跟着慢下来", "c", "d"]),
      q("出去走走时，你们更像？", ["共同探索新路线的队友", "a", "d"], ["它走哪都回头找你", "b", "c"], ["不用说话就知道该停哪儿", "d", "a"]),
      q("它发现你心情低落？", ["拉你玩，想把气氛带起来", "a", "b"], ["靠过来陪着，不急着做什么", "c", "b"], ["维持平日节奏，让一切稳稳的", "d", "c"]),
      q("你叫它名字，它通常？", ["像听到任务一样马上冲来", "a", "b"], ["用一个眼神确认是不是在叫它", "d", "c"], ["慢慢走近，想要一个摸摸", "b", "c"]),
      q("有新游戏时，谁先学会规则？", ["你们边试边互相教", "a", "c"], ["它看着你示范才放心", "b", "d"], ["玩两次就形成固定套路", "d", "a"]),
      q("你在工作，它最常？", ["叼玩具来安排短暂休息", "a", "b"], ["睡在看得到你的地方", "c", "d"], ["保持距离，但一直在同个房间", "d", "c"]),
      q("你们的合照通常是？", ["刚玩完，还在笑的瞬间", "a", "b"], ["它几乎贴在你脸边", "b", "c"], ["安静并排，像约好一样", "d", "c"]),
      q("到了吃饭时间？", ["它提醒你该开餐啦", "a", "d"], ["先找你，确定可以开始", "b", "c"], ["你们都记得固定的小流程", "d", "a"]),
      q("用一句话描述你们？", ["有事一起上", "a", "c"], ["走到哪都互相惦记", "b", "c"], ["安安静静也很懂彼此", "d", "c"]),
    ],
    outcomes: [
      { id: "a", name: "并肩搭子", description: "你们常在同一件小事里找到共同的兴致。", typical: "一个眼神就能开始游戏，新路线也愿意一起试。", bond: "你给它舞台，它给你把平凡日子玩出花样的理由。", closing: "最好的搭子，就是一声招呼就有人愿意出发。", keywords: ["一起行动", "同频"], tip: "今天试一个五分钟的新小游戏。" },
      { id: "b", name: "小尾巴同盟", description: "你们的距离感很近，去哪里都想确认对方在不在。", typical: "你换个房间它会跟来，散步时也不忘回头看。", bond: "它把你当坐标，你也早习惯了身边那串轻轻的脚步声。", closing: "被惦记的感觉，常常就是这样悄悄发生的。", keywords: ["跟随", "惦记"], tip: "给它一次不赶时间的贴贴。" },
      { id: "c", name: "互相照顾组", description: "你们总能察觉对方今天更需要热闹，还是更需要安静。", typical: "累了就靠近，开心时又一起分享热闹。", bond: "你照顾它的生活，它也用自己的方式接住你的情绪。", closing: "陪伴不是谁照顾谁更多，而是你们都愿意为彼此留位置。", keywords: ["回应", "温柔"], tip: "回想今天，它给过你的一个小回应。" },
      { id: "d", name: "默契室友", description: "你们各有节奏，却很清楚什么时候该靠近。", typical: "平时能各做各的，休息时又自然地待在一起。", bond: "不用时时黏着，彼此在场本身就让这个家完整。", closing: "这样不费力的默契，是相处很久才会长出来的礼物。", keywords: ["信任", "自在"], tip: "为你们共同喜欢的角落拍一张照。" },
    ],
  },
  {
    id: "mood-recharge",
    title: "它的情绪充电方式",
    subtitle: "当日子有点累，它怎样悄悄给你加一点电？",
    category: "情绪价值",
    cover: "recharge",
    introduction: "想想它在你身边时，哪种小动作最能改变气氛。",
    disclaimer: entertainment,
    questions: [
      q("你叹了口气，它更可能？", ["突然做件滑稽的小事", "a", "c"], ["靠过来安静待一会儿", "b", "d"], ["叼起玩具邀请你活动", "c", "a"]),
      q("它的招牌动作是？", ["一秒切换的夸张表情", "a", "c"], ["靠在身边慢慢呼吸", "b", "d"], ["到点提醒你该休息啦", "d", "b"]),
      q("一个无聊的下午，它会？", ["用奇怪姿势逗你笑", "a", "c"], ["陪你看窗外发呆", "b", "d"], ["主动拉你起来玩", "c", "a"]),
      q("你们的固定小仪式是？", ["每天同一时间打招呼", "d", "b"], ["心情好就来一场追逐", "a", "c"], ["窝在一起休息几分钟", "b", "d"]),
      q("你准备出门，它会？", ["用热闹的眼神催你快回来", "a", "c"], ["在门边安静目送", "b", "d"], ["检查一遍你们的出门流程", "d", "c"]),
      q("想让它入镜，你最想拍？", ["忍不住笑出来的瞬间", "a", "c"], ["贴近时安静的侧脸", "b", "d"], ["一起完成新挑战的画面", "c", "a"]),
      q("它最像哪种声音？", ["突然响起的快乐铃声", "a", "d"], ["雨天被窝里的轻声哼唱", "b", "d"], ["出发前有节奏的鼓点", "c", "a"]),
      q("你工作告一段落，它会？", ["马上奉上一段即兴表演", "a", "c"], ["等你坐下，再靠过来", "b", "d"], ["推推你的手，约你起身走走", "c", "d"]),
      q("遇到新尝试，它对你的影响？", ["让你觉得试错也很好笑", "a", "c"], ["给你慢一点也没关系的感觉", "b", "d"], ["像在说：一起试试看", "c", "a"]),
      q("今天最想感谢它什么？", ["逗我笑了一下", "a", "c"], ["在身边，什么也不用说", "b", "d"], ["提醒我好好过这一天", "d", "c"]),
    ],
    outcomes: [
      { id: "a", name: "快乐启动键", description: "它的可爱总来得突然，像替平淡的一天按了播放键。", typical: "一个怪表情、一场即兴追逐，就能让你忘了刚才的烦闷。", bond: "你不需要一直开心；它只是刚好擅长把笑意带回来。", closing: "原来一点点好笑，就足够让今天轻一些。", keywords: ["笑意", "即兴"], tip: "把它今天最好笑的一幕留在相册里。" },
      { id: "b", name: "慢充小暖炉", description: "它不急着改变什么，只是用在场让周围慢慢暖起来。", typical: "靠在附近睡一会儿，或者安静地陪你看窗外。", bond: "在它身边，你可以暂时不用解释今天为什么累。", closing: "有些能量，是在安静的陪伴里一点点回来的。", keywords: ["安静", "松弛"], tip: "今天留一段没有任务的并肩时间。" },
      { id: "c", name: "勇气补给站", description: "它对新游戏和新路线的兴致，会把你也轻轻拉向下一步。", typical: "叼来玩具、邀请出门，失败了也想再试一次。", bond: "你陪它探索，它也让你觉得偶尔试试新东西没那么难。", closing: "勇敢可以很小，小到和它一起迈出家门。", keywords: ["尝试", "同行"], tip: "挑一件轻松的小事，和它一起试试。" },
      { id: "d", name: "仪式感制造机", description: "它记住的那些小流程，让日子有了值得期待的节拍。", typical: "饭点、散步、晚安，它总有自己认真参与的方法。", bond: "你们把重复的生活过成了只属于彼此的小传统。", closing: "平凡的一天，因为有人等着同一个时刻，也变得特别。", keywords: ["节奏", "期待"], tip: "今晚把你们最熟悉的小仪式认真过一遍。" },
    ],
  },
];

export function findFunTest(id: string) {
  return funTests.find((test) => test.id === id);
}

export function publicFunTest(test: FunTest) {
  return {
    id: test.id,
    title: test.title,
    subtitle: test.subtitle,
    category: test.category,
    cover: test.cover,
    introduction: test.introduction,
    disclaimer: test.disclaimer,
    questionCount: test.questions.length,
    questions: test.questions.map((question) => ({ prompt: question.prompt, choices: question.choices.map((choice) => choice.text) })),
  };
}

export function scoreFunTest(test: FunTest, answers: number[]) {
  if (answers.length !== test.questions.length || answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer > 2)) {
    throw new Error("FUN_TEST_ANSWERS_INVALID");
  }
  const scores: Record<OutcomeKey, number> = { a: 0, b: 0, c: 0, d: 0 };
  const primaryCounts: Record<OutcomeKey, number> = { a: 0, b: 0, c: 0, d: 0 };
  test.questions.forEach((question, index) => {
    const choice = question.choices[answers[index]];
    scores[choice.primary] += 2;
    scores[choice.secondary] += 1;
    primaryCounts[choice.primary] += 1;
  });
  // Equal score and primary count are resolved by a stable answer fingerprint.
  const fingerprint = answers.reduce((value, answer, index) => (value * 31 + answer * 7 + index + 1) % 9973, 17);
  const ranked = test.outcomes.toSorted((left, right) =>
    scores[right.id] - scores[left.id] || primaryCounts[right.id] - primaryCounts[left.id] ||
    ((fingerprint + right.id.charCodeAt(0) * 37) % 4) - ((fingerprint + left.id.charCodeAt(0) * 37) % 4));
  return ranked[0];
}
