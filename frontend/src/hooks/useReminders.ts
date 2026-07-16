import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reminderApi, type CreateReminderData, type UpdateReminderData } from '@/api/reminders';

const REMINDERS_KEY = ['reminders'] as const;
const UPCOMING_KEY = ['reminders-upcoming'] as const;

export const useReminders = (includeCompleted = false, upcomingHours?: number) => {
  const query = useQuery({
    queryKey: [...REMINDERS_KEY, includeCompleted, upcomingHours],
    queryFn: async () => {
      const res = await reminderApi.getReminders(includeCompleted, upcomingHours);
      return res.data;
    },
  });

  return {
    reminders: query.data?.reminders ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    error: query.error,
  };
};

export const useUpcomingReminders = (minutes = 15) => {
  return useQuery({
    queryKey: [...UPCOMING_KEY, minutes],
    queryFn: async () => {
      const res = await reminderApi.getUpcoming(minutes);
      return res.data;
    },
    refetchInterval: 30 * 1000,
  });
};

export const useCreateReminder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateReminderData) => reminderApi.createReminder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });
      queryClient.invalidateQueries({ queryKey: UPCOMING_KEY });
    },
  });
};

export const useUpdateReminder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReminderData }) =>
      reminderApi.updateReminder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });
      queryClient.invalidateQueries({ queryKey: UPCOMING_KEY });
    },
  });
};

export const useDeleteReminder = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reminderApi.deleteReminder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REMINDERS_KEY });
      queryClient.invalidateQueries({ queryKey: UPCOMING_KEY });
    },
  });
};
