"use client";

import { useCallback, useEffect } from "react";
import { useAccount, useSignMessage, useDisconnect } from "wagmi";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

/** Drives the SIWE-style flow: nonce -> sign -> verify -> session. */
export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const { accessToken, user, walletAddress, isAuthenticating, setSession, setUser, setAuthenticating, clear } =
    useAuthStore();

  const login = useCallback(async () => {
    if (!address) throw new Error("Connect a wallet first");
    setAuthenticating(true);
    try {
      const { nonce, message } = await authApi.nonce(address);
      const signature = await signMessageAsync({ message });
      const result = await authApi.verify(address, nonce, signature);
      setSession(result.accessToken, result.walletAddress);
      try {
        const { user } = await authApi.me();
        setUser(user);
      } catch {
        // non-fatal — session still valid even if profile fetch fails
      }
    } finally {
      setAuthenticating(false);
    }
  }, [address, signMessageAsync, setSession, setUser, setAuthenticating]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clear();
      disconnect();
    }
  }, [clear, disconnect]);

  useEffect(() => {
    if (!isConnected) clear();
  }, [isConnected, clear]);

  return {
    address,
    isConnected,
    isAuthenticated: Boolean(accessToken),
    isAuthenticating,
    user,
    walletAddress,
    login,
    logout,
  };
}
