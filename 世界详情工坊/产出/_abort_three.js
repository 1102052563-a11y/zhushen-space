const fs = require('fs');
const path = require('path');
const files = [
  '产出/批次750/といれのはなこさんうしくっきょうたいましあくおちまんこにてんちゅうざあめんれんぞくなかだし2トイレの花子さんVS屈強退魔師 悪堕ちマ○コに天誅ザーメン連続中出し 第二怪 恐怖『メリーさんの電話』! つるぺたロ○ータのオナホ人形.md',
  '产出/批次763/思春期のお勉強 第2話 学ぶより経験がしたいお年頃.md',
  '产出/批次770/思春期のお勉強 第3話 キスをしてみたいお年頃.md'
];
for (const p of files) {
  if (!fs.existsSync(p)) {
    console.log('miss', p);
    continue;
  }
  const title = path.basename(p, '.md');
  const body = `# ${title}
<!--meta lib=休闲 tiers=休闲 status=ABORT reason=age-policy-->

## ABORT

**原因：题名/原作含未成年或学园少女性核心描写，禁止撰写成人向档案。**

### 处理
- 不写剧情/休闲切入点正文
- 保留清单占位，供后续人工复核或删除

### 来源
- 清单批次表原名锚定
- 政策：世界详情工坊/清单/_leisure_rewrite_rules.md（年龄铁则）
`;
  fs.writeFileSync(p, body, 'utf8');
  console.log('ABORT', title.slice(0, 40));
}
