import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '../api';

export function SyncIndicator() {
  const [status, setStatus] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await api.getSyncStatus();
      setStatus(data);
    } catch (e) {
      console.error('Failed to fetch sync status', e);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await api.syncNow();
      await fetchStatus();
    } catch (e) {
      console.error('Sync failed', e);
    } finally {
      setIsSyncing(false);
    }
  };

  if (!status) return null;

  const { pending_records, last_sync_error, last_sync_at } = status;
  
  const isError = !!last_sync_error;
  const isUpToDate = pending_records === 0;

  let Icon = isSyncing ? RefreshCw : (isUpToDate && !isError ? CheckCircle : AlertCircle);
  let color = isSyncing ? 'text-blue-400' : (isUpToDate && !isError ? 'text-green-400' : 'text-amber-400');
  if (isError) color = 'text-red-400';
  
  return (
    <button 
      onClick={handleSync}
      disabled={isSyncing}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-800 transition-colors w-full justify-center md:justify-start group ${isSyncing ? 'opacity-80' : ''}`}
      title={isError ? `Error: ${last_sync_error}` : `Pending: ${pending_records}`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${color} ${isSyncing ? 'animate-spin' : ''}`} />
      <div className="hidden md:flex flex-col items-start leading-tight">
        <span className="text-xs font-medium text-slate-300 group-hover:text-white transition-colors">
          {isSyncing ? 'Syncing...' : (pending_records > 0 ? `${pending_records} pending` : 'Synced')}
        </span>
        {!isSyncing && last_sync_at && (
          <span className="text-[10px] text-slate-500">
            {new Date(last_sync_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </button>
  );
}
