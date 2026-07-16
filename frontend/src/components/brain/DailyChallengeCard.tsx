import { FC, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, HelpCircle, Lightbulb, CheckCircle2, XCircle, ArrowRight, SkipForward, Send, Clock } from 'lucide-react';
import { Challenge } from '@/api/cognitive';

interface Props {
  challenge?: Challenge;
  loading?: boolean;
  onAnswer: (id: string, answer: string) => void;
  onSkip: (id: string) => void;
  answering?: boolean;
}

const TYPE_LABEL: Record<string, { label: string; color: string; icon: typeof Brain }> = {
  bias_quiz: { label: '偏差测验', color: 'text-warning', icon: HelpCircle },
  thought_experiment: { label: '思维实验', color: 'text-info', icon: Brain },
  reflection: { label: '反思练习', color: 'text-success', icon: Lightbulb },
};

export const DailyChallengeCard: FC<Props> = ({ challenge, loading, onAnswer, onSkip, answering }) => {
  const [selected, setSelected] = useState<string>('');
  const [textAnswer, setTextAnswer] = useState('');

  if (loading || !challenge) {
    return (
      <div className="glass-card p-8 animate-pulse space-y-4">
        <div className="h-6 bg-white/[0.05] rounded w-1/3" />
        <div className="h-24 bg-white/[0.03] rounded-xl" />
      </div>
    );
  }

  const typeInfo = TYPE_LABEL[challenge.type] || TYPE_LABEL.reflection;
  const TypeIcon = typeInfo.icon;
  const isQuiz = challenge.type === 'bias_quiz';
  const isCompleted = challenge.status === 'completed';
  const isCorrect = challenge.is_correct;

  const handleSubmit = () => {
    const answer = isQuiz ? selected : textAnswer;
    if (!answer.trim()) return;
    onAnswer(challenge.id, answer);
  };

  return (
    <div className="glass-card p-6 md:p-8 space-y-5 border-fusion-primary/20">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-xl ${typeInfo.color.replace('text-', 'bg-')}/10 border ${typeInfo.color.replace('text-', 'border-')}/20`}>
            <TypeIcon className={`w-6 h-6 ${typeInfo.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-text-primary">{challenge.title}</h2>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${typeInfo.color.replace('text-', 'bg-')}/10 ${typeInfo.color}`}>
                {typeInfo.label}
              </span>
            </div>
            <p className="text-xs text-text-secondary">今日认知挑战 · {challenge.points} 积分</p>
          </div>
        </div>
        {!isCompleted && (
          <button
            onClick={() => onSkip(challenge.id)}
            className="text-xs text-text-muted hover:text-text-primary flex items-center gap-1 transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" /> 跳过
          </button>
        )}
      </div>

      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
        <p className="text-text-primary leading-relaxed">{challenge.content}</p>
      </div>

      {!isCompleted ? (
        <div className="space-y-4">
          {isQuiz ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {challenge.options.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setSelected(opt)}
                  className={`p-4 rounded-xl border text-left transition-colors ${
                    selected === opt
                      ? 'bg-fusion-primary/10 border-fusion-primary/30 text-fusion-primary'
                      : 'bg-white/[0.02] border-white/[0.05] text-text-secondary hover:text-text-primary hover:border-white/[0.1]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border ${selected === opt ? 'border-fusion-primary bg-fusion-primary' : 'border-text-muted'}`} />
                    <span>{opt}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <textarea
              value={textAnswer}
              onChange={(e) => setTextAnswer(e.target.value)}
              placeholder="写下你的想法..."
              rows={5}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fusion-primary/50 resize-none"
            />
          )}

          <button
            onClick={handleSubmit}
            disabled={answering || (!isQuiz ? !textAnswer.trim() : !selected)}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {answering ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                className="w-4 h-4 border-2 border-white border-t-transparent rounded-full"
              />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span>{answering ? '提交中...' : '提交答案'}</span>
          </button>
        </div>
      ) : (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-5 rounded-xl border ${isCorrect ? 'bg-success/5 border-success/20' : 'bg-warning/5 border-warning/20'}`}
          >
            <div className="flex items-center gap-2 mb-3">
              {isCorrect ? (
                <CheckCircle2 className="w-5 h-5 text-success" />
              ) : (
                <XCircle className="w-5 h-5 text-warning" />
              )}
              <span className={`font-bold ${isCorrect ? 'text-success' : 'text-warning'}`}>
                {isQuiz ? (isCorrect ? '回答正确' : '回答错误') : '已完成'}
              </span>
            </div>
            {challenge.explanation && (
              <div>
                <div className="text-sm font-bold text-text-primary mb-1">解析</div>
                <p className="text-sm text-text-secondary leading-relaxed">{challenge.explanation}</p>
              </div>
            )}
            {challenge.user_answer && (
              <div className="mt-3 text-sm text-text-muted">
                你的答案：{challenge.user_answer}
              </div>
            )}
            <div className="mt-4 pt-3 border-t border-white/[0.05] flex items-start gap-2 text-xs text-text-muted">
              <Clock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {isQuiz && !isCorrect
                  ? '每日挑战每日一题，答错后今日无法重试；明天会自动刷新新的认知挑战。'
                  : '每日挑战每日一题，今天已完成；明天会自动刷新新的认知挑战。'}
              </span>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
};

export default DailyChallengeCard;
