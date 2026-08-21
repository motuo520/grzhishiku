import { FC, Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

// ================================================================
// 知识自进化链路进度条
//
// 为什么有这个组件：
// 「碰撞 → 争议 → 验证 → 践行 → 进化 → 回顾 → 被用」本是一条完整的
// 知识自进化链路，但七个环节被切在「自动理好 / 问出来 / 每日」三个
// 导航桶里，旧菜单名又各自为政（反证墙 / 做到了没 / 实操记录……，现均已改名），
// 用户进了任何一个页面都看不到自己站在链条的哪一环，容易「一脑蒙」。
// 这个进度条挂在链路各页面的标题正下方，把七个环节显性化：
// 当前环节高亮，其余环节可点击跳转，让链路成为可感知、可导航的结构。
//
// 路径模式感知：践行/进化/被用/回顾在简版走 /daily/*、经典版走
// /social-brain/*（回顾的经典版路径是 /social-brain/daily-review），
// 依据当前 pathname 是否以 /social-brain 开头决定链接前缀；
// 碰撞/争议/验证三个环节两种模式路径相同。
// ================================================================

interface ChainStep {
  /** 步骤短名（两个字） */
  label: string;
  /** 一句话说明该环节干什么，放在 title 属性上 */
  tip: string;
  /** 返回两种模式下的目标路径：classic=true 时走 /social-brain 前缀 */
  getPath: (classic: boolean) => string;
}

const STEPS: ChainStep[] = [
  {
    label: '碰撞',
    tip: '跨领域连接与创意杂交，新知识的诞生地',
    getPath: () => '/pipeline/collision',
  },
  {
    label: '争议',
    tip: '有争议的知识在这里裁决：修正、保留或驳回',
    getPath: () => '/knowledge/counter',
  },
  {
    label: '验证',
    tip: '多模型验证与共识裁决，确认知识可信',
    getPath: () => '/knowledge/verify',
  },
  {
    label: '践行',
    tip: '把知识用起来：应用、教授、迭代的落地记录',
    getPath: (classic) => `${classic ? '/social-brain' : '/daily'}/practice-records`,
  },
  {
    label: '进化',
    tip: '追踪知识从收集到内化的阶段跃迁',
    getPath: (classic) => `${classic ? '/social-brain' : '/daily'}/evolution-track`,
  },
  {
    label: '回顾',
    tip: '每日复盘：回顾今日输入，发现行为差距与下一步行动',
    getPath: (classic) => (classic ? '/social-brain/daily-review' : '/daily'),
  },
  {
    label: '被用',
    tip: '统计知识被调用与践行的次数，找出真正有价值的知识',
    getPath: (classic) => `${classic ? '/social-brain' : '/daily'}/invocation-track`,
  },
];

const EvolutionChainBar: FC = () => {
  const { pathname } = useLocation();
  const classic = pathname.startsWith('/social-brain');

  const paths = STEPS.map((s) => s.getPath(classic));
  // 当前步：最长前缀匹配（/daily/practice-records 这类子路径也能命中所属步骤）
  let activeIndex = -1;
  let activeLen = 0;
  paths.forEach((p, i) => {
    if ((pathname === p || pathname.startsWith(p + '/')) && p.length > activeLen) {
      activeIndex = i;
      activeLen = p.length;
    }
  });

  return (
    <nav
      aria-label="知识自进化链路"
      className="flex flex-wrap items-center gap-1 text-xs"
    >
      <span className="text-text-muted mr-1 shrink-0">知识自进化链路</span>
      {STEPS.map((step, i) => {
        const active = i === activeIndex;
        return (
          <Fragment key={step.label}>
            {i > 0 && <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />}
            <Link
              to={paths[i]}
              title={step.tip}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'px-2 py-0.5 rounded-[2px] border bg-info/10 text-info border-info/30 font-medium'
                  : 'px-2 py-0.5 rounded-[2px] border border-transparent text-text-muted hover:text-text-primary hover:border-info/30 hover:bg-info/5 transition-colors'
              }
            >
              {step.label}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
};

export default EvolutionChainBar;
