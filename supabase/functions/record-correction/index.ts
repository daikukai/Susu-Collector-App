import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { groupId, memberId, amount, date, method, note, supersedes, originalAmount } = await req.json()
    
    if (!groupId || !memberId || !amount || !date || !supersedes || !originalAmount) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Get user from auth
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check for idempotency - if correction with same supersedes and amount exists, return it
    const { data: existingCorrection } = await supabaseClient
      .from('transactions')
      .select('*')
      .eq('supersedes', supersedes)
      .eq('amount', amount)
      .eq('group_id', groupId)
      .single()

    if (existingCorrection) {
      return new Response(
        JSON.stringify({ transaction: existingCorrection, idempotent: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Start transaction - insert correction atomically
    const { data: transaction, error: txError } = await supabaseClient.rpc(
      'record_correction_transaction',
      {
        p_group_id: groupId,
        p_member_id: memberId,
        p_amount: amount,
        p_date: date,
        p_method: method || 'Cash',
        p_note: note || 'Correction',
        p_supersedes: supersedes,
        p_original_amount: originalAmount,
        p_collector_id: user.id,
      }
    )

    if (txError) {
      console.error('Transaction error:', txError)
      return new Response(
        JSON.stringify({ error: txError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ transaction, idempotent: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
