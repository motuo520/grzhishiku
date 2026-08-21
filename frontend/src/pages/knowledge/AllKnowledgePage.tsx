import { FC } from 'react';
import KnowledgeUnitList from './components/KnowledgeUnitList';

// 双脑全量视图：钻取入口（进化分布/验证统计等跨脑统计数字的落点）。
// 统计是跨脑口径，钻到单脑列表会对不上数（08-20 用户实锤：「点进去空空如也」）。
const AllKnowledgePage: FC = () => {
  return (
    <KnowledgeUnitList
      brainSide="both"
      title="全部知识"
      subtitle="双脑全部知识单元（统计钻取视图）"
      showCreate={false}
    />
  );
};

export default AllKnowledgePage;
