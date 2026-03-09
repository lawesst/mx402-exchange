'use client';

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type UsagePoint = {
  label: string;
  value: number;
};

export function UsageChart({ data, stroke = '#23F7DD' }: { data: UsagePoint[]; stroke?: string }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fill: '#8896AA', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#8896AA', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: '#0F1520',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 18,
              color: '#E8EDF5'
            }}
          />
          <Line type="monotone" dataKey="value" stroke={stroke} strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
