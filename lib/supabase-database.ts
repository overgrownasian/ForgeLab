export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      alchemy_combinations: {
        Row: {
          pair_key: string;
          first_element: string;
          second_element: string;
          element: string;
          emoji: string;
          flavor_text: string | null;
          source: string;
          model: string | null;
          created_at: string;
        };
        Insert: {
          pair_key: string;
          first_element: string;
          second_element: string;
          element: string;
          emoji: string;
          flavor_text?: string | null;
          source?: string;
          model?: string | null;
          created_at?: string;
        };
        Update: {
          pair_key?: string;
          first_element?: string;
          second_element?: string;
          element?: string;
          emoji?: string;
          flavor_text?: string | null;
          source?: string;
          model?: string | null;
          created_at?: string;
        };
      };
      player_states: {
        Row: {
          user_id: string;
          discovered_elements: Json;
          display_name: string | null;
          theme: string;
          revealed_recipe_results: Json;
          achievements: Json;
          world_first_discovery_count: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          discovered_elements?: Json;
          display_name?: string | null;
          theme?: string;
          revealed_recipe_results?: Json;
          achievements?: Json;
          world_first_discovery_count?: number;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          discovered_elements?: Json;
          display_name?: string | null;
          theme?: string;
          revealed_recipe_results?: Json;
          achievements?: Json;
          world_first_discovery_count?: number;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
