import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSession, getCurrentUser, getCollector, createCollector, signOut, onAuthStateChange } from "../lib/auth";
import type { Collector } from "../lib/auth";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  collector: Collector | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshCollector: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [collector, setCollector] = useState<Collector | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCollector = async (userId: string, userPhone?: string) => {
    try {
      let collectorData = await getCollector(userId);
      if (!collectorData) {
        const defaultName = userPhone ? `Collector (${userPhone})` : "Susu Collector";
        collectorData = await createCollector(userId, { name: defaultName, phone: userPhone || "" });
      }
      setCollector(collectorData);
    } catch (error) {
      console.error("Error loading collector:", error);
      setCollector({ id: userId, name: "Collector", created_at: new Date().toISOString() });
    }
  };

  const getActiveUserOrSession = async (): Promise<{ session: Session | null; user: User | null }> => {
    try {
      const currentSession = await getSession();
      if (currentSession?.user) return { session: currentSession, user: currentSession.user };
    } catch {}

    try {
      if (typeof window !== "undefined") {
        const stored = sessionStorage.getItem("susu_active_user") || localStorage.getItem("susu_active_user");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.id) return { session: null, user: parsed as User };
        }
      }
    } catch {}

    return { session: null, user: null };
  };

  const refreshCollector = async () => {
    try {
      const { session: activeSession, user: activeUser } = await getActiveUserOrSession();
      if (activeSession) setSession(activeSession);
      const targetUser = activeUser || user;
      if (targetUser) {
        setUser(targetUser);
        await loadCollector(targetUser.id, targetUser.phone || targetUser.user_metadata?.phone);
      }
    } catch (err) {
      console.warn("refreshCollector error:", err);
    }
  };

  useEffect(() => {
    // Initial load
    const initAuth = async () => {
      try {
        const { session: activeSession, user: activeUser } = await getActiveUserOrSession();
        setSession(activeSession);
        
        if (activeUser) {
          setUser(activeUser);
          await loadCollector(activeUser.id, activeUser.phone || activeUser.user_metadata?.phone);
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: { subscription } } = onAuthStateChange(async (newSession) => {
      if (newSession?.user) {
        setSession(newSession);
        setUser(newSession.user);
        await loadCollector(newSession.user.id, newSession.user.phone || newSession.user.user_metadata?.phone);
      } else {
        const { user: fallbackUser } = await getActiveUserOrSession();
        if (fallbackUser) {
          setUser(fallbackUser);
          await loadCollector(fallbackUser.id, fallbackUser.phone || fallbackUser.user_metadata?.phone);
        } else {
          setSession(null);
          setUser(null);
          setCollector(null);
        }
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await signOut();
    setSession(null);
    setUser(null);
    setCollector(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        collector,
        loading,
        signOut: handleSignOut,
        refreshCollector,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
