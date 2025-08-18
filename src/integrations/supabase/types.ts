export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      customer_contacts: {
        Row: {
          created_at: string | null
          customer_id: string
          email: string
          id: string
          is_primary: boolean | null
          name: string
          phone: string | null
          role: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          email: string
          id?: string
          is_primary?: boolean | null
          name: string
          phone?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          email?: string
          id?: string
          is_primary?: boolean | null
          name?: string
          phone?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          city: string | null
          company_name: string
          contact_name: string
          country: string | null
          created_at: string | null
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          position: string | null
          status: string
          street_address: string | null
          updated_at: string | null
          vat_tax_id: string | null
          zip_code: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name: string
          contact_name: string
          country?: string | null
          created_at?: string | null
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          position?: string | null
          status?: string
          street_address?: string | null
          updated_at?: string | null
          vat_tax_id?: string | null
          zip_code?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string
          contact_name?: string
          country?: string | null
          created_at?: string | null
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          position?: string | null
          status?: string
          street_address?: string | null
          updated_at?: string | null
          vat_tax_id?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      order_items: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          sku: string | null
          total_price: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sku?: string | null
          total_price?: number
          unit_price?: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sku?: string | null
          total_price?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          currency: string | null
          customer_id: string
          delivery_date: string | null
          id: string
          partner_id: string | null
          rfq_id: string | null
          start_date: string | null
          status: string
          title: string
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          customer_id: string
          delivery_date?: string | null
          id?: string
          partner_id?: string | null
          rfq_id?: string | null
          start_date?: string | null
          status?: string
          title: string
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          customer_id?: string
          delivery_date?: string | null
          id?: string
          partner_id?: string | null
          rfq_id?: string | null
          start_date?: string | null
          status?: string
          title?: string
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_ratings: {
        Row: {
          comment: string
          created_at: string | null
          id: string
          partner_id: string
          score: number
        }
        Insert: {
          comment: string
          created_at?: string | null
          id?: string
          partner_id: string
          score: number
        }
        Update: {
          comment?: string
          created_at?: string | null
          id?: string
          partner_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "partner_ratings_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "production_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      production_partners: {
        Row: {
          active: boolean | null
          company_name: string
          contact_name: string
          country: string | null
          created_at: string | null
          email: string
          id: string
          phone: string | null
          specializations: string[] | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          company_name: string
          contact_name: string
          country?: string | null
          created_at?: string | null
          email: string
          id?: string
          phone?: string | null
          specializations?: string[] | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          company_name?: string
          contact_name?: string
          country?: string | null
          created_at?: string | null
          email?: string
          id?: string
          phone?: string | null
          specializations?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          min_stock_level: number
          name: string
          sku: string | null
          status: string
          stock_quantity: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          min_stock_level?: number
          name: string
          sku?: string | null
          status?: string
          stock_quantity?: number
          unit_price?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          min_stock_level?: number
          name?: string
          sku?: string | null
          status?: string
          stock_quantity?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      quote_files: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          part_id: string | null
          quote_request_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id?: string
          part_id?: string | null
          quote_request_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          part_id?: string | null
          quote_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_files_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "quote_request_parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_files_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_request_parts: {
        Row: {
          comments: string | null
          created_at: string
          id: string
          manufacturing_processes: string[]
          material: string
          material_other: string | null
          name: string
          quantity: number
          quote_request_id: string
          tolerance: string | null
        }
        Insert: {
          comments?: string | null
          created_at?: string
          id?: string
          manufacturing_processes: string[]
          material: string
          material_other?: string | null
          name: string
          quantity: number
          quote_request_id: string
          tolerance?: string | null
        }
        Update: {
          comments?: string | null
          created_at?: string
          id?: string
          manufacturing_processes?: string[]
          material?: string
          material_other?: string | null
          name?: string
          quantity?: number
          quote_request_id?: string
          tolerance?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_request_parts_quote_request_id_fkey"
            columns: ["quote_request_id"]
            isOneToOne: false
            referencedRelation: "quote_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_requests: {
        Row: {
          additional_comments: string | null
          address: string
          captcha_token: string | null
          city: string
          company_name: string
          country: string
          created_at: string
          delivery_date: string
          email: string
          first_name: string
          id: string
          last_name: string
          max_budget: number | null
          min_budget: number | null
          phone: string
          position: string | null
          status: string
          updated_at: string
          vat_id: string | null
          zip_code: string
        }
        Insert: {
          additional_comments?: string | null
          address: string
          captcha_token?: string | null
          city: string
          company_name: string
          country: string
          created_at?: string
          delivery_date: string
          email: string
          first_name: string
          id?: string
          last_name: string
          max_budget?: number | null
          min_budget?: number | null
          phone: string
          position?: string | null
          status?: string
          updated_at?: string
          vat_id?: string | null
          zip_code: string
        }
        Update: {
          additional_comments?: string | null
          address?: string
          captcha_token?: string | null
          city?: string
          company_name?: string
          country?: string
          created_at?: string
          delivery_date?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          max_budget?: number | null
          min_budget?: number | null
          phone?: string
          position?: string | null
          status?: string
          updated_at?: string
          vat_id?: string | null
          zip_code?: string
        }
        Relationships: []
      }
      rfq_files: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id: string
          part_id: string | null
          rfq_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          id?: string
          part_id?: string | null
          rfq_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          id?: string
          part_id?: string | null
          rfq_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_files_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "rfq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_files_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      rfq_items: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          product_name: string
          quantity: number
          rfq_id: string
          total_price: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          product_name: string
          quantity?: number
          rfq_id: string
          total_price?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          product_name?: string
          quantity?: number
          rfq_id?: string
          total_price?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rfq_items_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
        ]
      }
      rfqs: {
        Row: {
          created_at: string | null
          currency: string | null
          customer_id: string
          description: string | null
          due_date: string | null
          id: string
          status: string
          title: string
          total_amount: number | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          customer_id: string
          description?: string | null
          due_date?: string | null
          id?: string
          status?: string
          title: string
          total_amount?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          customer_id?: string
          description?: string | null
          due_date?: string | null
          id?: string
          status?: string
          title?: string
          total_amount?: number | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          user_id: string
          required_role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "sales_rep"
        | "customer"
        | "supplier"
        | "production_manager"
        | "accountant"
        | "partner_seller"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "sales_rep",
        "customer",
        "supplier",
        "production_manager",
        "accountant",
        "partner_seller",
      ],
    },
  },
} as const
