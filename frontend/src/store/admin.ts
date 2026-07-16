import { create } from 'zustand';

interface AdminState {
  isAdmin: boolean;
  adminToken: string | null;
  adminUser: any | null;
  
  setAdminToken: (token: string) => void;
  clearAdmin: () => void;
}

export const useAdmin = create<AdminState>((set) => ({
  isAdmin: false,
  adminToken: null,
  adminUser: null,
  
  setAdminToken: (token) => set({ adminToken: token, isAdmin: true }),
  clearAdmin: () => set({ adminToken: null, isAdmin: false, adminUser: null }),
}));
