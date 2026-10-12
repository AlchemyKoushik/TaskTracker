import { useState, useEffect } from 'react';
import { api } from '../../api';
import { Save } from 'lucide-react';

export default function DesktopSettings() {
  const [settings, setSettings] = useState<any>(null);
  const [idleThreshold, setIdleThreshold] = useState<string>('60');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await api.getSettings();
        setSettings(res);
        setIdleThreshold(res.idle_threshold_seconds.toString());
      } catch (e) {
        console.error(e);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage('');
    try {
      await api.updateSettings({ idle_threshold_seconds: parseInt(idleThreshold, 10) });
      setMessage('Settings saved successfully.');
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  if (!settings) return <div className="p-8 text-slate-500">Loading settings...</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
      
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm flex flex-col gap-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Idle Threshold (seconds)
          </label>
          <p className="text-sm text-slate-500 mb-3">
            Time before the app marks you as idle if no mouse or keyboard input is detected.
          </p>
          <input
            type="number"
            min="30"
            max="3600"
            value={idleThreshold}
            onChange={(e) => setIdleThreshold(e.target.value)}
            className="w-full max-w-xs px-3 py-2 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>

        <div className="pt-4 border-t border-slate-100 flex items-center gap-4">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors"
          >
            <Save className="w-4 h-4" /> Save Settings
          </button>
          
          {message && (
            <span className={`text-sm ${message.startsWith('Error') ? 'text-red-500' : 'text-green-600'}`}>
              {message}
            </span>
          )}
        </div>
      </div>
      
      <div className="bg-slate-100 rounded-lg p-6 text-sm text-slate-600 mt-4">
        <h3 className="font-semibold text-slate-800 mb-2">About TaskTracker Data Collection</h3>
        <p>
          TaskTracker respects your privacy. It only checks the age of your last system input event to determine idle status. 
          It <strong>never</strong> records keystrokes, mouse coordinates, screenshots, window titles, or clipboard contents.
        </p>
      </div>
    </div>
  );
}

