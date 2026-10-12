import { useEffect, useState, type FormEvent } from 'react';
import { Play, Pause, Square, CheckSquare, Plus, Search, X } from 'lucide-react';
import { api } from '../../api';

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function DesktopHome() {
  const [bootstrap, setBootstrap] = useState<any>(null);
  const [current, setCurrent] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [tasks, setTasks] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [newTaskNotes, setNewTaskNotes] = useState('');
  const [newTaskCategory, setNewTaskCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchState = async () => {
    try {
      setLoadError('');
      const [bootRes, currentRes, catRes] = await Promise.all([
        api.getBootstrap(),
        api.getCurrent(),
        api.getCategories()
      ]);
      setBootstrap(bootRes);
      setCurrent(currentRes);
      setCategories(catRes.items || []);
      setNewTaskCategory((selected) => selected || catRes.items?.[0]?.id || '');
    } catch (e) {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : 'Could not load TaskTracker.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    
    // Refresh on focus
    const onFocus = () => fetchState();
    window.addEventListener('focus', onFocus);
    
    // Poll every second to update local timers if running
    const interval = setInterval(() => {
      setCurrent((prev: any) => {
        if (!prev || !prev.current_entry) return prev;
        const entry = { ...prev.current_entry };
        const seg = entry.current_segment;
        if (seg) {
            if (seg.kind === 'active') entry.active_seconds += 1;
            if (seg.kind === 'idle') entry.idle_seconds += 1;
            if (seg.kind === 'paused') entry.paused_seconds += 1;
        }
        return { ...prev, current_entry: entry };
      });
    }, 1000);

    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const delay = setTimeout(async () => {
      try {
        const res = await api.searchTasks(search);
        setTasks(res.items || []);
      } catch (e) {
        console.error(e);
      }
    }, 300);
    return () => clearTimeout(delay);
  }, [search]);

  const handleAction = async (action: () => Promise<any>) => {
    try {
      await action();
      await fetchState();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleWrapWorkday = () => {
    if (confirm('Are you sure you want to wrap up the entire workday?')) {
      handleAction(() => api.wrapUpWorkday());
    }
  };

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setFormError('');
    try {
      const category = await api.createCategory({ name, color: null });
      setCategories((items) => [...items, category].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTaskCategory(category.id);
      setNewCategoryName('');
    } catch (e: any) {
      setFormError(e.message || 'Could not create category.');
    }
  };

  const handleCreateTask = async (event: FormEvent) => {
    event.preventDefault();
    const name = newTaskName.trim();
    if (!name || !newTaskCategory) {
      setFormError('Enter a task name and choose a category.');
      return;
    }
    setIsCreating(true);
    setFormError('');
    try {
      const task = await api.createTask({
        name,
        category_id: newTaskCategory,
        notes: newTaskNotes.trim() || null,
      });
      setTasks((items) => [task, ...items.filter((item) => item.id !== task.id)]);
      setNewTaskName('');
      setNewTaskNotes('');
      setShowNewTask(false);
      await fetchState();
    } catch (e: any) {
      setFormError(e.message || 'Could not create task.');
    } finally {
      setIsCreating(false);
    }
  };

  if (isLoading) return <div className="p-8 text-slate-500">Loading...</div>;
  if (loadError) {
    return (
      <div className="p-8 max-w-xl mx-auto">
        <div className="bg-white border border-red-200 rounded-xl p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">TaskTracker is unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{loadError}</p>
          <button onClick={fetchState} className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const activeEntry = current?.current_entry;
  const activeSegment = activeEntry?.current_segment;
  const isRunning = activeSegment?.kind === 'active';
  const isPaused = activeSegment?.kind === 'paused';
  const isIdle = activeSegment?.kind === 'idle';

  return (
    <div className="p-8 max-w-4xl mx-auto flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">TaskTracker</h1>
        <p className="text-slate-500">
          Workday: {bootstrap?.current_workday?.work_date || 'Not started'} 
          ({bootstrap?.timezone})
        </p>
      </div>

      {/* Current Task Status */}
      {activeEntry ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col gap-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-1">
                Current Task
              </h2>
              <p className="text-xl font-semibold text-slate-900">{activeEntry.task?.name || 'Unnamed task'}</p>
              <p className="text-sm text-slate-500">{activeEntry.task?.category?.name || 'Uncategorized'}</p>
            </div>
            
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                isRunning ? 'bg-green-100 text-green-700' :
                isIdle ? 'bg-amber-100 text-amber-700' :
                'bg-slate-100 text-slate-700'
              }`}>
                {isRunning ? 'Running' : isIdle ? 'Idle' : 'Paused'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-8 text-center bg-slate-50 p-4 rounded-lg">
            <div className="flex-1">
              <p className="text-sm text-slate-500 mb-1">Active</p>
              <p className="text-2xl font-mono font-medium text-slate-900">{formatDuration(activeEntry.active_seconds)}</p>
            </div>
            <div className="flex-1 border-l border-slate-200">
              <p className="text-sm text-slate-500 mb-1">Idle</p>
              <p className="text-xl font-mono text-slate-600">{formatDuration(activeEntry.idle_seconds)}</p>
            </div>
            <div className="flex-1 border-l border-slate-200">
              <p className="text-sm text-slate-500 mb-1">Paused</p>
              <p className="text-xl font-mono text-slate-600">{formatDuration(activeEntry.paused_seconds)}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {isPaused ? (
              <button 
                onClick={() => handleAction(() => api.resumeTask())}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors"
              >
                <Play className="w-4 h-4" /> Resume
              </button>
            ) : (
              <button 
                onClick={() => handleAction(() => api.pauseTask())}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-900 hover:bg-slate-200 rounded-md transition-colors border border-slate-200"
              >
                <Pause className="w-4 h-4" /> Pause
              </button>
            )}
            
            <button 
              onClick={() => handleAction(() => api.wrapUpTask())}
              className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 hover:bg-slate-50 rounded-md transition-colors border border-slate-200 ml-auto"
            >
              <CheckSquare className="w-4 h-4" /> Wrap Up Task
            </button>
            
            <button 
              onClick={handleWrapWorkday}
              className="flex items-center gap-2 px-4 py-2 bg-white text-red-600 hover:bg-red-50 rounded-md transition-colors border border-red-200"
            >
              <Square className="w-4 h-4" /> Wrap Workday
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-slate-100 border border-slate-200 border-dashed rounded-xl p-8 text-center">
          <p className="text-slate-500 font-medium">No task running.</p>
          <p className="text-sm text-slate-400 mt-1">Select a task below to start tracking time.</p>
          
          {bootstrap?.current_workday && (
            <div className="mt-4">
              <button 
                onClick={handleWrapWorkday}
                className="flex items-center gap-2 px-4 py-2 bg-white text-slate-700 hover:bg-slate-50 rounded-md transition-colors border border-slate-200 mx-auto"
              >
                <Square className="w-4 h-4" /> Close Open Workday
              </button>
            </div>
          )}
        </div>
      )}

      {/* Task List / Search */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-slate-900">Start a Task</h2>
          <button
            onClick={() => { setShowNewTask(true); setFormError(''); }}
            className="ml-auto flex items-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" /> New Task
          </button>
        </div>

        {showNewTask && (
          <form onSubmit={handleCreateTask} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Create a new task</h3>
              <button type="button" onClick={() => setShowNewTask(false)} className="text-slate-400 hover:text-slate-700" aria-label="Close new task form">
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="text-sm font-medium text-slate-700">
              Task name
              <input autoFocus required maxLength={240} value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} placeholder="e.g. Prepare client report" className="mt-1 w-full px-3 py-2 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Category
              <select required value={newTaskCategory} onChange={(e) => setNewTaskCategory(e.target.value)} className="mt-1 w-full px-3 py-2 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="" disabled>Select a category</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <input value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="New category name" className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-400" />
              <button type="button" onClick={handleCreateCategory} disabled={!newCategoryName.trim()} className="px-3 py-2 border border-slate-300 rounded-md text-sm hover:bg-slate-50 disabled:opacity-50">Add category</button>
            </div>
            <label className="text-sm font-medium text-slate-700">
              Notes <span className="font-normal text-slate-400">(optional)</span>
              <textarea maxLength={4000} value={newTaskNotes} onChange={(e) => setNewTaskNotes(e.target.value)} rows={3} placeholder="Add context for this task" className="mt-1 w-full px-3 py-2 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </label>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewTask(false)} className="px-4 py-2 border border-slate-200 rounded-md text-sm hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={isCreating || !categories.length} className="px-4 py-2 bg-slate-900 text-white rounded-md text-sm hover:bg-slate-800 disabled:opacity-50">{isCreating ? 'Creating…' : 'Create task'}</button>
            </div>
          </form>
        )}
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search tasks..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tasks.map(task => (
            <button
              key={task.id}
              onClick={() => handleAction(() => api.startTask(task.id))}
              className="flex flex-col items-start p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-400 hover:shadow-sm transition-all text-left"
            >
              <span className="font-medium text-slate-900">{task.name}</span>
              <span className="text-xs text-slate-500 mt-1">{task.category?.name || 'Uncategorized'}</span>
            </button>
          ))}
          
          {tasks.length === 0 && search && (
            <div className="col-span-full p-8 text-center text-slate-500">
              No tasks found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

