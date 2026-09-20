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
    const { groupId } = await req.json()
    
    if (!groupId) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: groupId' }),
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

    // Check if group is already archived (idempotency)
    const { data: existingGroup } = await supabaseClient
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .eq('archived', true)
      .single()

    if (existingGroup) {
      return new Response(
        JSON.stringify({ group: existingGroup, idempotent: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check for open disputes
    const { data: openDisputes } = await supabaseClient
      .from('disputes')
      .select('id')
      .eq('group_id', groupId)
      .eq('status', 'open')

    if (openDisputes && openDisputes.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Cannot close cycle with open disputes', openDisputesCount: openDisputes.length }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Close cycle atomically
    const { data: group, error: groupError } = await supabaseClient.rpc(
      'close_cycle_transaction',
      {
        p_group_id: groupId,
        p_collector_id: user.id,
      }
    )

    if (groupError) {
      console.error('Transaction error:', groupError)
      return new Response(
        JSON.stringify({ error: groupError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ group, idempotent: false }),
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
