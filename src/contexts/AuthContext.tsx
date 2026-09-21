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

  const refreshCollector = async () => {
    if (user) {
      await loadCollector(user.id, user.phone || user.user_metadata?.phone);
    }
  };

  useEffect(() => {
    // Initial load
    const initAuth = async () => {
      try {
        const currentSession = await getSession();
        setSession(currentSession);
        
        if (currentSession?.user) {
          setUser(currentSession.user);
          await loadCollector(currentSession.user.id, currentSession.user.phone || currentSession.user.user_metadata?.phone);
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
      setSession(newSession);
      setUser(newSession?.user || null);
      
      if (newSession?.user) {
        await loadCollector(newSession.user.id, newSession.user.phone || newSession.user.user_metadata?.phone);
      } else {
        setCollector(null);
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
