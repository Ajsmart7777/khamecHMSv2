export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          error_message: string | null
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type: string
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          error_message?: string | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      balance_requests: {
        Row: {
          amount: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          expires_at: string
          id: string
          notes: string | null
          patient_id: string
          payment_method: string | null
          rejection_reason: string | null
          request_type: string
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          notes?: string | null
          patient_id: string
          payment_method?: string | null
          rejection_reason?: string | null
          request_type: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          notes?: string | null
          patient_id?: string
          payment_method?: string | null
          rejection_reason?: string | null
          request_type?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "balance_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      balance_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          id: string
          notes: string | null
          patient_id: string
          payment_method: string | null
          performed_by: string | null
          related_invoice_id: string | null
          related_request_id: string | null
          transaction_type: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          id?: string
          notes?: string | null
          patient_id: string
          payment_method?: string | null
          performed_by?: string | null
          related_invoice_id?: string | null
          related_request_id?: string | null
          transaction_type: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          notes?: string | null
          patient_id?: string
          payment_method?: string | null
          performed_by?: string | null
          related_invoice_id?: string | null
          related_request_id?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "balance_transactions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_transactions_related_invoice_id_fkey"
            columns: ["related_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_transactions_related_request_id_fkey"
            columns: ["related_request_id"]
            isOneToOne: false
            referencedRelation: "balance_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_notes: {
        Row: {
          assessment: string | null
          created_at: string
          doctor_id: string
          finalized_at: string | null
          follow_up_date: string | null
          icd10_code: string | null
          id: string
          objective: string | null
          patient_id: string
          plan: string | null
          prescription_id: string | null
          status: string
          subjective: string | null
          updated_at: string
          visit_date: string
        }
        Insert: {
          assessment?: string | null
          created_at?: string
          doctor_id: string
          finalized_at?: string | null
          follow_up_date?: string | null
          icd10_code?: string | null
          id?: string
          objective?: string | null
          patient_id: string
          plan?: string | null
          prescription_id?: string | null
          status?: string
          subjective?: string | null
          updated_at?: string
          visit_date?: string
        }
        Update: {
          assessment?: string | null
          created_at?: string
          doctor_id?: string
          finalized_at?: string | null
          follow_up_date?: string | null
          icd10_code?: string | null
          id?: string
          objective?: string | null
          patient_id?: string
          plan?: string | null
          prescription_id?: string | null
          status?: string
          subjective?: string | null
          updated_at?: string
          visit_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_notes_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_accounts: {
        Row: {
          account_type: string
          address: string | null
          balance: number
          company_name: string
          contact_person: string
          created_at: string
          discount_percentage: number
          email: string
          id: string
          notes: string | null
          phone: string
          sponsor_type: string
          status: string
          treatment_limit: number
          updated_at: string
        }
        Insert: {
          account_type?: string
          address?: string | null
          balance?: number
          company_name: string
          contact_person: string
          created_at?: string
          discount_percentage?: number
          email: string
          id?: string
          notes?: string | null
          phone: string
          sponsor_type?: string
          status?: string
          treatment_limit?: number
          updated_at?: string
        }
        Update: {
          account_type?: string
          address?: string | null
          balance?: number
          company_name?: string
          contact_person?: string
          created_at?: string
          discount_percentage?: number
          email?: string
          id?: string
          notes?: string | null
          phone?: string
          sponsor_type?: string
          status?: string
          treatment_limit?: number
          updated_at?: string
        }
        Relationships: []
      }
      emr_attachments: {
        Row: {
          category: string
          created_at: string
          description: string | null
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          patient_id: string
          size_bytes: number | null
          uploaded_by: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          patient_id: string
          size_bytes?: number | null
          uploaded_by: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          patient_id?: string
          size_bytes?: number | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "emr_attachments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          context: Json | null
          created_at: string
          error_message: string
          error_stack: string | null
          error_type: string
          id: string
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          error_message: string
          error_stack?: string | null
          error_type: string
          id?: string
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          error_message?: string
          error_stack?: string | null
          error_type?: string
          id?: string
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      external_doctors: {
        Row: {
          created_at: string
          id: string
          name: string
          phone: string | null
          schedule_notes: string | null
          specialty: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          schedule_notes?: string | null
          specialty?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          schedule_notes?: string | null
          specialty?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      insurance_claims: {
        Row: {
          approved_at: string | null
          claim_number: string
          corporate_account_id: string | null
          covered_amount: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          notes: string | null
          paid_at: string | null
          patient_copay: number
          patient_id: string
          provider_id: string | null
          rejection_reason: string | null
          sponsor_type: string
          status: string
          submitted_at: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          claim_number: string
          corporate_account_id?: string | null
          covered_amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          paid_at?: string | null
          patient_copay?: number
          patient_id: string
          provider_id?: string | null
          rejection_reason?: string | null
          sponsor_type?: string
          status?: string
          submitted_at?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          claim_number?: string
          corporate_account_id?: string | null
          covered_amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          paid_at?: string | null
          patient_copay?: number
          patient_id?: string
          provider_id?: string | null
          rejection_reason?: string | null
          sponsor_type?: string
          status?: string
          submitted_at?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claims_corporate_account_id_fkey"
            columns: ["corporate_account_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "insurance_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_providers: {
        Row: {
          address: string | null
          code: string | null
          contact_person: string | null
          coverage_percentage: number
          created_at: string
          email: string | null
          id: string
          max_coverage_amount: number
          name: string
          notes: string | null
          phone: string | null
          plans: Json
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          code?: string | null
          contact_person?: string | null
          coverage_percentage?: number
          created_at?: string
          email?: string | null
          id?: string
          max_coverage_amount?: number
          name: string
          notes?: string | null
          phone?: string | null
          plans?: Json
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string | null
          contact_person?: string | null
          coverage_percentage?: number
          created_at?: string
          email?: string | null
          id?: string
          max_coverage_amount?: number
          name?: string
          notes?: string | null
          phone?: string | null
          plans?: Json
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          category: string
          created_at: string
          expiry_date: string | null
          id: string
          last_restocked: string | null
          location: string
          min_stock: number
          name: string
          quantity: number
          supplier: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          last_restocked?: string | null
          location?: string
          min_stock?: number
          name: string
          quantity?: number
          supplier?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          expiry_date?: string | null
          id?: string
          last_restocked?: string | null
          location?: string
          min_stock?: number
          name?: string
          quantity?: number
          supplier?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          category: string | null
          created_at: string
          description: string
          id: string
          invoice_id: string
          quantity: number
          total: number
          unit_price: number
        }
        Insert: {
          category?: string | null
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          total?: number
          unit_price?: number
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          corporate_account_id: string | null
          created_at: string
          created_by: string | null
          discount_amount: number
          id: string
          invoice_number: string
          notes: string | null
          original_amount: number
          paid_amount: number
          paid_at: string | null
          patient_id: string
          payment_method: string | null
          sponsor_type: string | null
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          corporate_account_id?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          id?: string
          invoice_number: string
          notes?: string | null
          original_amount?: number
          paid_amount?: number
          paid_at?: string | null
          patient_id: string
          payment_method?: string | null
          sponsor_type?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          corporate_account_id?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          id?: string
          invoice_number?: string
          notes?: string | null
          original_amount?: number
          paid_amount?: number
          paid_at?: string | null
          patient_id?: string
          payment_method?: string | null
          sponsor_type?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_corporate_account_id_fkey"
            columns: ["corporate_account_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_requests: {
        Row: {
          completed_at: string | null
          created_at: string
          diagnosis: string | null
          id: string
          patient_id: string
          printed: boolean
          request_number: string
          requested_at: string
          requested_by: string | null
          results: Json | null
          status: string
          tests: string[]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          diagnosis?: string | null
          id?: string
          patient_id: string
          printed?: boolean
          request_number: string
          requested_at?: string
          requested_by?: string | null
          results?: Json | null
          status?: string
          tests: string[]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          diagnosis?: string | null
          id?: string
          patient_id?: string
          printed?: boolean
          request_number?: string
          requested_at?: string
          requested_by?: string | null
          results?: Json | null
          status?: string
          tests?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lab_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string
          resource_id: string | null
          target_role: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          resource_id?: string | null
          target_role?: string | null
          title: string
          type?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          resource_id?: string | null
          target_role?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      patients: {
        Row: {
          account_type: string
          address: string
          allergies: string[] | null
          balance: number
          blood_group: string | null
          card_number: string
          corporate_id: string | null
          created_at: string
          date_of_birth: string
          emergency_contact: string
          first_name: string
          gender: string
          id: string
          insurance_plan: string | null
          insurance_policy_number: string | null
          insurance_provider: string | null
          last_name: string
          last_visit: string | null
          mini_card_number: string
          phone: string
          registered_at: string
          staff_link_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_type?: string
          address: string
          allergies?: string[] | null
          balance?: number
          blood_group?: string | null
          card_number: string
          corporate_id?: string | null
          created_at?: string
          date_of_birth: string
          emergency_contact: string
          first_name: string
          gender: string
          id?: string
          insurance_plan?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
          last_name: string
          last_visit?: string | null
          mini_card_number: string
          phone: string
          registered_at?: string
          staff_link_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_type?: string
          address?: string
          allergies?: string[] | null
          balance?: number
          blood_group?: string | null
          card_number?: string
          corporate_id?: string | null
          created_at?: string
          date_of_birth?: string
          emergency_contact?: string
          first_name?: string
          gender?: string
          id?: string
          insurance_plan?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
          last_name?: string
          last_visit?: string | null
          mini_card_number?: string
          phone?: string
          registered_at?: string
          staff_link_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_staff_link_id_fkey"
            columns: ["staff_link_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_deductions: {
        Row: {
          amount: number
          applied_in_period_id: string | null
          created_at: string
          id: string
          notes: string | null
          reason: string
          source_invoice_id: string | null
          staff_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          applied_in_period_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          reason: string
          source_invoice_id?: string | null
          staff_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          applied_in_period_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          reason?: string
          source_invoice_id?: string | null
          staff_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_deductions_applied_in_period_id_fkey"
            columns: ["applied_in_period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_deductions_source_invoice_id_fkey"
            columns: ["source_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_deductions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries: {
        Row: {
          allowances: Json
          basic_salary: number
          created_at: string
          deductions: Json
          gross_pay: number
          id: string
          net_pay: number
          payment_reference: string | null
          payroll_period_id: string
          staff_id: string
          status: string
          total_deductions: number
          updated_at: string
        }
        Insert: {
          allowances?: Json
          basic_salary?: number
          created_at?: string
          deductions?: Json
          gross_pay?: number
          id?: string
          net_pay?: number
          payment_reference?: string | null
          payroll_period_id: string
          staff_id: string
          status?: string
          total_deductions?: number
          updated_at?: string
        }
        Update: {
          allowances?: Json
          basic_salary?: number
          created_at?: string
          deductions?: Json
          gross_pay?: number
          id?: string
          net_pay?: number
          payment_reference?: string | null
          payroll_period_id?: string
          staff_id?: string
          status?: string
          total_deductions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_payroll_period_id_fkey"
            columns: ["payroll_period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          paid_at: string | null
          payroll_entry_id: string
          payroll_period_id: string
          provider: string
          provider_recipient_code: string | null
          provider_reference: string | null
          provider_transfer_code: string | null
          staff_id: string
          status: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          payroll_entry_id: string
          payroll_period_id: string
          provider?: string
          provider_recipient_code?: string | null
          provider_reference?: string | null
          provider_transfer_code?: string | null
          staff_id: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          paid_at?: string | null
          payroll_entry_id?: string
          payroll_period_id?: string
          provider?: string
          provider_recipient_code?: string | null
          provider_reference?: string | null
          provider_transfer_code?: string | null
          staff_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_payments_payroll_entry_id_fkey"
            columns: ["payroll_entry_id"]
            isOneToOne: false
            referencedRelation: "payroll_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_payroll_period_id_fkey"
            columns: ["payroll_period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          month: number
          status: string
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          month: number
          status?: string
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          month?: number
          status?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      prescription_items: {
        Row: {
          created_at: string
          dispensed: boolean | null
          dosage: string
          duration: string
          frequency: string
          id: string
          medication: string
          prescription_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          dispensed?: boolean | null
          dosage: string
          duration: string
          frequency: string
          id?: string
          medication: string
          prescription_id: string
          quantity: number
        }
        Update: {
          created_at?: string
          dispensed?: boolean | null
          dosage?: string
          duration?: string
          frequency?: string
          id?: string
          medication?: string
          prescription_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "prescription_items_prescription_id_fkey"
            columns: ["prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string
          created_by: string | null
          diagnosis: string | null
          id: string
          notes: string | null
          patient_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          id?: string
          notes?: string | null
          patient_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          diagnosis?: string | null
          id?: string
          notes?: string | null
          patient_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      shift_assignments: {
        Row: {
          created_at: string
          id: string
          shift_date: string
          shift_period_id: string
          staff_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          shift_date: string
          shift_period_id: string
          staff_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          shift_date?: string
          shift_period_id?: string
          staff_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_shift_period_id_fkey"
            columns: ["shift_period_id"]
            isOneToOne: false
            referencedRelation: "shift_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_logs: {
        Row: {
          clock_in_at: string | null
          clock_out_at: string | null
          created_at: string
          handover_notes: string | null
          id: string
          shift_date: string
          shift_period_id: string
          staff_user_id: string
          status: string
        }
        Insert: {
          clock_in_at?: string | null
          clock_out_at?: string | null
          created_at?: string
          handover_notes?: string | null
          id?: string
          shift_date: string
          shift_period_id: string
          staff_user_id: string
          status?: string
        }
        Update: {
          clock_in_at?: string | null
          clock_out_at?: string | null
          created_at?: string
          handover_notes?: string | null
          id?: string
          shift_date?: string
          shift_period_id?: string
          staff_user_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_logs_shift_period_id_fkey"
            columns: ["shift_period_id"]
            isOneToOne: false
            referencedRelation: "shift_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_periods: {
        Row: {
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          name: string
          start_time: string
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          is_active?: boolean
          name: string
          start_time: string
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          is_active?: boolean
          name?: string
          start_time?: string
        }
        Relationships: []
      }
      sponsor_statement_items: {
        Row: {
          amount: number
          created_at: string
          id: string
          invoice_id: string
          patient_id: string
          service_date: string
          statement_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          invoice_id: string
          patient_id: string
          service_date: string
          statement_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          invoice_id?: string
          patient_id?: string
          service_date?: string
          statement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_statement_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_statement_items_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_statement_items_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "sponsor_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_statements: {
        Row: {
          created_at: string
          finalized_at: string | null
          generated_at: string
          generated_by: string | null
          id: string
          invoice_count: number
          notes: string | null
          paid_at: string | null
          patient_count: number
          period_end: string
          period_month: number
          period_start: string
          period_year: number
          printed_at: string | null
          sponsor_id: string
          sponsor_type: string
          statement_number: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          finalized_at?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          invoice_count?: number
          notes?: string | null
          paid_at?: string | null
          patient_count?: number
          period_end: string
          period_month: number
          period_start: string
          period_year: number
          printed_at?: string | null
          sponsor_id: string
          sponsor_type: string
          statement_number: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          finalized_at?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          invoice_count?: number
          notes?: string | null
          paid_at?: string | null
          patient_count?: number
          period_end?: string
          period_month?: number
          period_start?: string
          period_year?: number
          printed_at?: string | null
          sponsor_id?: string
          sponsor_type?: string
          statement_number?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_statements_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          account_number: string | null
          auth_user_id: string | null
          bank_name: string | null
          created_at: string
          department: string
          designation: string | null
          email: string
          employee_id: string
          family_deduction_consent: boolean
          first_name: string
          hire_date: string
          id: string
          is_system_user: boolean
          last_name: string
          payment_method: string
          phone: string
          role: string
          salary: number
          staff_id_number: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          auth_user_id?: string | null
          bank_name?: string | null
          created_at?: string
          department?: string
          designation?: string | null
          email: string
          employee_id: string
          family_deduction_consent?: boolean
          first_name: string
          hire_date?: string
          id?: string
          is_system_user?: boolean
          last_name: string
          payment_method?: string
          phone: string
          role?: string
          salary?: number
          staff_id_number?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          auth_user_id?: string | null
          bank_name?: string | null
          created_at?: string
          department?: string
          designation?: string | null
          email?: string
          employee_id?: string
          family_deduction_consent?: boolean
          first_name?: string
          hire_date?: string
          id?: string
          is_system_user?: boolean
          last_name?: string
          payment_method?: string
          phone?: string
          role?: string
          salary?: number
          staff_id_number?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_attendance: {
        Row: {
          clock_in: string | null
          clock_out: string | null
          created_at: string
          date: string
          id: string
          notes: string | null
          shift_log_id: string | null
          staff_id: string
          status: string
        }
        Insert: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          shift_log_id?: string | null
          staff_id: string
          status?: string
        }
        Update: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          shift_log_id?: string | null
          staff_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_shift_log_id_fkey"
            columns: ["shift_log_id"]
            isOneToOne: false
            referencedRelation: "shift_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_family_members: {
        Row: {
          created_at: string
          id: string
          patient_id: string
          salary_deduction_consent: boolean
          staff_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          patient_id: string
          salary_deduction_consent?: boolean
          staff_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          patient_id?: string
          salary_deduction_consent?: boolean
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_family_members_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_family_members_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leave: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          days_count: number
          end_date: string
          id: string
          leave_type: string
          reason: string | null
          staff_id: string
          start_date: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          days_count?: number
          end_date: string
          id?: string
          leave_type?: string
          reason?: string | null
          staff_id: string
          start_date: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          days_count?: number
          end_date?: string
          id?: string
          leave_type?: string
          reason?: string | null
          staff_id?: string
          start_date?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_leave_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      standing_orders: {
        Row: {
          captured_by: string | null
          created_at: string
          expiry_date: string | null
          external_doctor_id: string | null
          external_doctor_name: string | null
          fulfilled_at: string | null
          fulfilled_by: string | null
          id: string
          notes: string | null
          order_type: string
          patient_id: string
          photo_url: string
          status: string
          transcribed_prescription_id: string | null
          updated_at: string
        }
        Insert: {
          captured_by?: string | null
          created_at?: string
          expiry_date?: string | null
          external_doctor_id?: string | null
          external_doctor_name?: string | null
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          notes?: string | null
          order_type?: string
          patient_id: string
          photo_url: string
          status?: string
          transcribed_prescription_id?: string | null
          updated_at?: string
        }
        Update: {
          captured_by?: string | null
          created_at?: string
          expiry_date?: string | null
          external_doctor_id?: string | null
          external_doctor_name?: string | null
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          notes?: string | null
          order_type?: string
          patient_id?: string
          photo_url?: string
          status?: string
          transcribed_prescription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "standing_orders_external_doctor_id_fkey"
            columns: ["external_doctor_id"]
            isOneToOne: false
            referencedRelation: "external_doctors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standing_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standing_orders_transcribed_prescription_id_fkey"
            columns: ["transcribed_prescription_id"]
            isOneToOne: false
            referencedRelation: "prescriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          movement_type: string
          notes: string | null
          quantity: number
          reference: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          movement_type: string
          notes?: string | null
          quantity: number
          reference?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          movement_type?: string
          notes?: string | null
          quantity?: number
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_requests: {
        Row: {
          created_at: string
          fulfilled_at: string | null
          id: string
          item_id: string | null
          item_name: string
          notes: string | null
          quantity: number
          requested_by: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fulfilled_at?: string | null
          id?: string
          item_id?: string | null
          item_name: string
          notes?: string | null
          quantity?: number
          requested_by?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fulfilled_at?: string | null
          id?: string
          item_id?: string | null
          item_name?: string
          notes?: string | null
          quantity?: number
          requested_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_requests_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vitals: {
        Row: {
          blood_pressure: string | null
          created_at: string
          height: number | null
          id: string
          notes: string | null
          patient_id: string
          pulse: number | null
          recorded_by: string | null
          respiratory_rate: number | null
          temperature: number | null
          updated_at: string
          weight: number | null
        }
        Insert: {
          blood_pressure?: string | null
          created_at?: string
          height?: number | null
          id?: string
          notes?: string | null
          patient_id: string
          pulse?: number | null
          recorded_by?: string | null
          respiratory_rate?: number | null
          temperature?: number | null
          updated_at?: string
          weight?: number | null
        }
        Update: {
          blood_pressure?: string | null
          created_at?: string
          height?: number | null
          id?: string
          notes?: string | null
          patient_id?: string
          pulse?: number | null
          recorded_by?: string | null
          respiratory_rate?: number | null
          temperature?: number | null
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vitals_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_patient_balance: {
        Args: {
          _delta: number
          _notes?: string
          _patient_id: string
          _payment_method?: string
          _related_invoice_id?: string
          _related_request_id?: string
          _transaction_type: string
        }
        Returns: number
      }
      generate_all_sponsor_statements: {
        Args: { _month: number; _year: number }
        Returns: number
      }
      generate_sponsor_statement: {
        Args: { _month: number; _sponsor_id: string; _year: number }
        Returns: string
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_authenticated_staff: { Args: never; Returns: boolean }
      next_statement_number: {
        Args: { _month: number; _year: number }
        Returns: string
      }
      write_audit_log: {
        Args: {
          _action: string
          _details: Json
          _resource_id: string
          _resource_type: string
          _status?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "doctor"
        | "nurse"
        | "receptionist"
        | "pharmacist"
        | "lab_tech"
        | "billing"
        | "store"
        | "accountant"
        | "doctor1"
        | "doctor2"
        | "claims_manager"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "doctor",
        "nurse",
        "receptionist",
        "pharmacist",
        "lab_tech",
        "billing",
        "store",
        "accountant",
        "doctor1",
        "doctor2",
        "claims_manager",
      ],
    },
  },
} as const
