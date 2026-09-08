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
      ai_cost_events: {
        Row: {
          assumed: boolean
          created_at: string
          customer_id: string | null
          estimated_cost: number
          id: string
          input_tokens: number | null
          lead_id: string | null
          model: string | null
          output_tokens: number | null
          route: string
          tier: string
          variant_id: string | null
        }
        Insert: {
          assumed?: boolean
          created_at?: string
          customer_id?: string | null
          estimated_cost?: number
          id?: string
          input_tokens?: number | null
          lead_id?: string | null
          model?: string | null
          output_tokens?: number | null
          route?: string
          tier: string
          variant_id?: string | null
        }
        Update: {
          assumed?: boolean
          created_at?: string
          customer_id?: string | null
          estimated_cost?: number
          id?: string
          input_tokens?: number | null
          lead_id?: string | null
          model?: string | null
          output_tokens?: number | null
          route?: string
          tier?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_cost_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_cost_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_cost_events_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "growth_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_sales_assistant_runs: {
        Row: {
          action: string
          confidence: number
          contact_speed: string
          created_at: string
          customer_id: string
          email_draft: string
          followup_questions: Json
          human_takeover: boolean
          id: string
          lead_id: string
          model: string
          prompt_version: string
          review_status: string
          reviewer_notes: string
          safety_flags: Json
          strategy_reason: string
          subject: string
          updated_at: string
        }
        Insert: {
          action: string
          confidence?: number
          contact_speed: string
          created_at?: string
          customer_id: string
          email_draft?: string
          followup_questions?: Json
          human_takeover?: boolean
          id?: string
          lead_id: string
          model: string
          prompt_version: string
          review_status?: string
          reviewer_notes?: string
          safety_flags?: Json
          strategy_reason?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          action?: string
          confidence?: number
          contact_speed?: string
          created_at?: string
          customer_id?: string
          email_draft?: string
          followup_questions?: Json
          human_takeover?: boolean
          id?: string
          lead_id?: string
          model?: string
          prompt_version?: string
          review_status?: string
          reviewer_notes?: string
          safety_flags?: Json
          strategy_reason?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_sales_assistant_runs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sales_assistant_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_sales_events: {
        Row: {
          action_id: string | null
          actor: string
          actor_user_id: string | null
          created_at: string
          customer_id: string | null
          detail: Json
          event_type: string
          id: string
          lead_id: string | null
          run_id: string | null
        }
        Insert: {
          action_id?: string | null
          actor?: string
          actor_user_id?: string | null
          created_at?: string
          customer_id?: string | null
          detail?: Json
          event_type: string
          id?: string
          lead_id?: string | null
          run_id?: string | null
        }
        Update: {
          action_id?: string | null
          actor?: string
          actor_user_id?: string | null
          created_at?: string
          customer_id?: string | null
          detail?: Json
          event_type?: string
          id?: string
          lead_id?: string | null
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_sales_events_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "sales_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sales_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sales_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_sales_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_sales_assistant_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          action_id: string | null
          channel: string
          confidence: number
          conversation_id: string
          created_at: string
          customer_id: string
          direction: string
          escalate: boolean
          escalation_reason: string
          id: string
          intent: string
          lead_id: string
          received_at: string
          redacted_body: string
          source_ref: string
          suggested_action: string
        }
        Insert: {
          action_id?: string | null
          channel?: string
          confidence?: number
          conversation_id: string
          created_at?: string
          customer_id: string
          direction?: string
          escalate?: boolean
          escalation_reason?: string
          id?: string
          intent?: string
          lead_id: string
          received_at?: string
          redacted_body?: string
          source_ref?: string
          suggested_action?: string
        }
        Update: {
          action_id?: string | null
          channel?: string
          confidence?: number
          conversation_id?: string
          created_at?: string
          customer_id?: string
          direction?: string
          escalate?: boolean
          escalation_reason?: string
          id?: string
          intent?: string
          lead_id?: string
          received_at?: string
          redacted_body?: string
          source_ref?: string
          suggested_action?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "sales_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          customer_id: string
          human_owner: string | null
          id: string
          last_event_at: string
          lead_id: string
          stage: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          human_owner?: string | null
          id?: string
          last_event_at?: string
          lead_id: string
          stage?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          human_owner?: string | null
          id?: string
          last_event_at?: string
          lead_id?: string
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_profiles: {
        Row: {
          ai_assistant_enabled: boolean
          ai_daily_budget_usd: number
          ai_monthly_budget_usd: number
          booking_rules: Json
          created_at: string
          customer_id: string
          execution_mode: string
          followup_rules: Json
          language: string
          lead_prefix: string
          notify_recipients: string[]
          qualification_profile: Json
          tone: string
          updated_at: string
        }
        Insert: {
          ai_assistant_enabled?: boolean
          ai_daily_budget_usd?: number
          ai_monthly_budget_usd?: number
          booking_rules?: Json
          created_at?: string
          customer_id: string
          execution_mode?: string
          followup_rules?: Json
          language?: string
          lead_prefix?: string
          notify_recipients?: string[]
          qualification_profile?: Json
          tone?: string
          updated_at?: string
        }
        Update: {
          ai_assistant_enabled?: boolean
          ai_daily_budget_usd?: number
          ai_monthly_budget_usd?: number
          booking_rules?: Json
          created_at?: string
          customer_id?: string
          execution_mode?: string
          followup_rules?: Json
          language?: string
          lead_prefix?: string
          notify_recipients?: string[]
          qualification_profile?: Json
          tone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_profiles_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          contact_email: string
          contact_phone: string
          created_at: string
          cta_label: string
          delivery_webhook_url: string
          description: string
          headline: string
          id: string
          industry: string
          name: string
          recipient_email: string
          schema_version: number
          service_area: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          contact_email?: string
          contact_phone?: string
          created_at?: string
          cta_label?: string
          delivery_webhook_url?: string
          description?: string
          headline?: string
          id?: string
          industry: string
          name: string
          recipient_email?: string
          schema_version?: number
          service_area?: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          contact_email?: string
          contact_phone?: string
          created_at?: string
          cta_label?: string
          delivery_webhook_url?: string
          description?: string
          headline?: string
          id?: string
          industry?: string
          name?: string
          recipient_email?: string
          schema_version?: number
          service_area?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      form_questions: {
        Row: {
          created_at: string
          customer_id: string
          field_key: string
          field_type: string
          id: string
          label: string
          options: string[]
          required: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          field_key: string
          field_type?: string
          id?: string
          label: string
          options?: string[]
          required?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          field_key?: string
          field_type?: string
          id?: string
          label?: string
          options?: string[]
          required?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_questions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_analysis_claims: {
        Row: {
          analysis_version: string
          attempts: number
          created_at: string
          customer_id: string | null
          id: string
          lead_id: string
          result: Json
          run_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          analysis_version: string
          attempts?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          lead_id: string
          result?: Json
          run_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          analysis_version?: string
          attempts?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          lead_id?: string
          result?: Json
          run_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "growth_analysis_claims_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_analysis_claims_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_assignments: {
        Row: {
          assigned_at: string
          created_at: string
          customer_id: string
          experiment_id: string
          id: string
          lead_id: string
          variant_id: string
        }
        Insert: {
          assigned_at?: string
          created_at?: string
          customer_id: string
          experiment_id: string
          id?: string
          lead_id: string
          variant_id: string
        }
        Update: {
          assigned_at?: string
          created_at?: string
          customer_id?: string
          experiment_id?: string
          id?: string
          lead_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "growth_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_assignments_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "growth_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_assignments_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "growth_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_experiments: {
        Row: {
          created_at: string
          customer_id: string
          experiment_type: string
          exploration_floor: number
          id: string
          industry: string
          min_sample_size: number
          name: string
          notes: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          experiment_type: string
          exploration_floor?: number
          id?: string
          industry?: string
          min_sample_size?: number
          name: string
          notes?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          experiment_type?: string
          exploration_floor?: number
          id?: string
          industry?: string
          min_sample_size?: number
          name?: string
          notes?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "growth_experiments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_lead_state: {
        Row: {
          created_at: string
          customer_id: string
          intent_level: string
          intent_reason: string
          intent_score: number
          intent_terminal: boolean
          intent_updated_at: string
          lead_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          intent_level?: string
          intent_reason?: string
          intent_score?: number
          intent_terminal?: boolean
          intent_updated_at?: string
          lead_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          intent_level?: string
          intent_reason?: string
          intent_score?: number
          intent_terminal?: boolean
          intent_updated_at?: string
          lead_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "growth_lead_state_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_lead_state_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_nurture_state: {
        Row: {
          created_at: string
          customer_id: string
          execution_mode: string
          human_takeover: boolean
          intent_level: string
          last_reply_intent: string
          lead_id: string
          next_step_at: string | null
          questions: Json
          reason: string
          status: string
          steps_taken: number
          stopped_reason: string
          updated_at: string
          upgrade_signal: boolean
        }
        Insert: {
          created_at?: string
          customer_id: string
          execution_mode?: string
          human_takeover?: boolean
          intent_level?: string
          last_reply_intent?: string
          lead_id: string
          next_step_at?: string | null
          questions?: Json
          reason?: string
          status?: string
          steps_taken?: number
          stopped_reason?: string
          updated_at?: string
          upgrade_signal?: boolean
        }
        Update: {
          created_at?: string
          customer_id?: string
          execution_mode?: string
          human_takeover?: boolean
          intent_level?: string
          last_reply_intent?: string
          lead_id?: string
          next_step_at?: string | null
          questions?: Json
          reason?: string
          status?: string
          steps_taken?: number
          stopped_reason?: string
          updated_at?: string
          upgrade_signal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "growth_nurture_state_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_nurture_state_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_outcomes: {
        Row: {
          created_at: string
          customer_id: string
          experiment_id: string | null
          id: string
          idempotency_key: string
          lead_id: string
          outcome_type: string
          outcome_value: number | null
          revenue_value: number | null
          source: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          experiment_id?: string | null
          id?: string
          idempotency_key: string
          lead_id: string
          outcome_type: string
          outcome_value?: number | null
          revenue_value?: number | null
          source?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          experiment_id?: string | null
          id?: string
          idempotency_key?: string
          lead_id?: string
          outcome_type?: string
          outcome_value?: number | null
          revenue_value?: number | null
          source?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_outcomes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_outcomes_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "growth_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_outcomes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_outcomes_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "growth_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_recommendations: {
        Row: {
          allocations: Json
          confidence: number
          created_at: string
          customer_id: string
          experiment_id: string
          id: string
          metric: string
          needs_more_data: boolean
          reason: string
          winner_variant_id: string | null
        }
        Insert: {
          allocations?: Json
          confidence?: number
          created_at?: string
          customer_id: string
          experiment_id: string
          id?: string
          metric?: string
          needs_more_data?: boolean
          reason?: string
          winner_variant_id?: string | null
        }
        Update: {
          allocations?: Json
          confidence?: number
          created_at?: string
          customer_id?: string
          experiment_id?: string
          id?: string
          metric?: string
          needs_more_data?: boolean
          reason?: string
          winner_variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_recommendations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_recommendations_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "growth_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "growth_recommendations_winner_variant_id_fkey"
            columns: ["winner_variant_id"]
            isOneToOne: false
            referencedRelation: "growth_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_variants: {
        Row: {
          created_at: string
          experiment_id: string
          id: string
          instruction: string
          is_control: boolean
          name: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          experiment_id: string
          id?: string
          instruction?: string
          is_control?: boolean
          name: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          experiment_id?: string
          id?: string
          instruction?: string
          is_control?: boolean
          name?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "growth_variants_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "growth_experiments"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_webhook_events: {
        Row: {
          created_at: string
          external_id: string
          id: string
          payload_hash: string
          received_at: string
          signature_verified: boolean
          source: string
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: string
          payload_hash?: string
          received_at?: string
          signature_verified?: boolean
          source: string
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: string
          payload_hash?: string
          received_at?: string
          signature_verified?: boolean
          source?: string
        }
        Relationships: []
      }
      lead_outcomes: {
        Row: {
          channel: string
          created_at: string
          customer_id: string
          id: string
          lead_id: string
          note: string
          occurred_at: string
          score_band: string
          stage: string
        }
        Insert: {
          channel?: string
          created_at?: string
          customer_id: string
          id?: string
          lead_id: string
          note?: string
          occurred_at?: string
          score_band?: string
          stage: string
        }
        Update: {
          channel?: string
          created_at?: string
          customer_id?: string
          id?: string
          lead_id?: string
          note?: string
          occurred_at?: string
          score_band?: string
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_outcomes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_outcomes_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          customer_id: string
          delivered_at: string | null
          delivery_attempts: number
          delivery_error: string
          delivery_status: string
          id: string
          idempotency_key: string
          industry: string
          last_attempt_at: string | null
          payload: Json
          schema_version: number
          source_ip_hash: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          delivery_attempts?: number
          delivery_error?: string
          delivery_status?: string
          id?: string
          idempotency_key: string
          industry: string
          last_attempt_at?: string | null
          payload?: Json
          schema_version?: number
          source_ip_hash?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          delivery_attempts?: number
          delivery_error?: string
          delivery_status?: string
          id?: string
          idempotency_key?: string
          industry?: string
          last_attempt_at?: string | null
          payload?: Json
          schema_version?: number
          source_ip_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_actions: {
        Row: {
          action_type: string
          approved_at: string | null
          approved_by: string | null
          body: string
          created_at: string
          customer_id: string
          executed_at: string | null
          execution_mode: string
          execution_result: Json
          followup_questions: Json
          human_takeover: boolean
          id: string
          idempotency_key: string
          lead_id: string
          params: Json
          run_id: string | null
          scheduled_for: string | null
          status: string
          strategy_reason: string
          subject: string
          updated_at: string
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string
          customer_id: string
          executed_at?: string | null
          execution_mode?: string
          execution_result?: Json
          followup_questions?: Json
          human_takeover?: boolean
          id?: string
          idempotency_key: string
          lead_id: string
          params?: Json
          run_id?: string | null
          scheduled_for?: string | null
          status?: string
          strategy_reason?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          approved_by?: string | null
          body?: string
          created_at?: string
          customer_id?: string
          executed_at?: string | null
          execution_mode?: string
          execution_result?: Json
          followup_questions?: Json
          human_takeover?: boolean
          id?: string
          idempotency_key?: string
          lead_id?: string
          params?: Json
          run_id?: string | null
          scheduled_for?: string | null
          status?: string
          strategy_reason?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_actions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ai_sales_assistant_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_growth_analysis: {
        Args: { p_analysis_version: string; p_lead_id: string }
        Returns: string
      }
      claim_lead_delivery: {
        Args: { p_lead_id: string; p_stale_seconds?: number }
        Returns: string
      }
      get_public_landing: { Args: { p_slug: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin"],
    },
  },
} as const
