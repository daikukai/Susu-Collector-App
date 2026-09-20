import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { to, message, memberId, kind } = await req.json()

    if (!to || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: "to" and "message"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let formattedTo = to.replace(/[^\d+]/g, '')
    if (formattedTo.startsWith('0')) {
      formattedTo = '+231' + formattedTo.substring(1)
    } else if (!formattedTo.startsWith('+')) {
      formattedTo = '+' + formattedTo
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = Deno.env.get('AT_API_KEY') || ''
    const username = Deno.env.get('AT_USERNAME') || 'sandbox'
    const fromSender = Deno.env.get('AT_SENDER_ID') || ''

    let smsStatus = 'Sent'
    let providerResponse = null

    if (apiKey) {
      const isSandbox = username.toLowerCase() === 'sandbox'
      const apiUrl = isSandbox
        ? 'https://api.sandbox.africastalking.com/version1/messaging'
        : 'https://api.africastalking.com/version1/messaging'

      const formData = new URLSearchParams()
      formData.append('username', username)
      formData.append('to', to)
      formData.append('message', message)
      if (fromSender) {
        formData.append('from', fromSender)
      }

      const atRes = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'apiKey': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: formData.toString(),
      })

      providerResponse = await atRes.json()

      const recipients = providerResponse?.SMSMessageData?.Recipients || []
      const firstRecipient = recipients[0]
      if (firstRecipient && (firstRecipient.status === 'Success' || firstRecipient.statusCode === 101)) {
        smsStatus = 'Delivered'
      } else if (firstRecipient && firstRecipient.status === 'Failed') {
        smsStatus = 'Failed'
      }
    }

    // Record entry in sms_log table
    const { data: smsEntry, error: logError } = await supabaseClient
      .from('sms_log')
      .insert({
        collector_id: user.id,
        member_id: memberId === 'collector' || !memberId ? null : memberId,
        kind: kind || 'Receipt',
        status: smsStatus,
        content: message,
      })
      .select()
      .single()

    if (logError) {
      console.error('Failed to write to sms_log:', logError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        smsStatus,
        smsEntry,
        providerResponse,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Send SMS Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
