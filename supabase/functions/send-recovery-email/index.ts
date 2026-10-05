// DESATIVADA. Esta função mandava por e-mail um código do Auth que o navegador trocava por
// uma sessão — quem tinha só a caixa de e-mail entrava sem senha e sem o código do WhatsApp.
// A recuperação de senha agora é reset-start + reset-confirm (e-mail + WhatsApp, sem sessão).
Deno.serve(() =>
  new Response(JSON.stringify({ error: 'Recurso desativado. Use "Esqueceu a senha?" no portal.' }), {
    status: 410,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    },
  }))
