import { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNavigation } from '@/store/navigation';
import { useEmbodied } from '@/hooks/useEmbodied';
import {
  MapPin, Loader2, Smile, Frown, CloudSun, CloudRain, Zap,
  Thermometer, Navigation, Calendar, Brain, Home, Globe
} from 'lucide-react';

const MoodLocationPage: FC = () => {
  const navigate = useNavigate();
  const { brainSide } = useNavigation();
  const { moodLocationData, isLoadingMoodLocation, moodLocationError } = useEmbodied(brainSide);

  const { items, stats } = moodLocationData;
  const sideLabel = brainSide === 'personal' ? '个人脑' : brainSide === 'network' ? '网络脑' : '双脑';

  const topMoods = Object.entries(stats.mood_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const topLocations = Object.entries(stats.location_distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const moodIcon = (mood?: string) => {
    if (!mood) return <Smile className="w-4 h-4" />;
    const m = mood.toLowerCase();
    if (m.includes('开心') || m.includes('愉悦') || m.includes('兴奋') || m.includes('满足')) return <Smile className="w-4 h-4 text-success" />;
    if (m.includes('难过') || m.includes('悲伤') || m.includes('沮丧') || m.includes('痛苦')) return <Frown className="w-4 h-4 text-danger" />;
    if (m.includes('焦虑') || m.includes('紧张') || m.includes('压力')) return <CloudRain className="w-4 h-4 text-warning" />;
    if (m.includes('平静') || m.includes('放松') || m.includes('安宁')) return <CloudSun className="w-4 h-4 text-info" />;
    if (m.includes('疲惫') || m.includes('累') || m.includes('困倦')) return <Thermometer className="w-4 h-4 text-text-muted" />;
    return <Smile className="w-4 h-4 text-text-secondary" />;
  };

  const energyBadge = (level?: number) => {
    if (level === undefined || level === null) return null;
    let color = 'text-text-muted';
    if (level >= 0.7) color = 'text-success';
    else if (level >= 0.4) color = 'text-warning';
    else color = 'text-danger';
    return (
      <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-current/20 bg-white/[0.03] ${color}`}>
        <Zap className="w-3 h-3" />
        能量 {(level * 100).toFixed(0)}%
      </span>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto h-full overflow-auto">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <MapPin className="w-5 h-5 text-info" />
            情绪与环境
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            记忆不只是文字，还有当时的情绪、位置、身体状态。这里聚合胶囊中的 mood、location、身体能量等具身信息。
            <span className="ml-1 text-text-muted">当前：{sideLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/capsules/create')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
          >
            <Calendar className="w-4 h-4" />
            新建胶囊
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-info" />
            <span className="text-sm text-text-secondary">具身记录数</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{stats.total}</p>
          <p className="text-xs text-text-muted">来自含 mood/location 的胶囊</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <Smile className="w-4 h-4 text-warning" />
            <span className="text-sm text-text-secondary">情绪类型数</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{Object.keys(stats.mood_distribution).length}</p>
          <p className="text-xs text-text-muted">不同情绪标签</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <div className="flex items-center gap-2 mb-2">
            <Navigation className="w-4 h-4 text-success" />
            <span className="text-sm text-text-secondary">地点类型数</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{Object.keys(stats.location_distribution).length}</p>
          <p className="text-xs text-text-muted">不同地点标签</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
            <Smile className="w-4 h-4 text-warning" />
            情绪分布
          </h3>
          {topMoods.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {topMoods.map(([mood, count]) => (
                <div
                  key={mood}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03]"
                >
                  {moodIcon(mood)}
                  <span className="text-sm text-text-primary">{mood}</span>
                  <span className="text-xs text-text-muted">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">暂无情绪标签数据。</p>
          )}
        </div>

        <div className="rounded-xl border border-white/[0.06] bg-bg-secondary p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
            <Navigation className="w-4 h-4 text-success" />
            地点分布
          </h3>
          {topLocations.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {topLocations.map(([location, count]) => (
                <div
                  key={location}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03]"
                >
                  <MapPin className="w-3.5 h-3.5 text-info" />
                  <span className="text-sm text-text-primary">{location}</span>
                  <span className="text-xs text-text-muted">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">暂无地点标签数据。</p>
          )}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-text-muted" />
        <h2 className="text-sm font-medium text-text-primary">最近具身记录</h2>
      </div>

      {moodLocationError ? (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {(moodLocationError as any)?.message}
        </div>
      ) : isLoadingMoodLocation ? (
        <div className="text-sm text-text-secondary flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          加载中...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(`/capsules/${item.capsule_id}`)}
              className="text-left rounded-xl border border-white/[0.06] bg-bg-secondary p-4 hover:border-info/20 transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {item.mood_emotion && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.03] text-text-secondary">
                      {moodIcon(item.mood_emotion)}
                      {item.mood_emotion}
                    </span>
                  )}
                  {item.mood_location && (
                    <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.03] text-text-secondary">
                      <Navigation className="w-3 h-3 text-info" />
                      {item.mood_location}
                    </span>
                  )}
                  {energyBadge(item.mood_energy_level)}
                  <span className="text-[10px] text-text-muted">
                    {item.brain_side === 'network' ? <Globe className="w-3 h-3 inline mr-0.5" /> : <Home className="w-3 h-3 inline mr-0.5" />}
                    {item.brain_side === 'network' ? '网络脑' : '个人脑'}
                  </span>
                </div>
                <span className="text-[10px] text-text-muted shrink-0">
                  {new Date(item.created_at).toLocaleString('zh-CN')}
                </span>
              </div>
              <p className="text-sm text-text-primary line-clamp-2 mb-2">{item.content_preview || '（无内容预览）'}</p>
              <div className="flex flex-wrap gap-1.5">
                {item.mood_tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.03] text-text-muted">
                    #{tag}
                  </span>
                ))}
              </div>
              {(item.mood_trigger || item.mood_weather || item.mood_intensity !== undefined) && (
                <div className="mt-2 text-[10px] text-text-muted flex flex-wrap gap-3">
                  {item.mood_trigger && <span>触发：{item.mood_trigger}</span>}
                  {item.mood_weather && <span>天气：{item.mood_weather}</span>}
                  {item.mood_intensity !== undefined && <span>强度：{(item.mood_intensity * 100).toFixed(0)}%</span>}
                </div>
              )}
            </button>
          ))}
          {items.length === 0 && (
            <div className="col-span-full p-8 rounded-xl border border-white/[0.06] bg-bg-secondary text-center text-text-secondary">
              <MapPin className="w-10 h-10 mx-auto mb-3 text-text-muted/40" />
              <p className="text-sm">暂无具身记录。</p>
              <p className="text-xs mt-1">创建时间胶囊时填写情绪、地点、身体状态，它们会在这里聚合。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MoodLocationPage;
