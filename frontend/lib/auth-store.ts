import { create } from "zustand";
import type { User } from "@/types";

// Access token lives only in memory (this store), never localStorage, to
// reduce XSS blast radius. The refresh token is an httpOnly cookie set by
// the backend; silent refresh happens via lib/api.ts on a 401.
interface AuthState {
  accessToken: string | null;
  user: User | null;
  walletAddress: string | null;
  isAuthenticating: boolean;
  setSession: (token: string, walletAddress: string, user?: User | null) => void;
  setUser: (user: User | null) => void;
  setAuthenticating: (v: boolean) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  walletAddress: null,
  isAuthenticating: false,
  setSession: (accessToken, walletAddress, user = null) => set({ accessToken, walletAddress, user }),
  setUser: (user) => set({ user }),
  setAuthenticating: (isAuthenticating) => set({ isAuthenticating }),
  clear: () => set({ accessToken: null, user: null, walletAddress: null }),
}));
