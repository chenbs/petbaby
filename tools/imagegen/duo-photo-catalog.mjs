/**
 * 人宠写真 v2（2026-10）：8 组 × 2 个镜头，示例人物 2 男 6 女。
 *
 * v1 被用户否决：骑行、厨房、海边这类是生活方式 / 情景摄影，不是艺术棚拍。
 * v2 按示例图的真正逻辑重做——
 *   1) 可控的棚拍布景：无缝纸背景 + 一两件家具或道具，不搭房间、不出外景；
 *   2) 人与宠物的服饰同色系呼应，整组只有一个主色调；
 *   3) 人是模特、宠物是搭档，靠姿态与互动出画面（抱、举、并排、对视、贴脸）；
 *   4) 部分组用明确的节日 / 主题布景（春节、圣诞、万圣节）。
 * 每组是同一场拍摄的两个镜头：镜头一文生图，镜头二以镜头一为唯一参考图换姿势与机位。
 * 创意均为原创；humanpet/ 下的示例图只用于理解方向，不作为任何生成输入，也不复刻其布景与配色。
 */
export const duoGroups = [
  {
    id: "duo-new-year",
    title: "新春红",
    description: "红灯笼 · 橘子大吉",
    person: "an adult East Asian woman in her twenties with glossy black hair in a low bun and small gold earrings",
    pet: "a red Shiba Inu",
    wardrobe: "She wears a modern red satin top with a mandarin collar and gold frog buttons and wide cream trousers; the Shiba wears a small red knitted vest with one gold frog button.",
    set: "A studio with a deep Chinese-red seamless paper backdrop, one round red paper lantern hanging high at one side, a low dark-lacquered wooden stool and a few fresh mandarins with leaves on the floor. One large soft key light from the front-left.",
    shots: [
      { id: "duo-new-year-lucky", title: "大吉大利", action: "She sits on the low stool with the Shiba sitting upright on her lap facing the camera; she holds a mandarin with leaves up beside the dog's cheek and smiles at the lens, the Shiba looks into the camera with a bright open-mouth grin. Full-length to mid-thigh, eye-level." },
      { id: "duo-new-year-balance", title: "头顶橘子", action: "Closer frame: she kneels on the floor behind the Shiba and carefully balances one small mandarin on top of the dog's head, laughing; the Shiba sits very still with a serious, patient face looking at the camera. Both faces large and sharp, slightly low camera." },
    ],
  },
  {
    id: "duo-christmas",
    title: "圣诞毛衣",
    description: "同款毛衣 · 戴上鹿角",
    person: "an adult East Asian man in his late twenties with short tousled black hair and light stubble",
    pet: "a golden retriever",
    wardrobe: "He wears a cream-and-red Fair Isle knit sweater, dark green trousers and thick white socks; the golden retriever wears a small matching cream-and-red knitted scarf.",
    set: "A studio with a deep pine-green seamless paper backdrop, one small potted fir tree with a short string of warm fairy lights, and two plain kraft-paper gift boxes tied with red string on the floor. Warm soft key light.",
    shots: [
      { id: "duo-christmas-antlers", title: "戴上鹿角", action: "He sits cross-legged on the floor with the golden retriever lying across his lap; he is placing a soft felt reindeer-antler headband on the dog's head while the dog looks up at the camera with a sweet, patient face. He smiles down at the dog. Full-body, eye-level." },
      { id: "duo-christmas-kiss", title: "圣诞偷亲", action: "Medium close-up: the golden retriever, now wearing the felt antlers, leans in and licks his cheek; he squeezes his eyes shut and laughs, holding one small kraft gift box against his chest. Both faces clearly visible." },
    ],
  },
  {
    id: "duo-halloween",
    title: "万圣节",
    description: "小黑猫 · 躲进巫师帽",
    person: "an adult East Asian woman in her twenties with long straight black hair and dark red lipstick",
    pet: "a sleek black short-haired cat with yellow-green eyes",
    wardrobe: "She wears a black velvet long-sleeve mini dress and black tights; the cat wears a tiny deep-purple satin cape tied at the neck.",
    set: "A studio with a muted pumpkin-orange seamless paper backdrop, three real pumpkins of different sizes on the floor and a wide-brimmed pointed black witch hat. Soft key light with a gentle shadow on the backdrop.",
    shots: [
      { id: "duo-halloween-familiar", title: "小黑猫助手", action: "She sits on the floor beside the pumpkins wearing the witch hat, holding the black cat up next to her cheek with both hands; she gives the camera a playful mysterious smile while the cat stares into the lens with big glowing eyes. Mid-shot, eye-level." },
      { id: "duo-halloween-hat", title: "躲进巫师帽", action: "Floor-level shot: the witch hat lies on the floor with the black cat sitting inside the brim and peeking out from under it; she lies on her stomach behind the hat, chin resting on her stacked hands, smiling at the cat. Both faces visible." },
    ],
  },
  {
    id: "duo-caramel",
    title: "焦糖同色",
    description: "同色系 · 藤椅下仰望",
    person: "an adult East Asian woman in her thirties with a sleek shoulder-length bob",
    pet: "a Pembroke Welsh Corgi with a red-and-white coat",
    wardrobe: "She wears a caramel suede shirt tucked into wide camel trousers and brown loafers; the corgi wears a thin caramel leather collar, matching her outfit.",
    set: "A studio with a warm caramel-brown seamless paper backdrop and a single natural cane bentwood armchair. Soft directional key light, warm and quiet.",
    shots: [
      { id: "duo-caramel-chair", title: "藤椅下仰望", action: "She sits sideways in the cane armchair, one arm draped over the armrest, legs crossed, looking down with a soft smile at the corgi who sits on the floor at her feet and looks up at her adoringly. Full-length, slightly from the side." },
      { id: "duo-caramel-nose", title: "碰碰鼻子", action: "She crouches low beside the armchair and the corgi stands up with its front paws on her knee; they touch noses, her eyes closed in a gentle smile, the corgi's ears up. Close mid-shot, both faces in profile and clearly visible." },
    ],
  },
  {
    id: "duo-monochrome",
    title: "黑白经典",
    description: "黑西装 · 斑点狗",
    person: "an adult East Asian man in his thirties with neatly combed black hair",
    pet: "a Dalmatian with black spots",
    wardrobe: "He wears a sharp black suit with a crisp white shirt open at the collar and black leather shoes; the Dalmatian wears a slim black leather collar.",
    set: "A studio with a pure white seamless paper backdrop and one simple black wooden stool. Clean bright light with soft natural shadows, a strict black-and-white palette.",
    shots: [
      { id: "duo-monochrome-profile", title: "同款侧脸", action: "He sits on the stool and the Dalmatian sits upright beside him; both turn their heads in the same direction in profile with the same calm, cool expression, a perfectly matched pose. Full-length, eye-level, graphic composition." },
      { id: "duo-monochrome-laugh", title: "搭肩大笑", action: "He squats on the floor and the Dalmatian puts one front paw up on his shoulder and leans in; he breaks into a big laugh looking at the camera, the dog's mouth open in a happy grin. Medium shot, both faces clearly visible." },
    ],
  },
  {
    id: "duo-ballet",
    title: "芭蕾粉",
    description: "把杆前 · 小纱裙",
    person: "an adult East Asian woman in her twenties with hair in a neat ballet bun",
    pet: "a small cream Pomeranian",
    wardrobe: "She wears a pale pink ballet wrap top, a soft pink tulle skirt and pink ballet flats; the Pomeranian wears a tiny pale pink tulle tutu.",
    set: "A studio with a dusty-pink seamless paper backdrop and one light wooden ballet barre on two stands. Soft airy light.",
    shots: [
      { id: "duo-ballet-barre", title: "把杆前", action: "She stands at the ballet barre in an elegant pose with one foot pointed, holding the Pomeranian against her chest in both arms; she looks down at the dog with a tender smile while the dog looks into the camera. Full-length, eye-level." },
      { id: "duo-ballet-stretch", title: "坐在腿上", action: "She sits on the floor in a graceful stretch with one leg extended, the Pomeranian sitting on her extended leg; she leans forward smiling at the dog, the dog tilts its head at her. Slightly high camera angle, both faces visible." },
    ],
  },
  {
    id: "duo-denim",
    title: "丹宁复古",
    description: "木箱并排 · 举高飞起来",
    person: "an adult East Asian woman in her twenties with wavy chin-length hair and a red bandana headband",
    pet: "a Jack Russell Terrier",
    wardrobe: "She wears a light-wash denim jacket, a white T-shirt and straight jeans with white sneakers; the terrier wears a small matching red bandana.",
    set: "A studio with a pale powder-blue seamless paper backdrop and two stacked plain wooden crates. Crisp soft light.",
    shots: [
      { id: "duo-denim-crates", title: "木箱并排", action: "She sits on the lower crate with her elbow on her knee and the terrier stands on the top crate right beside her shoulder; both look straight into the camera, she grins and the terrier has a cheeky open-mouth smile. Full-length, eye-level." },
      { id: "duo-denim-fly", title: "举高飞起来", action: "She lies on her back on the studio floor and holds the terrier up above her with straight arms like an airplane; she laughs up at it and the terrier looks down at her with its ears flapping. Low side angle, both faces clearly visible." },
    ],
  },
  {
    id: "duo-tulips",
    title: "一抱郁金香",
    description: "白衬衫 · 猫在花里",
    person: "an adult East Asian woman in her twenties with long soft brown hair",
    pet: "a blue-grey British Shorthair cat with copper eyes",
    wardrobe: "She wears an oversized crisp white cotton shirt and light linen trousers, barefoot; the cat wears nothing.",
    set: "A studio with a soft butter-yellow seamless paper backdrop, an armful of loose yellow tulips and one plain clear glass vase on the floor. Bright soft light.",
    shots: [
      { id: "duo-tulips-lap", title: "花里抱猫", action: "She sits on the floor with her knees bent and the cat sitting on her lap among loose yellow tulips; she hugs the cat lightly and rests her cheek on its head, both looking into the camera, her smile soft. Mid-shot, eye-level." },
      { id: "duo-tulips-sniff", title: "闻一闻", action: "Close-up portrait: the cat sits on her shoulder and she holds a single yellow tulip in front of both of their faces; the cat sniffs the petals with curiosity while she watches it with a quiet smile. Both faces clearly visible." },
    ],
  },
];

export const duoShots = duoGroups.flatMap((group) => group.shots.map((shot, index) => ({ ...shot, index, group })));
