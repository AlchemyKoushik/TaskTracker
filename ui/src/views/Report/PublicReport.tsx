import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api';

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function PublicReport() {
  const { shareToken } = useParams();
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!shareToken) return;
    
    api.getPublicReport(shareToken)
      .then(setReport)
      .catch(e => setError(e.message || 'Failed to load report'));
  }, [shareToken]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-xl shadow-sm border border-red-200 text-center max-w-md w-full">
          <div className="text-red-500 text-xl font-semibold mb-2">Error Loading Report</div>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        Loading report data...
      </div>
    );
  }

  const { range, summary, categories, daily, is_final } = report;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 py-12 px-4 md:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 mb-2">Work Report</h1>
              <p className="text-slate-500">
                {range.start_date} to {range.end_date} 
                <span className="mx-2">•</span> 
                {range.timezone}
              </p>
            </div>
            {!is_final && (
              <div className="bg-amber-100 text-amber-800 px-3 py-1.5 rounded-md text-sm font-medium border border-amber-200 self-start md:self-auto">
                Provisional (Open work remaining)
              </div>
            )}
          </div>
        </header>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <p className="text-sm text-slate-500 mb-1">Active Time</p>
            <p className="text-3xl font-mono font-medium text-slate-900">{formatDuration(summary.active_seconds)}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <p className="text-sm text-slate-500 mb-1">Idle Time</p>
            <p className="text-3xl font-mono text-slate-600">{formatDuration(summary.idle_seconds)}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <p className="text-sm text-slate-500 mb-1">Tasks</p>
            <p className="text-3xl font-semibold text-slate-900">{summary.task_count}</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <p className="text-sm text-slate-500 mb-1">Workdays</p>
            <p className="text-3xl font-semibold text-slate-900">{summary.workday_count}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Daily Breakdown */}
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-semibold mb-6">Daily Activity</h2>
            <div className="space-y-4">
              {daily.map((day: any) => (
                <div key={day.date} className="flex justify-between items-center border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <span className="font-medium text-slate-700">{day.date}</span>
                  <div className="text-right">
                    <span className="font-mono font-medium text-slate-900">{formatDuration(day.active_seconds)}</span>
                    {day.idle_seconds > 0 && (
                      <span className="text-xs text-slate-400 font-mono ml-2 block">
                        + {formatDuration(day.idle_seconds)} idle
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-xl font-semibold mb-6">By Category</h2>
            <div className="space-y-6">
              {categories.map((cat: any) => (
                <div key={cat.id}>
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-medium text-slate-800">{cat.name}</h3>
                    <span className="font-mono font-medium">{formatDuration(cat.active_seconds)}</span>
                  </div>
                  <div className="space-y-2 pl-4 border-l-2 border-slate-100 mt-2">
                    {cat.tasks.map((task: any) => (
                      <div key={task.id} className="flex justify-between text-sm">
                        <span className="text-slate-600">{task.name}</span>
                        <span className="font-mono text-slate-500">{formatDuration(task.active_seconds)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

