import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export type AuditAction = 
  | 'login'
  | 'logout'
  | 'signup'
  | 'patient_registered'
  | 'patient_updated'
  | 'patient_status_changed'
  | 'patient_deleted'
  | 'lab_request_created'
  | 'lab_request_updated'
  | 'prescription_created'
  | 'prescription_updated'
  | 'prescription_dispensed'
  | 'payment_received'
  | 'role_assigned'
  | 'role_removed'
  | 'access_denied';

export type ResourceType = 
  | 'auth'
  | 'patient'
  | 'lab_request'
  | 'prescription'
  | 'prescription_item'
  | 'payment'
  | 'user_role';

interface AuditLogEntry {
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  details?: Json;
  status?: 'success' | 'failure';
  errorMessage?: string;
}

/**
 * Logs an audit event to the database
 * Only attempts to log if user is authenticated
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      // Can't log audit events without a user context
      if (import.meta.env.DEV) {
        console.log('[DEV] Audit event skipped (no user):', entry);
      }
      return;
    }

    const { error } = await supabase
      .from('audit_logs')
      .insert([{
        user_id: user.id,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId ?? null,
        details: entry.details ?? null,
        status: entry.status ?? 'success',
        error_message: entry.errorMessage ?? null,
      }]);

    if (error) {
      if (import.meta.env.DEV) {
        console.error('[DEV] Failed to log audit event:', error);
      }
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[DEV] Error in logAuditEvent:', err);
    }
  }
}

/**
 * Logs a security-related audit event (access denied, suspicious activity)
 */
export async function logSecurityEvent(
  action: 'access_denied' | 'login' | 'logout' | 'signup',
  details?: Json,
  status: 'success' | 'failure' = 'success',
  errorMessage?: string
): Promise<void> {
  await logAuditEvent({
    action,
    resourceType: 'auth',
    details,
    status,
    errorMessage,
  });
}

/**
 * Creates an audit logger for a specific resource type
 */
export function createResourceAuditLogger(resourceType: ResourceType) {
  return async function logResourceEvent(
    action: AuditAction,
    resourceId: string,
    details?: Json,
    status: 'success' | 'failure' = 'success'
  ): Promise<void> {
    await logAuditEvent({
      action,
      resourceType,
      resourceId,
      details,
      status,
    });
  };
}

// Pre-configured audit loggers for common resources
export const patientAuditLogger = createResourceAuditLogger('patient');
export const labRequestAuditLogger = createResourceAuditLogger('lab_request');
export const prescriptionAuditLogger = createResourceAuditLogger('prescription');
export const paymentAuditLogger = createResourceAuditLogger('payment');
