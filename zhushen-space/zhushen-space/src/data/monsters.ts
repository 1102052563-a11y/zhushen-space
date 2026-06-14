import type { Monster } from '../types';

// 怪物配置表。新增怪物只需在此添加一条，再在副本节点里引用 id。
export const monsters: Record<string, Monster> = {
  zombie: {
    id: 'zombie', name: '变异丧尸', hp: 45, atk: 14, def: 2,
    desc: '皮肤溃烂、动作迟缓，但被群体围住依然致命。',
  },
  zombie_dog: {
    id: 'zombie_dog', name: '丧尸犬', hp: 35, atk: 20, def: 1,
    desc: '速度极快的变异犬只，扑击凶猛。',
  },
  nurse: {
    id: 'nurse', name: '畸形护士长', hp: 120, atk: 22, def: 5, sanAtk: 6, boss: true,
    desc: '手术刀已与骨骼融合，废弃医院的主宰。',
  },
  licker: {
    id: 'licker', name: '舔食者', hp: 90, atk: 26, def: 4,
    desc: '失去眼球、靠声音捕猎，舌头能贯穿钢板。',
  },
  tyrant: {
    id: 'tyrant', name: '暴君 T-103', hp: 200, atk: 30, def: 10, boss: true,
    desc: '保护伞公司的生化兵器，一拳可击碎混凝土。',
  },
  facehugger: {
    id: 'facehugger', name: '抱脸虫', hp: 25, atk: 12, def: 0, sanAtk: 8,
    desc: '蛛形寄生体，扑向面部的瞬间令人精神崩溃。',
  },
  drone: {
    id: 'drone', name: '异形工蜂', hp: 110, atk: 28, def: 6, sanAtk: 5,
    desc: '酸血、利爪、第二口器，黑暗中无声逼近。',
  },
  queen: {
    id: 'queen', name: '异形女王', hp: 280, atk: 36, def: 12, sanAtk: 10, boss: true,
    desc: '巢穴的核心，体型庞大到遮蔽整片舱壁。',
  },
  wraith: {
    id: 'wraith', name: '怨灵', hp: 70, atk: 10, def: 0, sanAtk: 14,
    desc: '物理攻击对它收效甚微，却不断啃噬你的理智。',
  },
  vengeful: {
    id: 'vengeful', name: '厉鬼·阿七', hp: 160, atk: 18, def: 3, sanAtk: 18, boss: true,
    desc: '七夜古宅的女主人，怨念凝成实体，专食活人神魂。',
  },
};
