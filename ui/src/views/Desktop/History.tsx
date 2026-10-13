import { useState, useEffect } from 'react';
import { api } from '../../api';

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function DesktopHistory() {
  const [workdays, setWorkdays] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const today = new Date();
        const past = new Date();
        past.setDate(today.getDate() - 7);
        
        const toLocalDate = (date: Date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        const start = toLocalDate(past);
        const end = toLocalDate(today);
        
        const res = await api.getWorkdays(start, end);
        setWorkdays(res.items || []);
      } catch (e: any) {
        console.error(e);
        setError(e.message || 'Failed to load history');
      } finally {
        setIsLoading(false);
      }
    };
    fetchHistory();
  }, []);

  if (isLoading) return <div className="p-8 text-slate-500">Loading history...</div>;
  if (error) return <div className="p-8 text-red-500 font-medium">Error: {error}</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Work History</h1>
      <p className="text-slate-500 mb-4">Last 7 days</p>

      <div className="flex flex-col gap-4">
        {workdays.map((dayItem, index) => {
          const { workday, totals, entries } = dayItem;
          return (
            <div key={workday.id || index} className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-3 shadow-sm">
              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                <h3 className="font-medium text-lg">{workday.work_date}</h3>
                <div className="flex items-center gap-2">
                  <div className="text-sm text-slate-700 bg-slate-100 px-3 py-1 rounded-full font-mono">
                    {formatDuration(totals.active_seconds)} Active
                  </div>
                  {totals.idle_seconds > 0 && (
                    <div className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full font-mono">
                      {formatDuration(totals.idle_seconds)} Idle
                    </div>
                  )}
                  {totals.paused_seconds > 0 && (
                    <div className="text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded-full font-mono border border-slate-200">
                      {formatDuration(totals.paused_seconds)} Paused
                    </div>
                  )}
                </div>
              </div>
              
              {entries?.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 mt-2">
                  {entries.map((entry: any) => (
                    <div key={entry.id} className="flex justify-between text-sm py-1 border-b border-slate-50 last:border-0">
                      <div>
                        <span className="font-medium text-slate-800">{entry.task?.name || 'Unnamed task'}</span>
                        <span className="text-slate-400 ml-2">({entry.task?.category?.name || 'Uncategorized'})</span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-slate-600">{formatDuration(entry.active_seconds)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-400 italic">No tasks recorded.</div>
              )}
            </div>
          );
        })}

        {workdays.length === 0 && (
          <div className="text-center p-8 text-slate-500 border border-slate-200 border-dashed rounded-lg bg-slate-50">
            No workdays found in the selected range.
          </div>
        )}
      </div>
    </div>
  );
}

