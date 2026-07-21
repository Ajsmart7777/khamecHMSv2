import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { logError } from '@/lib/errorHandler';
import { logSecurityEvent } from '@/lib/auditLogger';

export type AppRole = 'admin' | 'doctor' | 'doctor1' | 'doctor2' | 'nurse' | 'receptionist' | 'pharmacist' | 'lab_tech' | 'billing' | 'store' | 'accountant' | 'claims_manager';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  hasRole: (roles: AppRole | AppRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();

      if (error) {
        logError('Error fetching user role', error);
        return null;
      }

      return data?.role as AppRole;
    } catch (err) {
      logError('Error in fetchUserRole', err);
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;
    let isInitialized = false;
    let refreshInterval: ReturnType<typeof setInterval> | null = null;

    // Function to refresh session proactively
    const refreshSession = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        
        if (!currentSession) return;
        
        // Check if token expires within the next 5 minutes
        const expiresAt = currentSession.expires_at;
        if (expiresAt) {
          const expiresInMs = expiresAt * 1000 - Date.now();
          const fiveMinutesMs = 5 * 60 * 1000;
          
          if (expiresInMs < fiveMinutesMs && expiresInMs > 0) {
            const { data, error } = await supabase.auth.refreshSession();
            if (error) {
              logError('Session refresh failed', error);
            } else if (data.session && isMounted) {
              setSession(data.session);
              setUser(data.session.user);
            }
          }
        }
      } catch (err) {
        logError('Error in session refresh', err);
      }
    };

    // Initialize session first
    const initializeSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!isMounted) return;
        
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          setRoleLoading(true);
          const fetchedRole = await fetchUserRole(session.user.id);
          if (isMounted) {
            setRole(fetchedRole);
            setRoleLoading(false);
          }
          
          // Start proactive refresh interval (check every 4 minutes)
          refreshInterval = setInterval(refreshSession, 4 * 60 * 1000);
        }
      } catch (err) {
        logError('Error initializing session', err);
      } finally {
        if (isMounted) {
          setLoading(false);
          isInitialized = true;
        }
      }
    };

    initializeSession();

    // Set up auth state listener for subsequent changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;
        
        // Skip if this is the initial session (already handled above)
        if (!isInitialized && event === 'INITIAL_SESSION') return;
        
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          setRoleLoading(true);
          // Use setTimeout to prevent Supabase deadlock
          setTimeout(async () => {
            if (!isMounted) return;
            const fetchedRole = await fetchUserRole(session.user.id);
            if (isMounted) {
              setRole(fetchedRole);
              setRoleLoading(false);
            }
          }, 0);
          
          // Start refresh interval if not already running
          if (!refreshInterval) {
            refreshInterval = setInterval(refreshSession, 4 * 60 * 1000);
          }
        } else {
          setRole(null);
          setRoleLoading(false);
          // Clear refresh interval when logged out
          if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
          }
        }
        
        // Handle token refresh events - session is already updated above
        if (event === 'TOKEN_REFRESHED') {
          console.debug('Auth token refreshed successfully');
        }
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        // Log failed login attempt
        logSecurityEvent('login', { email }, 'failure', error.message);
        throw error;
      }
      // Successful login will be logged after auth state change
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signUp = async (email: string, password: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });
      if (error) {
        logSecurityEvent('signup', { email }, 'failure', error.message);
        throw error;
      }
      // Signup success will be logged after auth state change
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  };

  const signOut = async () => {
    // Log logout before signing out
    logSecurityEvent('logout', undefined, 'success');
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setRole(null);
  };

  const hasRole = (roles: AppRole | AppRole[]) => {
    if (!role) return false;
    const roleArray = Array.isArray(roles) ? roles : [roles];
    return roleArray.includes(role);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        loading: loading || roleLoading,
        signIn,
        signUp,
        signOut,
        isAuthenticated: !!user,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
