import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

function downloadCsv(data, metric_field) {
  const csv = [
    ['Date', metric_field].join(','),
    ...data.map((r) => [r.label, r[metric_field]].join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `plot_${metric_field}_vs_time.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MetricVsTimeChart({ data, metric_field, time_field, onEnlarge }) {
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    if (!enlarged) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setEnlarged(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enlarged]);

  if (!data?.length) return null;

  // Limit X-axis ticks to avoid overlap (aim for ~8–12 ticks)
  const xTickInterval = Math.max(0, Math.floor((data.length - 1) / 10));
  const formatShortDate = (label) => {
    if (label == null) return '';
    const s = String(label);
    const parts = s.split('/');
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return s.length > 8 ? s.slice(0, 8) : s;
  };

  const handleClick = () => {
    if (onEnlarge) onEnlarge();
    else setEnlarged((e) => !e);
  };

  const content = (
    <div className={`metric-vs-time-chart ${enlarged ? 'enlarged' : ''}`} onClick={handleClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleClick()}>
      <p className="metric-vs-time-label">
        {metric_field} vs {time_field || 'time'}
      </p>
      {enlarged ? (
        <div className="metric-vs-time-chart-enlarged-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 16, left: 0, bottom: 48 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
                tickLine={false}
                angle={-35}
                textAnchor="end"
                interval={xTickInterval}
                tickFormatter={formatShortDate}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={55}
                tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v)}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(15,15,35,0.92)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  color: '#e2e8f0',
                }}
                formatter={(value) => [value?.toLocale?.() ?? value, metric_field]}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }} />
              <Line
                type="monotone"
                dataKey={metric_field}
                name={metric_field}
                stroke="rgba(96, 165, 250, 0.9)"
                strokeWidth={2}
                dot={{ fill: 'rgba(96, 165, 250, 0.6)', r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 48 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
            tickLine={false}
            angle={-35}
            textAnchor="end"
            interval={xTickInterval}
            tickFormatter={formatShortDate}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={55}
            tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v)}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,15,35,0.92)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              color: '#e2e8f0',
            }}
            formatter={(value) => [value?.toLocale?.() ?? value, metric_field]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }} />
          <Line
            type="monotone"
            dataKey={metric_field}
            name={metric_field}
            stroke="rgba(96, 165, 250, 0.9)"
            strokeWidth={2}
            dot={{ fill: 'rgba(96, 165, 250, 0.6)', r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
      )}
      <p className="metric-vs-time-hint">{enlarged ? 'Click to shrink (Esc to close)' : 'Click to enlarge'}</p>
      <button
        type="button"
        className="metric-vs-time-download"
        onClick={(e) => {
          e.stopPropagation();
          downloadCsv(data, metric_field);
        }}
      >
        Download CSV
      </button>
    </div>
  );

  if (enlarged && !onEnlarge) {
    const modal = (
      <div className="metric-vs-time-modal" onClick={() => setEnlarged(false)} role="dialog" aria-modal="true" aria-label="Enlarged chart">
        <div className="metric-vs-time-modal-inner" onClick={(e) => e.stopPropagation()}>
          {content}
          <button type="button" className="metric-vs-time-close" onClick={() => setEnlarged(false)}>
            Close (Esc)
          </button>
        </div>
      </div>
    );
    return createPortal(modal, document.body);
  }

  return content;
}
