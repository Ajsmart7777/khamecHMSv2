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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      admissions: {
        Row: {
          admission_note: string | null
          admission_snap_path: string | null
          admitted_at: string | null
          admitting_doctor: string | null
          assigned_by_nurse: string | null
          bed_id: string | null
          created_at: string
          discharge_notes: string | null
          discharge_order_snap_id: string | null
          discharged_at: string | null
          discharged_by: string | null
          id: string
          patient_id: string
          ready_for_discharge_at: string | null
          ready_for_discharge_by: string | null
          reason: string | null
          status: string
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          admission_note?: string | null
          admission_snap_path?: string | null
          admitted_at?: string | null
          admitting_doctor?: string | null
          assigned_by_nurse?: string | null
          bed_id?: string | null
          created_at?: string
          discharge_notes?: string | null
          discharge_order_snap_id?: string | null
          discharged_at?: string | null
          discharged_by?: string | null
          id?: string
          patient_id: string
          ready_for_discharge_at?: string | null
          ready_for_discharge_by?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          admission_note?: string | null
          admission_snap_path?: string | null
          admitted_at?: string | null
          admitting_doctor?: string | null
          assigned_by_nurse?: string | null
          bed_id?: string | null
          created_at?: string
          discharge_notes?: string | null
          discharge_order_snap_id?: string | null
          discharged_at?: string | null
          discharged_by?: string | null
          id?: string
          patient_id?: string
          ready_for_discharge_at?: string | null
          ready_for_discharge_by?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admissions_bed_id_fkey"
            columns: ["bed_id"]
            isOneToOne: false
            referencedRelation: "beds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admissions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      anc_programs: {
        Row: {
          anc_number: string
          closed_at: string | null
          created_at: string
          created_by: string | null
          delivery_data: Json | null
          edd: string | null
          gravida: number | null
          height: number | null
          high_risk: boolean
          husband_occupation: string | null
          id: string
          lmp: string | null
          occupation: string | null
          para: number | null
          patient_id: string
          pelvic_assessment: string | null
          previous_pregnancies: Json | null
          registration_date: string
          religion: string | null
          remarks: string | null
          special_considerations: string | null
          status: string
          tribe: string | null
          updated_at: string
          weight: number | null
        }
        Insert: {
          anc_number: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          delivery_data?: Json | null
          edd?: string | null
          gravida?: number | null
          height?: number | null
          high_risk?: boolean
          husband_occupation?: string | null
          id?: string
          lmp?: string | null
          occupation?: string | null
          para?: number | null
          patient_id: string
          pelvic_assessment?: string | null
          previous_pregnancies?: Json | null
          registration_date?: string
          religion?: string | null
          remarks?: string | null
          special_considerations?: string | null
          status?: string
          tribe?: string | null
          updated_at?: string
          weight?: number | null
        }
        Update: {
          anc_number?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          delivery_data?: Json | null
          edd?: string | null
          gravida?: number | null
          height?: number | null
          high_risk?: boolean
          husband_occupation?: string | null
          id?: string
          lmp?: string | null
          occupation?: string | null
          para?: number | null
          patient_id?: string
          pelvic_assessment?: string | null
          previous_pregnancies?: Json | null
          registration_date?: string
          religion?: string | null
          remarks?: string | null
          special_considerations?: string | null
          status?: string
          tribe?: string | null
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "anc_programs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      anc_visits: {
        Row: {
          anc_program_id: string
          blood_pressure: string | null
          comment: string | null
          created_at: string
          fetal_heart_rate: string | null
          fundal_height: string | null
          hb: string | null
          id: string
          next_visit: string | null
          oedema: string | null
          presentation: string | null
          staff_id: string | null
          urine: string | null
          visit_date: string
          week_of_pregnancy: number | null
          weight: number | null
        }
        Insert: {
          anc_program_id: string
          blood_pressure?: string | null
          comment?: string | null
          created_at?: string
          fetal_heart_rate?: string | null
          fundal_height?: string | null
          hb?: string | null
          id?: string
          next_visit?: string | null
          oedema?: string | null
          presentation?: string | null
          staff_id?: string | null
          urine?: string | null
          visit_date?: string
          week_of_pregnancy?: number | null
          weight?: number | null
        }
        Update: {
          anc_program_id?: string
          blood_pressure?: string | null
          comment?: string | null
          created_at?: string
          fetal_heart_rate?: string | null
          fundal_height?: string | null
          hb?: string | null
          id?: string
          next_visit?: string | null
          oedema?: string | null
          presentation?: string | null
          staff_id?: string | null
          urine?: string | null
          visit_date?: string
          week_of_pregnancy?: number | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "anc_visits_anc_program_id_fkey"
            columns: ["anc_program_id"]
            isOneToOne: false
            referencedRelation: "anc_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_role: string | null
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
          actor_role?: string | null
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
          actor_role?: string | null
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
      beds: {
        Row: {
          active: boolean
          bed_label: string
          created_at: string
          id: string
          room_id: string
          status: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          bed_label: string
          created_at?: string
          id?: string
          room_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          bed_label?: string
          created_at?: string
          id?: string
          room_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "beds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
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
          contact_person: string | null
          created_at: string
          discount_percentage: number
          email: string | null
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
          contact_person?: string | null
          created_at?: string
          discount_percentage?: number
          email?: string | null
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
          contact_person?: string | null
          created_at?: string
          discount_percentage?: number
          email?: string | null
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
      corporate_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          id: string
          notes: string | null
          performed_by: string | null
          related_statement_id: string | null
          sponsor_id: string
          transaction_type: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          id?: string
          notes?: string | null
          performed_by?: string | null
          related_statement_id?: string | null
          sponsor_id: string
          transaction_type: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          id?: string
          notes?: string | null
          performed_by?: string | null
          related_statement_id?: string | null
          sponsor_id?: string
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_transactions_related_statement_id_fkey"
            columns: ["related_statement_id"]
            isOneToOne: false
            referencedRelation: "sponsor_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corporate_transactions_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      eligibility_verifications: {
        Row: {
          consumed_at: string | null
          consumed_patient_id: string | null
          created_at: string
          encounter_code: string | null
          encounter_code_captured_at: string | null
          enrollee_id: string | null
          id: string
          insurance_details: string | null
          member_id_data: Json | null
          notes: string | null
          patient_id: string | null
          plan: string | null
          prospective_patient_name: string | null
          prospective_patient_phone: string | null
          provider_id: string | null
          provider_name: string | null
          reception_snap_path: string | null
          rejection_reason: string | null
          requested_by: string | null
          sponsor_type: string
          status: string
          updated_at: string
          verification_snap_path: string | null
          verified_at: string | null
          verified_by: string | null
          verified_enrollee_id: string | null
          verified_plan: string | null
          verified_provider_name: string | null
        }
        Insert: {
          consumed_at?: string | null
          consumed_patient_id?: string | null
          created_at?: string
          encounter_code?: string | null
          encounter_code_captured_at?: string | null
          enrollee_id?: string | null
          id?: string
          insurance_details?: string | null
          member_id_data?: Json | null
          notes?: string | null
          patient_id?: string | null
          plan?: string | null
          prospective_patient_name?: string | null
          prospective_patient_phone?: string | null
          provider_id?: string | null
          provider_name?: string | null
          reception_snap_path?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          sponsor_type: string
          status?: string
          updated_at?: string
          verification_snap_path?: string | null
          verified_at?: string | null
          verified_by?: string | null
          verified_enrollee_id?: string | null
          verified_plan?: string | null
          verified_provider_name?: string | null
        }
        Update: {
          consumed_at?: string | null
          consumed_patient_id?: string | null
          created_at?: string
          encounter_code?: string | null
          encounter_code_captured_at?: string | null
          enrollee_id?: string | null
          id?: string
          insurance_details?: string | null
          member_id_data?: Json | null
          notes?: string | null
          patient_id?: string | null
          plan?: string | null
          prospective_patient_name?: string | null
          prospective_patient_phone?: string | null
          provider_id?: string | null
          provider_name?: string | null
          reception_snap_path?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          sponsor_type?: string
          status?: string
          updated_at?: string
          verification_snap_path?: string | null
          verified_at?: string | null
          verified_by?: string | null
          verified_enrollee_id?: string | null
          verified_plan?: string | null
          verified_provider_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eligibility_verifications_consumed_patient_id_fkey"
            columns: ["consumed_patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_verifications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_verifications_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "insurance_providers"
            referencedColumns: ["id"]
          },
        ]
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
          hmo_code: string | null
          id: string
          max_coverage_amount: number
          member_id_fields: Json
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
          hmo_code?: string | null
          id?: string
          max_coverage_amount?: number
          member_id_fields?: Json
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
          hmo_code?: string | null
          id?: string
          max_coverage_amount?: number
          member_id_fields?: Json
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
          claim_submission_notes: string | null
          claim_submitted_at: string | null
          claim_submitted_by: string | null
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
          visit_id: string | null
        }
        Insert: {
          claim_submission_notes?: string | null
          claim_submitted_at?: string | null
          claim_submitted_by?: string | null
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
          visit_id?: string | null
        }
        Update: {
          claim_submission_notes?: string | null
          claim_submitted_at?: string | null
          claim_submitted_by?: string | null
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
          visit_id?: string | null
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
          {
            foreignKeyName: "invoices_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
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
          visit_id: string | null
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
          visit_id?: string | null
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
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_requests_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_requests_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
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
      patient_journey: {
        Row: {
          created_at: string
          current_state: string
          department: string | null
          id: string
          location: string | null
          owner_role: string | null
          owner_user_id: string | null
          patient_id: string
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          created_at?: string
          current_state: string
          department?: string | null
          id?: string
          location?: string | null
          owner_role?: string | null
          owner_user_id?: string | null
          patient_id: string
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          created_at?: string
          current_state?: string
          department?: string | null
          id?: string
          location?: string | null
          owner_role?: string | null
          owner_user_id?: string | null
          patient_id?: string
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_journey_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_journey_history: {
        Row: {
          actor_user_id: string | null
          created_at: string
          department: string | null
          from_owner_role: string | null
          from_owner_user_id: string | null
          from_state: string | null
          id: string
          journey_id: string | null
          location: string | null
          patient_id: string
          reason: string | null
          to_owner_role: string | null
          to_owner_user_id: string | null
          to_state: string
          visit_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          department?: string | null
          from_owner_role?: string | null
          from_owner_user_id?: string | null
          from_state?: string | null
          id?: string
          journey_id?: string | null
          location?: string | null
          patient_id: string
          reason?: string | null
          to_owner_role?: string | null
          to_owner_user_id?: string | null
          to_state: string
          visit_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          department?: string | null
          from_owner_role?: string | null
          from_owner_user_id?: string | null
          from_state?: string | null
          id?: string
          journey_id?: string | null
          location?: string | null
          patient_id?: string
          reason?: string | null
          to_owner_role?: string | null
          to_owner_user_id?: string | null
          to_state?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_journey_history_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "patient_journey"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          account_type: string
          address: string
          allergies: string[] | null
          assigned_doctor: string | null
          balance: number
          blood_group: string | null
          card_number: string
          corporate_id: string | null
          created_at: string
          date_of_birth: string
          emergency_contact: string | null
          enrollee_id: string | null
          first_name: string
          gender: string
          id: string
          insurance_plan: string | null
          insurance_policy_number: string | null
          insurance_provider: string | null
          last_name: string | null
          last_visit: string | null
          member_id_data: Json | null
          mini_card_number: string
          occupation: string | null
          phone: string
          photo_path: string | null
          registered_at: string
          staff_link_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_type?: string
          address: string
          allergies?: string[] | null
          assigned_doctor?: string | null
          balance?: number
          blood_group?: string | null
          card_number: string
          corporate_id?: string | null
          created_at?: string
          date_of_birth: string
          emergency_contact?: string | null
          enrollee_id?: string | null
          first_name: string
          gender: string
          id?: string
          insurance_plan?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
          last_name?: string | null
          last_visit?: string | null
          member_id_data?: Json | null
          mini_card_number: string
          occupation?: string | null
          phone: string
          photo_path?: string | null
          registered_at?: string
          staff_link_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_type?: string
          address?: string
          allergies?: string[] | null
          assigned_doctor?: string | null
          balance?: number
          blood_group?: string | null
          card_number?: string
          corporate_id?: string | null
          created_at?: string
          date_of_birth?: string
          emergency_contact?: string | null
          enrollee_id?: string | null
          first_name?: string
          gender?: string
          id?: string
          insurance_plan?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
          last_name?: string | null
          last_visit?: string | null
          member_id_data?: Json | null
          mini_card_number?: string
          occupation?: string | null
          phone?: string
          photo_path?: string | null
          registered_at?: string
          staff_link_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
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
          visit_id: string | null
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
          visit_id?: string | null
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
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      pricelist: {
        Row: {
          active: boolean
          category: string
          created_at: string
          id: string
          name: string
          notes: string | null
          pack_qty: number
          price: number
          search_text: string | null
          size: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          pack_qty?: number
          price: number
          search_text?: string | null
          size?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          pack_qty?: number
          price?: number
          search_text?: string | null
          size?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          active: boolean
          created_at: string
          daily_rate: number
          id: string
          room_class: string
          room_number: string
          updated_at: string
          ward_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          daily_rate?: number
          id?: string
          room_class?: string
          room_number: string
          updated_at?: string
          ward_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          daily_rate?: number
          id?: string
          room_class?: string
          room_number?: string
          updated_at?: string
          ward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_ward_id_fkey"
            columns: ["ward_id"]
            isOneToOne: false
            referencedRelation: "wards"
            referencedColumns: ["id"]
          },
        ]
      }
      snap_orders: {
        Row: {
          ack_at: string | null
          ack_by: string | null
          billed_at: string | null
          billed_by: string | null
          created_at: string
          created_by: string | null
          debt_amount: number
          debt_reason: string | null
          fulfilled_at: string | null
          fulfilled_by: string | null
          id: string
          intent: string | null
          invoice_id: string | null
          is_admitted_snap: boolean
          matched_items: Json
          note: string | null
          ocr_confidence: number | null
          ocr_corrected_at: string | null
          ocr_corrected_by: string | null
          ocr_corrected_text: string | null
          ocr_error: string | null
          ocr_matches: Json | null
          ocr_model: string | null
          ocr_reviewed_at: string | null
          ocr_reviewed_by: string | null
          ocr_reviewed_lines: Json | null
          ocr_status: string | null
          ocr_text: string | null
          order_type: string
          original_sender_role: string | null
          paid_at: string | null
          parent_snap_id: string | null
          patient_id: string
          photo_path: string
          rejection_reason: string | null
          returned_at: string | null
          returned_to: string | null
          source_role: string
          status: string
          target_station: string
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          ack_at?: string | null
          ack_by?: string | null
          billed_at?: string | null
          billed_by?: string | null
          created_at?: string
          created_by?: string | null
          debt_amount?: number
          debt_reason?: string | null
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          intent?: string | null
          invoice_id?: string | null
          is_admitted_snap?: boolean
          matched_items?: Json
          note?: string | null
          ocr_confidence?: number | null
          ocr_corrected_at?: string | null
          ocr_corrected_by?: string | null
          ocr_corrected_text?: string | null
          ocr_error?: string | null
          ocr_matches?: Json | null
          ocr_model?: string | null
          ocr_reviewed_at?: string | null
          ocr_reviewed_by?: string | null
          ocr_reviewed_lines?: Json | null
          ocr_status?: string | null
          ocr_text?: string | null
          order_type: string
          original_sender_role?: string | null
          paid_at?: string | null
          parent_snap_id?: string | null
          patient_id: string
          photo_path: string
          rejection_reason?: string | null
          returned_at?: string | null
          returned_to?: string | null
          source_role: string
          status?: string
          target_station: string
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          ack_at?: string | null
          ack_by?: string | null
          billed_at?: string | null
          billed_by?: string | null
          created_at?: string
          created_by?: string | null
          debt_amount?: number
          debt_reason?: string | null
          fulfilled_at?: string | null
          fulfilled_by?: string | null
          id?: string
          intent?: string | null
          invoice_id?: string | null
          is_admitted_snap?: boolean
          matched_items?: Json
          note?: string | null
          ocr_confidence?: number | null
          ocr_corrected_at?: string | null
          ocr_corrected_by?: string | null
          ocr_corrected_text?: string | null
          ocr_error?: string | null
          ocr_matches?: Json | null
          ocr_model?: string | null
          ocr_reviewed_at?: string | null
          ocr_reviewed_by?: string | null
          ocr_reviewed_lines?: Json | null
          ocr_status?: string | null
          ocr_text?: string | null
          order_type?: string
          original_sender_role?: string | null
          paid_at?: string | null
          parent_snap_id?: string | null
          patient_id?: string
          photo_path?: string
          rejection_reason?: string | null
          returned_at?: string | null
          returned_to?: string | null
          source_role?: string
          status?: string
          target_station?: string
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "snap_orders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snap_orders_parent_snap_id_fkey"
            columns: ["parent_snap_id"]
            isOneToOne: false
            referencedRelation: "snap_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snap_orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snap_orders_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
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
          staff_id?: string
          status?: string
        }
        Relationships: [
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
          visit_id: string | null
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
          visit_id?: string | null
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
          visit_id?: string | null
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
          {
            foreignKeyName: "standing_orders_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
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
      task_claims: {
        Row: {
          claimed_at: string
          claimed_by: string
          created_at: string
          id: string
          notes: string | null
          released_at: string | null
          source: string
          source_id: string
          updated_at: string
        }
        Insert: {
          claimed_at?: string
          claimed_by: string
          created_at?: string
          id?: string
          notes?: string | null
          released_at?: string | null
          source: string
          source_id: string
          updated_at?: string
        }
        Update: {
          claimed_at?: string
          claimed_by?: string
          created_at?: string
          id?: string
          notes?: string | null
          released_at?: string | null
          source?: string
          source_id?: string
          updated_at?: string
        }
        Relationships: []
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
      visit_attachments: {
        Row: {
          captured_at: string
          captured_by: string | null
          created_at: string
          id: string
          label: string | null
          mime_type: string | null
          patient_id: string
          size_bytes: number | null
          station: Database["public"]["Enums"]["visit_station"]
          storage_path: string
          visit_id: string
        }
        Insert: {
          captured_at?: string
          captured_by?: string | null
          created_at?: string
          id?: string
          label?: string | null
          mime_type?: string | null
          patient_id: string
          size_bytes?: number | null
          station: Database["public"]["Enums"]["visit_station"]
          storage_path: string
          visit_id: string
        }
        Update: {
          captured_at?: string
          captured_by?: string | null
          created_at?: string
          id?: string
          label?: string | null
          mime_type?: string | null
          patient_id?: string
          size_bytes?: number | null
          station?: Database["public"]["Enums"]["visit_station"]
          storage_path?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_attachments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_attachments_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      visits: {
        Row: {
          cancel_reason: string | null
          claim_last_action_at: string | null
          claim_last_action_by: string | null
          claim_notes: string | null
          claim_reason_code: string | null
          claim_reason_details: Json
          claim_settled_at: string | null
          claim_settled_by: string | null
          claim_status: string
          closed_at: string | null
          closed_by: string | null
          corporate_id: string | null
          created_at: string
          force_new_reason: string | null
          id: string
          insurance_plan: string | null
          opened_at: string
          opened_by: string | null
          patient_id: string
          presenting_complaint: string | null
          sponsor_auth: Json
          sponsor_auth_captured_at: string | null
          sponsor_type: string | null
          status: Database["public"]["Enums"]["visit_status"]
          total_charged: number
          total_paid: number
          updated_at: string
          visit_number: string
        }
        Insert: {
          cancel_reason?: string | null
          claim_last_action_at?: string | null
          claim_last_action_by?: string | null
          claim_notes?: string | null
          claim_reason_code?: string | null
          claim_reason_details?: Json
          claim_settled_at?: string | null
          claim_settled_by?: string | null
          claim_status?: string
          closed_at?: string | null
          closed_by?: string | null
          corporate_id?: string | null
          created_at?: string
          force_new_reason?: string | null
          id?: string
          insurance_plan?: string | null
          opened_at?: string
          opened_by?: string | null
          patient_id: string
          presenting_complaint?: string | null
          sponsor_auth?: Json
          sponsor_auth_captured_at?: string | null
          sponsor_type?: string | null
          status?: Database["public"]["Enums"]["visit_status"]
          total_charged?: number
          total_paid?: number
          updated_at?: string
          visit_number: string
        }
        Update: {
          cancel_reason?: string | null
          claim_last_action_at?: string | null
          claim_last_action_by?: string | null
          claim_notes?: string | null
          claim_reason_code?: string | null
          claim_reason_details?: Json
          claim_settled_at?: string | null
          claim_settled_by?: string | null
          claim_status?: string
          closed_at?: string | null
          closed_by?: string | null
          corporate_id?: string | null
          created_at?: string
          force_new_reason?: string | null
          id?: string
          insurance_plan?: string | null
          opened_at?: string
          opened_by?: string | null
          patient_id?: string
          presenting_complaint?: string | null
          sponsor_auth?: Json
          sponsor_auth_captured_at?: string | null
          sponsor_type?: string | null
          status?: Database["public"]["Enums"]["visit_status"]
          total_charged?: number
          total_paid?: number
          updated_at?: string
          visit_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "visits_corporate_id_fkey"
            columns: ["corporate_id"]
            isOneToOne: false
            referencedRelation: "corporate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
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
          visit_id: string | null
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
          visit_id?: string | null
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
          visit_id?: string | null
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
          {
            foreignKeyName: "vitals_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      wards: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          gender: string
          id: string
          min_admission_deposit: number
          name: string
          updated_at: string
          ward_type: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          gender?: string
          id?: string
          min_admission_deposit?: number
          name: string
          updated_at?: string
          ward_type?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          gender?: string
          id?: string
          min_admission_deposit?: number
          name?: string
          updated_at?: string
          ward_type?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_tasks: {
        Row: {
          assigned_role: string | null
          assigned_user_id: string | null
          created_at: string | null
          patient_id: string | null
          payload: Json | null
          priority: number | null
          source: string | null
          source_id: string | null
          status: string | null
          task_id: string | null
          updated_at: string | null
          visit_id: string | null
        }
        Relationships: []
      }
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
      admission_bed_charge: {
        Args: { _admission_id: string }
        Returns: {
          amount: number
          daily_rate: number
          days: number
        }[]
      }
      advance_journey: {
        Args: {
          _department?: string
          _location?: string
          _owner_role?: string
          _owner_user_id?: string
          _patient_id: string
          _reason?: string
          _to_state: string
          _visit_id?: string
        }
        Returns: string
      }
      assign_admission_bed: {
        Args: { _admission_id: string; _bed_id: string }
        Returns: undefined
      }
      bill_admission_bed_days: {
        Args: { _admission_id: string }
        Returns: string
      }
      can_add_snap_for_patient: {
        Args: { _patient_id: string; _user_id: string }
        Returns: boolean
      }
      claim_task: {
        Args: { _notes?: string; _source: string; _source_id: string }
        Returns: string
      }
      close_retainer_month: {
        Args: {
          _month: number
          _notes?: string
          _sponsor_id: string
          _year: number
        }
        Returns: Json
      }
      close_visit: { Args: { _visit_id: string }; Returns: undefined }
      copay_percent: {
        Args: { _account_type: string; _plan?: string }
        Returns: number
      }
      create_admitted_snap: {
        Args: {
          _allow_debt?: boolean
          _debt_reason?: string
          _items: Json
          _note: string
          _order_type: string
          _patient_id: string
          _photo_path: string
          _target_station: string
          _total: number
        }
        Returns: string
      }
      create_lab_request_from_snap: {
        Args: { _diagnosis?: string; _snap_id: string; _tests: string[] }
        Returns: string
      }
      create_prescription_from_snap: {
        Args: {
          _diagnosis?: string
          _items?: Json
          _notes?: string
          _snap_id: string
        }
        Returns: string
      }
      current_actor_role: { Args: { _user_id: string }; Returns: string }
      discharge_admission: {
        Args: {
          _admission_id: string
          _notes?: string
          _settlement_amount?: number
          _settlement_method?: string
          _settlement_notes?: string
        }
        Returns: undefined
      }
      discharge_patient: {
        Args: { _patient_id: string; _reason?: string }
        Returns: Json
      }
      forward_snap_to_billing: {
        Args: {
          _note?: string
          _source_snap_id: string
          _target_station: string
        }
        Returns: string
      }
      generate_all_sponsor_statements: {
        Args: { _month: number; _year: number }
        Returns: number
      }
      generate_anc_number: { Args: never; Returns: string }
      generate_sponsor_statement: {
        Args: { _month: number; _sponsor_id: string; _year: number }
        Returns: string
      }
      get_visit_audit_trail: {
        Args: { _visit_id: string }
        Returns: {
          action: string
          created_at: string
          details: Json
          id: string
          resource_id: string
          resource_type: string
          status: string
          user_id: string
        }[]
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
      mark_claim_rejected: {
        Args: { _notes?: string; _reason_code: string; _visit_id: string }
        Returns: undefined
      }
      mark_claim_settled: {
        Args: { _notes?: string; _visit_id: string }
        Returns: undefined
      }
      mark_invoice_claim_submitted: {
        Args: { _invoice_id: string; _notes?: string }
        Returns: undefined
      }
      mark_ready_for_discharge: {
        Args: { _admission_id: string; _note?: string; _snap_id?: string }
        Returns: undefined
      }
      match_catalogue: {
        Args: { _limit?: number; _query: string }
        Returns: {
          id: string
          name: string
          price: number
          score: number
          source: string
        }[]
      }
      next_statement_number: {
        Args: { _month: number; _year: number }
        Returns: string
      }
      next_visit_number: { Args: never; Returns: string }
      open_visit_for_patient: {
        Args: {
          _force_new?: boolean
          _force_new_reason?: string
          _patient_id: string
          _presenting_complaint?: string
        }
        Returns: string
      }
      patient_pending_workflow_station: {
        Args: { _patient_id: string }
        Returns: string
      }
      purge_clinical_data: { Args: { _modules: string[] }; Returns: Json }
      recalc_visit_totals: { Args: { _visit_id: string }; Returns: undefined }
      reconcile_paid_snap_orders: { Args: never; Returns: Json }
      release_task: {
        Args: { _notes?: string; _source: string; _source_id: string }
        Returns: boolean
      }
      reopen_claim: {
        Args: { _reason: string; _visit_id: string }
        Returns: undefined
      }
      request_admission: {
        Args: {
          _note?: string
          _patient_id: string
          _photo_path?: string
          _reason?: string
          _visit_id?: string
        }
        Returns: string
      }
      request_claim_info: {
        Args: { _notes?: string; _reason_code: string; _visit_id: string }
        Returns: undefined
      }
      reset_patient_history: { Args: never; Returns: undefined }
      retainer_deposit: {
        Args: { _amount: number; _notes?: string; _sponsor_id: string }
        Returns: number
      }
      settle_invoice_atomic: {
        Args: {
          _balance_amount?: number
          _cash_amount?: number
          _debt_amount?: number
          _invoice_id: string
          _notes?: string
          _payment_method?: string
          _sponsored?: boolean
        }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      simple_id: { Args: { _n: number; _prefix: string }; Returns: string }
      unmark_invoice_claim_submitted: {
        Args: { _invoice_id: string }
        Returns: undefined
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
        | "anc"
        | "cashier"
      visit_station:
        | "reception"
        | "nurse"
        | "doctor"
        | "lab"
        | "pharmacy"
        | "billing"
        | "cashier"
        | "other"
      visit_status: "open" | "settled" | "cancelled"
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
        "anc",
        "cashier",
      ],
      visit_station: [
        "reception",
        "nurse",
        "doctor",
        "lab",
        "pharmacy",
        "billing",
        "cashier",
        "other",
      ],
      visit_status: ["open", "settled", "cancelled"],
    },
  },
} as const
