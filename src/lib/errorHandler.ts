/**
 * Centralized error handling utility for secure error logging
 * Only logs detailed errors in development mode
 * Sends errors to server-side logging in production
 */

import { supabase } from '@/integrations/supabase/client';

type SupabaseErrorCode = string;

const ERROR_MESSAGES: Record<SupabaseErrorCode, string> = {
  '23505': 'A record with this information already exists',
  '23503': 'Invalid reference to related data',
  '42501': 'Access denied. Please check your permissions',
  '23502': 'Required information is missing',
  '22P02': 'Invalid data format',
  'PGRST116': 'Record not found',
  'PGRST301': 'Connection error. Please try again',
};

interface SupabaseError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

/**
 * Gets a user-friendly error message from a Supabase error
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred';
  
  const supabaseError = error as SupabaseError;
  
  if (supabaseError.code && ERROR_MESSAGES[supabaseError.code]) {
    return ERROR_MESSAGES[supabaseError.code];
  }
  
  // Return generic message for production
  return 'An error occurred. Please try again or contact support';
}

/**
 * Sends error to server-side logging
 */
async function sendToServerLog(context: string, error: unknown): Promise<void> {
  try {
    const errorObj = error as Error;
    
    await supabase.functions.invoke('log-error', {
      body: {
        errorType: context,
        errorMessage: errorObj?.message ?? String(error),
        errorStack: errorObj?.stack,
        context: {
          name: errorObj?.name,
          ...(error as SupabaseError)?.code && { code: (error as SupabaseError).code },
        },
        url: window.location.href,
      },
    });
  } catch {
    // Silently fail - don't cause additional errors
  }
}

/**
 * Logs error details only in development mode
 * In production, sends to server-side logging
 */
export function logError(context: string, error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[DEV] ${context}:`, error);
  } else {
    // Send to server-side logging in production
    sendToServerLog(context, error);
  }
}

/**
 * Logs informational messages only in development mode
 */
export function logInfo(context: string, data: unknown): void {
  if (import.meta.env.DEV) {
    console.log(`[DEV] ${context}:`, data);
  }
}
