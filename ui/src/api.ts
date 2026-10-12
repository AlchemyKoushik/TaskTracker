// Use a relative path or a configurable environment variable for VPS
// If running in browser and NOT on localhost/desktop, use the origin.
export const isDesktopEnv = window.location.protocol === 'app:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
export const API_BASE_URL = isDesktopEnv 
  ? 'http://127.0.0.1:8765/api/v1'
  : (import.meta.env.VITE_API_BASE_URL || '/api/v1');

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let errorData: any;
    try {
      errorData = await response.json();
    } catch {
      throw new Error(`API Error: ${response.statusText}`);
    }
    const detail = errorData?.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail?.message || errorData?.message || `API Error: ${response.status}`;
    throw new Error(message);
  }

  return response.json();
}

export const api = {
  getBootstrap: () => fetchApi<any>('/bootstrap'),
  getCurrent: () => fetchApi<any>('/current'),
  getCategories: () => fetchApi<any>('/categories'),
  createCategory: (data: { name: string; color: string | null }) => 
    fetchApi<any>('/categories', { method: 'POST', body: JSON.stringify(data) }),
  searchTasks: (q = '', limit = 30) => 
    fetchApi<any>(`/tasks?q=${encodeURIComponent(q)}&limit=${limit}`),
  createTask: (data: { name: string; category_id: string; notes: string | null }) => 
    fetchApi<any>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  startTask: (task_id: string) => 
    fetchApi<any>('/tasks/start', { method: 'POST', body: JSON.stringify({ task_id }) }),
  pauseTask: () => fetchApi<any>('/tasks/pause', { method: 'POST' }),
  resumeTask: () => fetchApi<any>('/tasks/resume', { method: 'POST' }),
  wrapUpTask: () => fetchApi<any>('/tasks/wrap-up', { method: 'POST' }),
  wrapUpWorkday: () => fetchApi<any>('/workday/wrap-up', { method: 'POST' }),
  getWorkdays: (startDate: string, endDate: string) => 
    fetchApi<any>(`/workdays?start_date=${startDate}&end_date=${endDate}`),
  getSettings: () => fetchApi<any>('/settings'),
  updateSettings: (settings: { idle_threshold_seconds: number }) => 
    fetchApi<any>('/settings', { method: 'PATCH', body: JSON.stringify(settings) }),
  getSyncStatus: () => fetchApi<any>('/sync/status'),
  syncNow: () => fetchApi<any>('/sync/now', { method: 'POST' }),
  getPublicReport: (token: string) => 
    fetchApi<any>(`/public/reports/${token}`),
};

