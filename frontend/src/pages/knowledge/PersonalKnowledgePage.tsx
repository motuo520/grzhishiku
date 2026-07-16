import { FC } from 'react';
import KnowledgeUnitList from './components/KnowledgeUnitList';

const PersonalKnowledgePage: FC = () => {
  return (
    <KnowledgeUnitList
      brainSide="personal"
      title="个人脑知识"
      subtitle="个人思考、笔记与沉淀的知识单元"
      showCreate
    />
  );
};

export default PersonalKnowledgePage;
