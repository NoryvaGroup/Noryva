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
      agent_cron_auth: {
        Row: {
          created_at: string
          id: string
          label: string
          secret_sha256: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          secret_sha256: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          secret_sha256?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_definitions: {
        Row: {
          can_external_action: boolean
          config: Json
          created_at: string
          description: string
          enabled: boolean
          id: string
          key: string
          name: string
          requires_human_approval: boolean
          role: string
          updated_at: string
        }
        Insert: {
          can_external_action?: boolean
          config?: Json
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          key: string
          name: string
          requires_human_approval?: boolean
          role: string
          updated_at?: string
        }
        Update: {
          can_external_action?: boolean
          config?: Json
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          key?: string
          name?: string
          requires_human_approval?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_meeting_messages: {
        Row: {
          content: string
          created_at: string
          estimated_cost_sek: number
          id: string
          input_tokens: number
          ledger_id: string | null
          meeting_id: string
          message_type: string
          output_tokens: number
          provider_run_id: string
          reply_to_message_id: string | null
          role: string
          round: number
          sequence: number
          task_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          estimated_cost_sek?: number
          id?: string
          input_tokens?: number
          ledger_id?: string | null
          meeting_id: string
          message_type: string
          output_tokens?: number
          provider_run_id?: string
          reply_to_message_id?: string | null
          role: string
          round: number
          sequence: number
          task_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          estimated_cost_sek?: number
          id?: string
          input_tokens?: number
          ledger_id?: string | null
          meeting_id?: string
          message_type?: string
          output_tokens?: number
          provider_run_id?: string
          reply_to_message_id?: string | null
          role?: string
          round?: number
          sequence?: number
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_meeting_messages_ledger_id_fkey"
            columns: ["ledger_id"]
            isOneToOne: false
            referencedRelation: "agent_run_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_meeting_messages_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "agent_meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_meeting_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "agent_meeting_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_meeting_messages_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_meetings: {
        Row: {
          agenda: string
          alternatives: Json
          approval_status: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          current_round: number
          error: string
          estimated_cost_sek: number
          estimated_effort: string
          expected_effect: string
          final_summary: string
          id: string
          max_specialists: number
          meeting_type: string
          needs_cross_review: boolean | null
          processing_token: string | null
          recommendation: string
          risk_level: string
          selected_roles: string[]
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agenda: string
          alternatives?: Json
          approval_status?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          current_round?: number
          error?: string
          estimated_cost_sek?: number
          estimated_effort?: string
          expected_effect?: string
          final_summary?: string
          id?: string
          max_specialists?: number
          meeting_type: string
          needs_cross_review?: boolean | null
          processing_token?: string | null
          recommendation?: string
          risk_level?: string
          selected_roles?: string[]
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agenda?: string
          alternatives?: Json
          approval_status?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          current_round?: number
          error?: string
          estimated_cost_sek?: number
          estimated_effort?: string
          expected_effect?: string
          final_summary?: string
          id?: string
          max_specialists?: number
          meeting_type?: string
          needs_cross_review?: boolean | null
          processing_token?: string | null
          recommendation?: string
          risk_level?: string
          selected_roles?: string[]
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_run_ledger: {
        Row: {
          created_at: string
          estimated_cost_sek: number
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          role: string
          run_kind: string
          status: string
          task_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          estimated_cost_sek?: number
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          role: string
          run_kind: string
          status?: string
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          estimated_cost_sek?: number
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          role?: string
          run_kind?: string
          status?: string
          task_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_task_events: {
        Row: {
          actor: string
          actor_user_id: string | null
          created_at: string
          detail: Json
          event_type: string
          id: string
          task_id: string
        }
        Insert: {
          actor: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          task_id: string
        }
        Update: {
          actor?: string
          actor_user_id?: string | null
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tasks: {
        Row: {
          approval_status: string
          assigned_agent: string
          created_at: string
          customer_id: string | null
          execution_mode: string
          id: string
          idempotency_key: string
          instructions: string
          lead_id: string | null
          priority: string
          provider_agent_id: string
          provider_run_id: string
          provider_type: string
          requires_approval: boolean
          result: Json
          run_budget: number
          run_status: string
          runs_used: number
          source_event: string
          status: string
          task_type: string
          updated_at: string
          usage: Json
          verification_reasons: Json
          verification_status: string
        }
        Insert: {
          approval_status?: string
          assigned_agent: string
          created_at?: string
          customer_id?: string | null
          execution_mode?: string
          id?: string
          idempotency_key: string
          instructions?: string
          lead_id?: string | null
          priority?: string
          provider_agent_id?: string
          provider_run_id?: string
          provider_type?: string
          requires_approval?: boolean
          result?: Json
          run_budget?: number
          run_status?: string
          runs_used?: number
          source_event?: string
          status?: string
          task_type: string
          updated_at?: string
          usage?: Json
          verification_reasons?: Json
          verification_status?: string
        }
        Update: {
          approval_status?: string
          assigned_agent?: string
          created_at?: string
          customer_id?: string | null
          execution_mode?: string
          id?: string
          idempotency_key?: string
          instructions?: string
          lead_id?: string | null
          priority?: string
          provider_agent_id?: string
          provider_run_id?: string
          provider_type?: string
          requires_approval?: boolean
          result?: Json
          run_budget?: number
          run_status?: string
          runs_used?: number
          source_event?: string
          status?: string
          task_type?: string
          updated_at?: string
          usage?: Json
          verification_reasons?: Json
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tasks_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
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
      contact_requests: {
        Row: {
          created_at: string
          epost: string
          forbattra: string
          foretag: string
          hemsida: string | null
          id: string
          meddelande: string | null
          namn: string
          source_ip_hash: string
          telefon: string
        }
        Insert: {
          created_at?: string
          epost: string
          forbattra: string
          foretag: string
          hemsida?: string | null
          id?: string
          meddelande?: string | null
          namn: string
          source_ip_hash?: string
          telefon: string
        }
        Update: {
          created_at?: string
          epost?: string
          forbattra?: string
          foretag?: string
          hemsida?: string | null
          id?: string
          meddelande?: string | null
          namn?: string
          source_ip_hash?: string
          telefon?: string
        }
        Relationships: []
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
      customer_mail_channels: {
        Row: {
          connection_alias: string | null
          created_at: string
          customer_id: string
          inbound_route_key: string | null
          provider: string
          reply_to_email: string
          sender_email: string
          sender_name: string | null
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          connection_alias?: string | null
          created_at?: string
          customer_id: string
          inbound_route_key?: string | null
          provider?: string
          reply_to_email?: string
          sender_email?: string
          sender_name?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          connection_alias?: string | null
          created_at?: string
          customer_id?: string
          inbound_route_key?: string | null
          provider?: string
          reply_to_email?: string
          sender_email?: string
          sender_name?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_mail_channels_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
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
          local_postal_prefix: string
          notify_recipients: string[]
          qualification_profile: Json
          regional_postal_prefix: string
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
          local_postal_prefix?: string
          notify_recipients?: string[]
          qualification_profile?: Json
          regional_postal_prefix?: string
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
          local_postal_prefix?: string
          notify_recipients?: string[]
          qualification_profile?: Json
          regional_postal_prefix?: string
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
          launch_approved: boolean
          launch_approved_at: string | null
          launch_approved_by: string | null
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
          launch_approved?: boolean
          launch_approved_at?: string | null
          launch_approved_by?: string | null
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
          launch_approved?: boolean
          launch_approved_at?: string | null
          launch_approved_by?: string | null
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
      lead_reminder_deliveries: {
        Row: {
          attempt_id: string | null
          claimed_at: string | null
          created_at: string
          customer_id: string | null
          failed_at: string | null
          failure_reason: string
          id: string
          kind: string
          lead_id: string
          sent_at: string | null
          status: string
          transport_message_id: string | null
          updated_at: string
        }
        Insert: {
          attempt_id?: string | null
          claimed_at?: string | null
          created_at?: string
          customer_id?: string | null
          failed_at?: string | null
          failure_reason?: string
          id?: string
          kind?: string
          lead_id: string
          sent_at?: string | null
          status?: string
          transport_message_id?: string | null
          updated_at?: string
        }
        Update: {
          attempt_id?: string | null
          claimed_at?: string | null
          created_at?: string
          customer_id?: string | null
          failed_at?: string | null
          failure_reason?: string
          id?: string
          kind?: string
          lead_id?: string
          sent_at?: string | null
          status?: string
          transport_message_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_reminder_deliveries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_reminder_deliveries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          contacted_at: string | null
          created_at: string
          customer_id: string
          customer_status: string
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
          contacted_at?: string | null
          created_at?: string
          customer_id: string
          customer_status?: string
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
          contacted_at?: string | null
          created_at?: string
          customer_id?: string
          customer_status?: string
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
      nurture_inbound_events: {
        Row: {
          attempts: number
          created_at: string
          id: string
          lead_id: string
          result: Json
          review_id: string
          source_ref: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          lead_id: string
          result?: Json
          review_id: string
          source_ref: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          lead_id?: string
          result?: Json
          review_id?: string
          source_ref?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurture_inbound_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurture_inbound_events_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "nurture_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      nurture_reviews: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attempt_id: string | null
          blocked_reason: string
          body: string
          claimed_at: string | null
          company_name: string
          content_fingerprint: string
          conversation_id: string | null
          created_at: string
          customer_id: string
          due_at: string
          execution_mode: string
          failed_at: string | null
          failure_reason: string
          human_takeover: boolean
          id: string
          intent_level: string
          intent_score: number
          lead_id: string
          occurrence_key: string
          questions: Json
          reason: string
          recipient_email: string
          sent_at: string | null
          source_fingerprint: string
          source_revision: string
          status: string
          step_index: number
          subject: string
          transport_message_id: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attempt_id?: string | null
          blocked_reason?: string
          body?: string
          claimed_at?: string | null
          company_name?: string
          content_fingerprint: string
          conversation_id?: string | null
          created_at?: string
          customer_id: string
          due_at: string
          execution_mode?: string
          failed_at?: string | null
          failure_reason?: string
          human_takeover?: boolean
          id?: string
          intent_level?: string
          intent_score?: number
          lead_id: string
          occurrence_key: string
          questions?: Json
          reason?: string
          recipient_email?: string
          sent_at?: string | null
          source_fingerprint?: string
          source_revision?: string
          status?: string
          step_index?: number
          subject?: string
          transport_message_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attempt_id?: string | null
          blocked_reason?: string
          body?: string
          claimed_at?: string | null
          company_name?: string
          content_fingerprint?: string
          conversation_id?: string | null
          created_at?: string
          customer_id?: string
          due_at?: string
          execution_mode?: string
          failed_at?: string | null
          failure_reason?: string
          human_takeover?: boolean
          id?: string
          intent_level?: string
          intent_score?: number
          lead_id?: string
          occurrence_key?: string
          questions?: Json
          reason?: string
          recipient_email?: string
          sent_at?: string | null
          source_fingerprint?: string
          source_revision?: string
          status?: string
          step_index?: number
          subject?: string
          transport_message_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurture_reviews_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurture_reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurture_reviews_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
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
      agent_budget_snapshot: { Args: never; Returns: Json }
      approve_nurture_review: {
        Args: {
          p_fingerprint: string
          p_review_id: string
          p_source_revision: string
        }
        Returns: Json
      }
      cancel_nurture_review: {
        Args: { p_reason: string; p_review_id: string }
        Returns: Json
      }
      claim_agent_meeting_step: {
        Args: { p_expected_status: string; p_meeting_id: string }
        Returns: boolean
      }
      claim_agent_meeting_turn: {
        Args: { p_expected_status: string; p_meeting_id: string }
        Returns: string
      }
      claim_growth_analysis: {
        Args: { p_analysis_version: string; p_lead_id: string }
        Returns: string
      }
      claim_lead_delivery: {
        Args: { p_lead_id: string; p_stale_seconds?: number }
        Returns: string
      }
      claim_lead_reminder: {
        Args: {
          p_kind?: string
          p_lead_id: string
          p_older_than_hours?: number
          p_stale_claim_minutes?: number
        }
        Returns: Json
      }
      claim_nurture_review: {
        Args: { p_review_id: string; p_source_revision?: string }
        Returns: Json
      }
      complete_lead_reminder: {
        Args: {
          p_attempt_id: string
          p_reminder_id: string
          p_transport_message_id: string
        }
        Returns: Json
      }
      complete_nurture_review: {
        Args: {
          p_attempt_id: string
          p_review_id: string
          p_transport_message_id: string
        }
        Returns: Json
      }
      fail_lead_reminder: {
        Args: {
          p_attempt_id: string
          p_outcome: string
          p_reason: string
          p_reminder_id: string
        }
        Returns: Json
      }
      fail_nurture_review: {
        Args: {
          p_attempt_id: string
          p_outcome: string
          p_reason: string
          p_review_id: string
        }
        Returns: Json
      }
      finish_nurture_inbound: {
        Args: { p_ok: boolean; p_result: Json; p_source_ref: string }
        Returns: Json
      }
      get_public_landing: { Args: { p_slug: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      nurture_source_revision: {
        Args: { p_lead_id: string; p_lock?: boolean }
        Returns: Json
      }
      reconcile_nurture_review: {
        Args: {
          p_outcome: string
          p_reason?: string
          p_review_id: string
          p_transport_message_id?: string
        }
        Returns: Json
      }
      reserve_agent_run: {
        Args: {
          p_hard_cap_sek: number
          p_max_autonomous_runs_day: number
          p_max_autonomous_runs_month: number
          p_model?: string
          p_reserved_cost_sek: number
          p_role: string
          p_run_kind: string
          p_soft_cap_sek: number
          p_task_id: string
        }
        Returns: Json
      }
      reserve_nurture_inbound: {
        Args: { p_lead_id: string; p_review_id: string; p_source_ref: string }
        Returns: Json
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
