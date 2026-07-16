import { FC } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend
} from 'recharts';
import { RadarDimension } from '@/api/cognitive';

interface Props {
  personal: RadarDimension[];
  network: RadarDimension[];
  height?: number;
}

const PERSONAL_COLOR = '#a371f7';
const NETWORK_COLOR = '#58a6ff';

export const RadarMirror: FC<Props> = ({ personal, network, height = 360 }) => {
  const dimensions = personal.length > 0 ? personal.map((d) => d.name) : network.map((d) => d.name);
  const data = dimensions.map((name) => ({
    dimension: name,
    personal: personal.find((d) => d.name === name)?.score ?? 0,
    network: network.find((d) => d.name === name)?.score ?? 0,
  }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary text-sm">
        暂无对比数据
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="65%">
          <PolarGrid stroke="#30363d" />
          <PolarAngleAxis dataKey="dimension" tick={{ fill: '#8b949e', fontSize: 12 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#6e7681', fontSize: 10 }} />
          <Radar
            name="个人脑"
            dataKey="personal"
            stroke={PERSONAL_COLOR}
            fill={PERSONAL_COLOR}
            fillOpacity={0.15}
            strokeWidth={2}
          />
          <Radar
            name="网络脑"
            dataKey="network"
            stroke={NETWORK_COLOR}
            fill={NETWORK_COLOR}
            fillOpacity={0.12}
            strokeWidth={2}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '12px',
              color: '#c9d1d9',
            }}
          />
          <Legend
            formatter={(value: string) => (
              <span style={{ color: value === '个人脑' ? PERSONAL_COLOR : NETWORK_COLOR, fontSize: 12 }}>
                {value}
              </span>
            )}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RadarMirror;
