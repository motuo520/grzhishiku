"""Generate 200 demo knowledge units for the sample brain feature."""
import json
import uuid
import random
from datetime import datetime, timedelta

random.seed(42)

# Each book has 2-3 associated idea triples (idea, reflection, action).
BOOKS = [
    ("《原子习惯》", "詹姆斯·克利尔", "自我提升", [
        ("习惯的形成依赖四个步骤：提示、渴望、反应、奖励", "改变环境比依赖意志力更有效", "重新布置书桌，把想要养成的行为可视化"),
        ("1% 的每天进步会带来 37 倍的长期复利", "微小改进容易被忽视，但决定长期走向", "每天固定写 300 字笔记"),
        ("系统优于目标，关注身份认同而非结果", "一旦身份改变，行为会自然跟随", '从"我想戒烟"改为"我不吸烟"'),
    ]),
    ("《深度工作》", "卡尔·纽波特", "自我提升", [
        ("深度工作是在无干扰状态下专注进行职业活动", "碎片化的即时回复正在吞噬创造力", "每天上午设置 2 小时免打扰时间"),
        ("高质量工作产出 = 时间 × 专注度", "分心是劣质工作的元凶", "把手机放到另一个房间再开始写作"),
    ]),
    ("《非暴力沟通》", "马歇尔·卢森堡", "沟通", [
        ("观察而不评判是同理心的前提", "很多冲突源于急于下结论", "下次争论前先复述对方观点"),
        ("表达需要而不是指责", "指责只会激起防御", "用'我需要…'代替'你总是…'"),
    ]),
    ("《思考，快与慢》", "丹尼尔·卡尼曼", "心理学", [
        ("系统 1 快速直觉，系统 2 缓慢理性", "大多数决策其实是直觉在主导", "重要决定强制自己睡一晚再定"),
        ("损失厌恶让人对同等损失的痛苦大于获得的快乐", "这解释了为什么人们不敢冒险", '用"可承受损失"而非"期望收益"评估机会'),
        ("锚定效应会让最先听到的数字影响判断", "谈判时先出价往往占据优势", "做预算时先列必要支出再定总额"),
    ]),
    ("《置身事内》", "兰小欢", "经济", [
        ("地方政府在经济发展中扮演关键角色", "理解政策需要看到地方激励机制", "关注地方债和土地财政的联动"),
        ("政府不仅是规则的制定者，也是市场的参与者", "脱离政府谈经济会漏掉关键变量", "读文件时先看地方财政收支"),
    ]),
    ("《纳瓦尔宝典》", "埃里克·乔根森", "财富", [
        ("财富是睡觉时也能赚钱的资产", "靠时间换钱永远没有杠杆", "把精力放在能复利的产品上"),
        ("追求财富而不是金钱或地位", "财富是创造价值的副产品", "每天问自己有没有在积累资产"),
    ]),
    ("《被讨厌的勇气》", "岸见一郎", "心理学", [
        ("课题分离：分清楚什么是自己的事", "很多焦虑来自干涉了别人的课题", "只为自己能控制的部分负责"),
        ("真正的自由是不再寻求认可", "过度在意评价会束缚行动", "先完成再完美"),
    ]),
    ("《小王子》", "安托万·德·圣埃克苏佩里", "文学", [
        ("真正重要的东西用眼睛是看不见的", "关系和体验比物质更持久", "每周留出不被屏幕占据的时间"),
        ("你在你的玫瑰身上花费的时间，使你的玫瑰变得重要", "投入塑造了意义", "为重要的人留出固定陪伴时间"),
    ]),
    ("《百年孤独》", "加西亚·马尔克斯", "文学", [
        ("家族的命运在重复中轮回", "历史不是过去，而是持续影响现在的力量", "记录家族故事以打破无意识循环"),
        ("生命中真正重要的不是你遭遇了什么", "而是你记住了什么，以及如何铭记", "写失败日记比成功日记更重要"),
    ]),
    ("《万历十五年》", "黄仁宇", "历史", [
        ("数字管理依靠技术而非道德", "制度设计比个人品行更可靠", "用清单和流程降低人为失误"),
        ("大历史观要求看到结构而非个人", "把失败归因于个人会忽视系统问题", "复盘时先问流程哪里漏了"),
    ]),
    ("《人类简史》", "尤瓦尔·赫拉利", "历史", [
        ("人类通过故事组织大规模合作", "共识和想象塑造了社会", "在团队中先统一叙事再推动执行"),
        ("农业革命可能是历史上最大的骗局", "进步常常伴随新的束缚", "评估新工具时也要看隐性成本"),
    ]),
    ("《穷查理宝典》", "查理·芒格", "投资", [
        ("多元思维模型能避免锤子综合征", "单一学科视角会漏掉关键风险", "建立跨学科的核对清单"),
        ("反过来想，总是反过来想", "避免愚蠢比追求聪明更重要", "列一份'绝对不碰'清单"),
    ]),
    ("《原则》", "瑞·达利欧", "管理", [
        ("痛苦 + 反思 = 进步", "回避错误会重复错误", "每周写一次失败复盘"),
        ("极度透明 + 极度真实", "粉饰太平会浪费决策信息", "会议上公开说'我不知道'"),
    ]),
    ("《创新者的窘境》", "克莱顿·克里斯坦森", "商业", [
        ("破坏性创新往往从低端市场开始", "巨头忽视的边缘正是机会所在", "关注被现有方案过度服务的人群"),
        ("倾听不消费你产品的用户", "现有客户会把你锁死在旧赛道", "每季度访谈一个流失用户"),
    ]),
    ("《金字塔原理》", "芭芭拉·明托", "写作", [
        ("结论先行，以上统下", "清晰的结构能让复杂信息被快速理解", "写报告时先写摘要"),
        ("MECE 原则：相互独立，完全穷尽", "分类混乱会掩盖真正的问题", "列大纲时检查是否有重叠"),
    ]),
]

BOOK_TEMPLATES = [
    "{book} 第 {n} 章核心观点：{idea}。这让我意识到，{reflection}",
    "读 {book} 的笔记：{idea}。作者 {author} 强调，{reflection}",
    "{book} 中提到：{idea}。联系自身，{reflection}",
    "{book} 摘录：{idea}。接下来我准备 {action}。",
    "重读 {book}，发现 {idea}。{reflection}",
]

# Each dish has a specific procedure and tip.
DISHES = [
    ("番茄炒蛋", "家常菜", "番茄切块炒出汁，倒入炒散的鸡蛋，加盐和糖调味", "番茄要先炒软出沙"),
    ("红烧肉", "家常菜", "五花肉焯水后煎至微黄，加生抽老抽冰糖八角炖 40 分钟", "焯水时加料酒去腥"),
    ("麻婆豆腐", "川菜", "豆腐切块焯水，肉末炒香加豆瓣酱，倒入豆腐轻推勾芡", "豆腐焯水可去豆腥"),
    ("清蒸鲈鱼", "粤菜", "鲈鱼划刀，铺葱姜蒸 8 分钟，淋蒸鱼豉油泼热油", "水开后再放鱼"),
    ("宫保鸡丁", "川菜", "鸡胸肉切丁腌制，炒香花椒干辣椒，加花生米和葱段翻炒", "鸡丁不要炒老"),
    ("糖醋排骨", "家常菜", "排骨焯水后煎至焦黄，加糖醋汁小火焖 30 分钟", "收汁时不停翻动"),
    ("蒜蓉西兰花", "素菜", "西兰花掰小朵焯水，蒜末爆香后快炒，加盐调味", "焯水时滴油保色"),
    ("番茄牛腩", "家常菜", "牛腩焯水后与番茄同炖 1.5 小时，最后加番茄块", "后放番茄块增加层次感"),
    ("可乐鸡翅", "家常菜", "鸡翅划刀腌制，煎至两面金黄后倒入可乐收汁", "收汁后撒芝麻"),
    ("蛋炒饭", "主食", "剩饭加蛋黄拌匀，热锅快炒，加葱花和盐", "用隔夜饭更干爽"),
    ("葱油拌面", "主食", "面条煮熟沥干，淋葱油酱汁拌匀", "葱要熬到微焦"),
    ("饺子", "主食", "肉馅加葱姜水搅上劲，包入饺子皮煮熟", "水开三次点冷水"),
    ("韭菜盒子", "主食", "韭菜鸡蛋馅调好，面皮包成半月形煎熟", "煎时盖盖焖"),
    ("酸辣汤", "汤", "豆腐木耳切丝，加醋胡椒粉调味勾芡", "最后淋蛋液"),
    ("紫菜蛋花汤", "汤", "水开后加紫菜，倒入蛋液搅散，撒虾皮葱花", "蛋液要细流倒入"),
    ("凉拌黄瓜", "凉菜", "黄瓜拍碎切段，加蒜末生抽醋香油拌匀", "现拌现吃更脆"),
    ("拍黄瓜", "凉菜", "黄瓜拍碎切段，加蒜末生抽醋香油拌匀", "现拌现吃更脆"),
    ("白灼虾", "粤菜", "虾开背去虾线，沸水下锅焯 1 分钟捞出蘸料", "水内加姜片去腥"),
    ("回锅肉", "川菜", "五花肉煮熟切片，回锅煸炒出油加青蒜豆瓣酱", "肉片要切薄"),
    ("鱼香肉丝", "川菜", "肉丝上浆滑油，炒香泡椒姜蒜，倒入笋丝木耳丝", "鱼香汁比例糖醋等量"),
]

RECIPE_TEMPLATES = [
    "{dish} 做法：{steps}。要点是 {tip}。",
    "今天做 {dish}。{steps}。成品 {tip}。",
    "{dish}（{category}）：{steps}。记得 {tip}。",
    "家常 {dish}：{steps}。{tip}。",
]

WORK_TOPICS = [
    "周会", "产品需求", "用户反馈", "项目复盘", "竞品分析", "数据指标", "技术方案", "客户沟通", "版本规划", "团队管理",
]

WORK_TEMPLATES = [
    "{date} {topic} 记录：{content}。下一步 {action}。",
    "{topic} 复盘：{content}。需要注意 {action}。",
    "{date} 与 {stakeholder} 沟通 {topic}：{content}。结论：{action}",
    "{topic} 会议纪要：{content}。TODO：{action}",
]

WORK_CONTENTS = [
    ("本周 DAU 环比增长 3%，但次日留存下降 1.5%", "重点看新用户 onboarding 流失"),
    ("用户集中反馈搜索速度慢，特别是在知识库超过 500 条后", "Q3 优先做向量索引分页"),
    ("竞品 A 推出了类似功能，但定价是我们的 2 倍", "突出本地模型免费卖点"),
    ("客户 B 希望增加 SSO 和企业成员管理", "列入 B 端私有化需求池"),
    ("上线新编辑器后，笔记创建率提升 8%", "继续优化移动端输入体验"),
    ("服务器迁移到美国节点后，国内访问延迟增加", "等备案完成后切回国内 CDN"),
    ("本周处理了 23 个用户工单，Top3 问题是同步冲突", "写一份同步冲突解决 FAQ"),
    ("产品路线图讨论：Q3 重点做 RAG 引用溯源和示例大脑", "下周输出 PRD"),
    ("与技术负责人对齐 LLM 控制台模型一致性", "统一前后端模型 ID 映射"),
    ("品牌 Logo 和欢迎页改版方案确认", "周五前出设计稿"),
    ("社区有人反馈本地模型 0.5B 回答质量不够", "增加推荐 7B 模型的引导"),
    ("付费转化率 0.8%，低于预期", "优化定价页和空状态引导"),
    ("开源方案确定 AGPL-3.0，需要清密钥和补 README", "本周完成许可证检查"),
    ("移动端 PWA 缓存策略导致更新不生效", "改用 Cache-First + 版本号"),
    ("用户建议增加语音输入到 AI 对话框", "评估浏览器 API 兼容性"),
]


def make_book_entry(i):
    book, author, category, ideas = BOOKS[i % len(BOOKS)]
    idea, reflection, action = random.choice(ideas)
    tmpl = random.choice(BOOK_TEMPLATES)
    content = tmpl.format(book=book, author=author, idea=idea, reflection=reflection, action=action, n=random.randint(1, 12))
    return {
        "id": str(uuid.uuid4()),
        "content_raw": content,
        "content_type": "读书笔记",
        "source_title": book,
        "source_author": author,
        "source_type": "book",
        "brain_side": "personal",
        "origin_type": "book_excerpt",
        "content_subtype": "note",
        "pipeline_stage": "approved",
    }


def make_recipe_entry(i):
    dish, category, steps, tip = DISHES[i % len(DISHES)]
    tmpl = random.choice(RECIPE_TEMPLATES)
    content = tmpl.format(dish=dish, category=category, steps=steps, tip=tip)
    return {
        "id": str(uuid.uuid4()),
        "content_raw": content,
        "content_type": "菜谱",
        "source_title": f"家常{dish}",
        "source_author": "个人记录",
        "source_type": "recipe",
        "brain_side": "personal",
        "origin_type": "self_practice",
        "content_subtype": "note",
        "pipeline_stage": "approved",
    }


def make_work_entry(i):
    topic = WORK_TOPICS[i % len(WORK_TOPICS)]
    content, action = WORK_CONTENTS[i % len(WORK_CONTENTS)]
    stakeholder = random.choice(["产品经理", "技术负责人", "设计师", "运营", "客户成功", "CEO"])
    date_offset = random.randint(0, 180)
    date = (datetime.now() - timedelta(days=date_offset)).strftime("%Y-%m-%d")
    tmpl = random.choice(WORK_TEMPLATES)
    text = tmpl.format(date=date, topic=topic, content=content, action=action, stakeholder=stakeholder)
    return {
        "id": str(uuid.uuid4()),
        "content_raw": text,
        "content_type": "工作记录",
        "source_title": f"{topic}记录",
        "source_author": stakeholder,
        "source_type": "work_note",
        "brain_side": "personal",
        "origin_type": "reflection",
        "content_subtype": "note",
        "pipeline_stage": "approved",
    }


entries = []
for i in range(80):
    entries.append(make_book_entry(i))
for i in range(60):
    entries.append(make_recipe_entry(i))
for i in range(60):
    entries.append(make_work_entry(i))

random.shuffle(entries)

output = {
    "version": "1.0.0",
    "description": "示例大脑：200 条预置笔记，包含读书笔记、菜谱和工作记录，用于首次体验 RAG 问答。",
    "total": len(entries),
    "created_at": datetime.utcnow().isoformat(),
    "entries": entries,
}

with open("app/data/seed_demo_brain.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"Generated {len(entries)} seed entries -> app/data/seed_demo_brain.json")
