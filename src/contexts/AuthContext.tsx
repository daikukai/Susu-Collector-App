import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSession, getCurrentUser, getCollector, signOut, onAuthStateChange } from "../lib/auth";
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

  const loadCollector = async (userId: string) => {
    try {
      const collectorData = await getCollector(userId);
      setCollector(collectorData);
    } catch (error) {
      console.error("Error loading collector:", error);
      setCollector(null);
    }
  };

  const refreshCollector = async () => {
    if (user) {
      await loadCollector(user.id);
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
          await loadCollector(currentSession.user.id);
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
        await loadCollector(newSession.user.id);
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
