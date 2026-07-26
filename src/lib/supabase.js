import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://ubdkoqxfwcraftesgmbw.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZGtvcXhmd2NyYWZ0ZXNnbWJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNjUwMjcsImV4cCI6MjA5MDY0MTAyN30.s1A15nFQVne94gbz0511L2IYvHdTcgYeL0H8YU80iI8'

export const supabase = createClient(url, key, {
  auth: {
    flowType: 'implicit',
    // Sessão NUNCA é persistida em cache (localStorage). Fechou a aba / voltou
    // depois → precisa logar de novo com e-mail e senha, sempre. A sessão vive
    // só em memória enquanto a aba está aberta.
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
