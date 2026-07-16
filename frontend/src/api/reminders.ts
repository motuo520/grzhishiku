import api from './client';

export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  content: string | null;
  remind_at: string;
  is_completed: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ReminderList {
  total: number;
  reminders: Reminder[];
}

export interface UpcomingReminder {
  id: string;
  title: string;
  content: string | null;
  remind_at: string;
  source: string;
}

export interface CreateReminderData {
  title: string;
  content?: string;
  remind_at: string;
  source?: string;
}

export interface UpdateReminderData {
  title?: string;
  content?: string;
  remind_at?: string;
  is_completed?: boolean;
}

export const reminderApi = {
  getReminders: (includeCompleted = false, upcomingHours?: number) =>
    api.get<ReminderList>('/api/v1/sticky/reminders/', { params: { include_completed: includeCompleted, upcoming_hours: upcomingHours } }),
  getUpcoming: (minutes = 15) =>
    api.get<UpcomingReminder[]>('/api/v1/sticky/reminders/upcoming', { params: { minutes } }),
  createReminder: (data: CreateReminderData) =>
    api.post<Reminder>('/api/v1/sticky/reminders/', data),
  updateReminder: (id: string, data: UpdateReminderData) =>
    api.patch<Reminder>(`/api/v1/sticky/reminders/${id}`, data),
  deleteReminder: (id: string) =>
    api.delete(`/api/v1/sticky/reminders/${id}`),
};
