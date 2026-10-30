export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      brand_preferences: {
        Row: {
          household_id: string;
          id: string;
          item_id: string;
          preferred_brand: string;
          store_id: string;
          updated_at: string;
        };
        Insert: {
          household_id: string;
          id?: string;
          item_id: string;
          preferred_brand: string;
          store_id: string;
          updated_at?: string;
        };
        Update: {
          household_id?: string;
          id?: string;
          item_id?: string;
          preferred_brand?: string;
          store_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'brand_preferences_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'brand_preferences_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'brand_preferences_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      config: {
        Row: {
          key: string;
          value: string;
        };
        Insert: {
          key: string;
          value: string;
        };
        Update: {
          key?: string;
          value?: string;
        };
        Relationships: [];
      };
      disambiguation_log: {
        Row: {
          candidate_item_id: string | null;
          chosen_item_id: string | null;
          confidence_score: number | null;
          created_at: string;
          decision_type: string;
          household_id: string;
          id: string;
          store_id: string | null;
          utterance: string;
        };
        Insert: {
          candidate_item_id?: string | null;
          chosen_item_id?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          decision_type: string;
          household_id: string;
          id?: string;
          store_id?: string | null;
          utterance: string;
        };
        Update: {
          candidate_item_id?: string | null;
          chosen_item_id?: string | null;
          confidence_score?: number | null;
          created_at?: string;
          decision_type?: string;
          household_id?: string;
          id?: string;
          store_id?: string | null;
          utterance?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'disambiguation_log_candidate_item_id_fkey';
            columns: ['candidate_item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disambiguation_log_chosen_item_id_fkey';
            columns: ['chosen_item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disambiguation_log_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'disambiguation_log_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      household_audit_events: {
        Row: {
          actor_user_id: string | null;
          created_at: string;
          event_type: string;
          household_id: string;
          id: string;
          invite_id: string | null;
          new_name: string | null;
          old_name: string | null;
          target_user_id: string | null;
        };
        Insert: {
          actor_user_id?: string | null;
          created_at?: string;
          event_type: string;
          household_id: string;
          id?: string;
          invite_id?: string | null;
          new_name?: string | null;
          old_name?: string | null;
          target_user_id?: string | null;
        };
        Update: {
          actor_user_id?: string | null;
          created_at?: string;
          event_type?: string;
          household_id?: string;
          id?: string;
          invite_id?: string | null;
          new_name?: string | null;
          old_name?: string | null;
          target_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'household_audit_events_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_audit_events_invite_id_fkey';
            columns: ['invite_id'];
            isOneToOne: false;
            referencedRelation: 'household_invitations';
            referencedColumns: ['id'];
          },
        ];
      };
      household_invitations: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string;
          household_id: string;
          id: string;
          token: string;
          used_at: string | null;
          used_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          household_id: string;
          id?: string;
          token: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          household_id?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'household_invitations_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      household_members: {
        Row: {
          household_id: string;
          joined_at: string;
          role: string;
          user_id: string;
        };
        Insert: {
          household_id: string;
          joined_at?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          household_id?: string;
          joined_at?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'household_members_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
      household_stores: {
        Row: {
          added_at: string;
          added_by: string | null;
          household_id: string;
          store_id: string;
        };
        Insert: {
          added_at?: string;
          added_by?: string | null;
          household_id: string;
          store_id: string;
        };
        Update: {
          added_at?: string;
          added_by?: string | null;
          household_id?: string;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'household_stores_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'household_stores_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      households: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      items: {
        Row: {
          category: string | null;
          created_at: string;
          id: string;
          name_canonical: string;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          id?: string;
          name_canonical: string;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          id?: string;
          name_canonical?: string;
        };
        Relationships: [];
      };
      list_entries: {
        Row: {
          added_at: string;
          added_by: string | null;
          brand: string | null;
          household_id: string;
          id: string;
          item_id: string;
          quantity: number;
          status: string;
          store_id: string;
          unit: string | null;
        };
        Insert: {
          added_at?: string;
          added_by?: string | null;
          brand?: string | null;
          household_id: string;
          id?: string;
          item_id: string;
          quantity?: number;
          status?: string;
          store_id: string;
          unit?: string | null;
        };
        Update: {
          added_at?: string;
          added_by?: string | null;
          brand?: string | null;
          household_id?: string;
          id?: string;
          item_id?: string;
          quantity?: number;
          status?: string;
          store_id?: string;
          unit?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'list_entries_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'list_entries_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'list_entries_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      purchase_history: {
        Row: {
          added_by: string | null;
          bought_at: string;
          brand: string | null;
          household_id: string;
          id: string;
          item_id: string;
          store_id: string;
        };
        Insert: {
          added_by?: string | null;
          bought_at?: string;
          brand?: string | null;
          household_id: string;
          id?: string;
          item_id: string;
          store_id: string;
        };
        Update: {
          added_by?: string | null;
          bought_at?: string;
          brand?: string | null;
          household_id?: string;
          id?: string;
          item_id?: string;
          store_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'purchase_history_household_id_fkey';
            columns: ['household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'purchase_history_item_id_fkey';
            columns: ['item_id'];
            isOneToOne: false;
            referencedRelation: 'items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'purchase_history_store_id_fkey';
            columns: ['store_id'];
            isOneToOne: false;
            referencedRelation: 'stores';
            referencedColumns: ['id'];
          },
        ];
      };
      stores: {
        Row: {
          created_at: string;
          created_by_household_id: string | null;
          id: string;
          is_global: boolean;
          name: string;
          online_cart_supported: boolean;
        };
        Insert: {
          created_at?: string;
          created_by_household_id?: string | null;
          id?: string;
          is_global?: boolean;
          name: string;
          online_cart_supported?: boolean;
        };
        Update: {
          created_at?: string;
          created_by_household_id?: string | null;
          id?: string;
          is_global?: boolean;
          name?: string;
          online_cart_supported?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'stores_created_by_household_id_fkey';
            columns: ['created_by_household_id'];
            isOneToOne: false;
            referencedRelation: 'households';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string };
      add_household_store: {
        Args: { p_name?: string; p_store_id?: string };
        Returns: {
          store_id: string;
          was_created: boolean;
        }[];
      };
      create_household_with_owner: {
        Args: { p_name: string };
        Returns: string;
      };
      create_invite: { Args: never; Returns: string };
      current_household_id: { Args: never; Returns: string };
      daitch_mokotoff: { Args: { '': string }; Returns: string[] };
      dmetaphone: { Args: { '': string }; Returns: string };
      dmetaphone_alt: { Args: { '': string }; Returns: string };
      find_item_alternatives: {
        Args: { p_limit?: number; p_query: string };
        Returns: {
          id: string;
          name_canonical: string;
          similarity: number;
        }[];
      };
      find_item_by_trgm: {
        Args: { p_query: string; p_threshold?: number };
        Returns: {
          id: string;
          name_canonical: string;
          similarity: number;
        }[];
      };
      is_household_owner: {
        Args: { p_household_id: string };
        Returns: boolean;
      };
      leave_household: { Args: never; Returns: undefined };
      mark_item_bought: { Args: { p_entry_id: string }; Returns: undefined };
      my_household_ids: { Args: never; Returns: string[] };
      remove_household_store: {
        Args: { p_store_id: string };
        Returns: undefined;
      };
      remove_member: { Args: { p_user_id: string }; Returns: undefined };
      rename_household: { Args: { p_new_name: string }; Returns: undefined };
      revoke_invite: { Args: { p_invite_id: string }; Returns: undefined };
      route_item_to_store: {
        Args: { p_household_id: string; p_item_id: string };
        Returns: {
          purchase_count: number;
          store_id: string;
          store_name: string;
          weighted_share: number;
        }[];
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { '': string }; Returns: string[] };
      soundex: { Args: { '': string }; Returns: string };
      text_soundex: { Args: { '': string }; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
