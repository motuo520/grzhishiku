import { FC } from 'react';
import KnowledgeUnitList from './components/KnowledgeUnitList';

const NetworkKnowledgePage: FC = () => {
  return (
    <KnowledgeUnitList
      brainSide="network"
      title="网络脑知识"
      subtitle="从外部网络采集、待验证与已验证的知识单元"
      showCreate
    />
  );
};

export default NetworkKnowledgePage;
