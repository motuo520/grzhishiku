import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Admin {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

interface AdminState {
  admin: Admin | null;
  token: string | null;
  setAdmin: (admin: Admin) => void;
  setToken: (token: string) => void;
  login: (admin: Admin, token: string) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      admin: null,
      token: null,
      setAdmin: (admin) => set({ admin }),
      setToken: (token) => set({ token }),
      login: (admin, token) => set({ admin, token }),
      logout: () => set({ admin: null, token: null }),
      hasPermission: (permission: string) => {
        const admin = get().admin;
        if (!admin) return false;
        if (admin.role === 'super_admin') return true;
        return (admin.permissions || []).includes(permission);
      },
    }),
    {
      name: 'psb-admin-auth',
      partialize: (state) => ({ admin: state.admin, token: state.token }),
    }
  )
);
