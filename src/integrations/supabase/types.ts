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
      customer_profiles: {
        Row: {
          ai_assistant_enabled: boolean
          booking_rules: Json
          created_at: string
          customer_id: string
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
          booking_rules?: Json
          created_at?: string
          customer_id: string
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
          booking_rules?: Json
          created_at?: string
          customer_id?: string
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
